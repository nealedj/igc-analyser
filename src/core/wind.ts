/**
 * Wind from circle drift, and the height profile the estimates make.
 *
 * A circling glider drifts with the air it is in, so the mean ground velocity
 * over whole circles is the wind. It needs at least a couple of complete
 * circles to mean anything, which is why the per-climb estimates carry their
 * circle count: an estimate from 1.6 circles is not evidence.
 *
 * Each of those estimates also belongs to a height - the middle of the climb
 * it came from - and on a real day they will not agree, because the wind
 * veers and picks up through the working band. Averaging them into one vector
 * throws that away and then charges for it: every leg gets the flight mean,
 * and a crosswind leg low down gets a wind that belongs two thousand feet
 * higher. `windField` interpolates between them instead.
 *
 * Port of `estimate_wind`, plus the profile, which the oracle has no
 * equivalent of.
 */

import type { Fix, WindField } from './types.ts';
import { circleStats } from './climbs.ts';
import { degrees, pyMod } from './pyutil.ts';

export interface WindEstimate {
  time: number;
  speed_ms: number;
  /** Direction the wind is coming from, degrees true. */
  from_deg: number;
  circles: number;
  /** Height this estimate belongs to: the middle of the climb it came from. */
  alt_m: number;
  /** The vector itself, m/s east and north, so a profile can be built. */
  vx: number;
  vy: number;
}

export interface Wind {
  vector: [number, number];
  speed_ms: number;
  from_deg: number;
  per_climb: WindEstimate[];
  /** Spread between the fastest and slowest per-climb estimate, m/s. */
  spread_ms: number;
  /** True when the per-climb estimates disagree too much to lean on. */
  unreliable: boolean;
}

export function estimateWind(F: Fix[], climbs: { a: number; b: number }[]): Wind | null {
  const ests: { vx: number; vy: number; circles: number; start: number; alt: number }[] = [];
  for (const c of climbs) {
    const s = circleStats(F, c.a, c.b);
    if (s.circles >= 1.5) {
      ests.push({
        vx: s.drift_vx,
        vy: s.drift_vy,
        circles: s.circles,
        start: s.start,
        // The middle of the climb: the drift is accumulated across the whole
        // of it, so it belongs to the height it was accumulated at.
        alt: (s.alt_bottom_m + s.alt_top_m) / 2,
      });
    }
  }
  if (ests.length === 0) return null;

  const W = ests.reduce((acc, e) => acc + e.circles, 0);
  const wx = ests.reduce((acc, e) => acc + e.vx * e.circles, 0) / W;
  const wy = ests.reduce((acc, e) => acc + e.vy * e.circles, 0) / W;

  const per: WindEstimate[] = ests.map((e) => ({
    time: e.start,
    speed_ms: Math.hypot(e.vx, e.vy),
    from_deg: pyMod(degrees(Math.atan2(-e.vx, -e.vy)), 360),
    circles: e.circles,
    alt_m: e.alt,
    vx: e.vx,
    vy: e.vy,
  }));

  const speeds = per.map((p) => p.speed_ms);
  const spread = per.length > 1 ? Math.max(...speeds) - Math.min(...speeds) : 0;

  return {
    vector: [wx, wy],
    speed_ms: Math.hypot(wx, wy),
    from_deg: pyMod(degrees(Math.atan2(-wx, -wy)), 360),
    per_climb: per,
    spread_ms: spread,
    // The oracle's threshold: more than 8 kt of disagreement is noise.
    unreliable: spread * 1.943844 > 8,
  };
}

/**
 * Estimates within this of each other in height are the same height.
 *
 * Two climbs in the same part of the band are two samples of one wind, not a
 * gradient between them. Merged, they average; left apart, a small
 * disagreement between them becomes a near-vertical step in the profile that
 * every leg passing through it would pick up.
 */
const SAME_HEIGHT_M = 150;

/**
 * Estimates below this many whole circles are not evidence of a gradient.
 *
 * The flight-mean vector already weights by circle count, so a thin estimate
 * is diluted there. In a profile it would be a point the interpolation runs
 * through, at full strength, for every leg at that height.
 */
const PROFILE_MIN_CIRCLES = 2.5;

/**
 * The wind as a function of height, interpolated between the per-climb
 * estimates and held flat above the highest and below the lowest.
 *
 * Flat outside the range on purpose. Extrapolating a gradient beyond the
 * climbs that measured it is inventing wind for the part of the flight there
 * is no evidence about - which is the tow, the final glide and the circuit,
 * exactly where a wrong wind does the most visible damage.
 *
 * Falls back to the flight-mean vector when there is nothing to interpolate:
 * fewer than two heights with enough circles behind them.
 */
export function windField(w: Wind | null, profile = true): WindField | null {
  if (!w) return null;
  const flat: WindField = () => w.vector;
  if (!profile) return flat;

  const solid = w.per_climb
    .filter((e) => e.circles >= PROFILE_MIN_CIRCLES)
    .sort((a, b) => a.alt_m - b.alt_m);

  // Merge estimates at effectively the same height, weighted by circles.
  const pts: { alt: number; vx: number; vy: number }[] = [];
  let group: WindEstimate[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    const c = group.reduce((acc, e) => acc + e.circles, 0);
    pts.push({
      alt: group.reduce((acc, e) => acc + e.alt_m * e.circles, 0) / c,
      vx: group.reduce((acc, e) => acc + e.vx * e.circles, 0) / c,
      vy: group.reduce((acc, e) => acc + e.vy * e.circles, 0) / c,
    });
    group = [];
  };
  for (const e of solid) {
    if (group.length && e.alt_m - group[0].alt_m > SAME_HEIGHT_M) flush();
    group.push(e);
  }
  flush();

  if (pts.length < 2) return flat;

  return (altM: number) => {
    if (altM <= pts[0].alt) return [pts[0].vx, pts[0].vy];
    const top = pts[pts.length - 1];
    if (altM >= top.alt) return [top.vx, top.vy];
    let i = 1;
    while (i < pts.length - 1 && pts[i].alt < altM) i++;
    const a = pts[i - 1];
    const b = pts[i];
    const k = (altM - a.alt) / (b.alt - a.alt);
    return [a.vx + (b.vx - a.vx) * k, a.vy + (b.vy - a.vy) * k];
  };
}

/** How many distinct heights the profile actually rests on. */
export function windProfileLevels(w: Wind | null): number {
  if (!w) return 0;
  const solid = w.per_climb
    .filter((e) => e.circles >= PROFILE_MIN_CIRCLES)
    .sort((a, b) => a.alt_m - b.alt_m);
  let n = 0;
  let base = -Infinity;
  for (const e of solid) {
    if (e.alt_m - base > SAME_HEIGHT_M) {
      n++;
      base = e.alt_m;
    }
  }
  return n;
}
