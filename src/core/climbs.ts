/**
 * Climb aggregates, circle geometry and the per-circle breakdown.
 *
 * The geometry figures come from accumulated heading change and wind-corrected
 * airspeed, so they are averages across a whole climb rather than a snapshot.
 * On a trace coarser than about 2 s between fixes they cannot show where in
 * the circle the lift was at all — see `interpretation.md`.
 *
 * Port of `circle_stats`, `per_circle` and `best_window`.
 */

import type { Fix } from './types.ts';
import { G, wrap } from './kinematics.ts';
import { mean, median, radians, degrees } from './pyutil.ts';

export interface CircleStats {
  start: number;
  end: number;
  duration_s: number;
  gain_m: number;
  alt_bottom_m: number;
  alt_top_m: number;
  avg_climb_ms: number;
  circles: number;
  direction: 'left' | 'right';
  /** Seconds per 360, null when the turn is too slow to call it circling. */
  circle_time_s: number | null;
  radius_m: number | null;
  bank_deg: number | null;
  airspeed_kmh: number;
  turn_rate_deg_s: number;
  /** Mean drift of the circle, m/s east and north: the wind, if unforced. */
  drift_vx: number;
  drift_vy: number;
}

export interface PerCircle {
  start: number;
  duration_s: number;
  gain_m: number;
  climb_ms: number;
  /** Circle centre in the local projected frame, and its mean time. */
  cx: number;
  cy: number;
  ct: number;
  alt_m: number;
}

/**
 * Geometry of one circling segment. Pass the flight-mean wind to hold the
 * airspeed honest; leave it out and the segment's own drift is used, which is
 * what makes this usable as a wind estimator.
 */
export function circleStats(
  F: Fix[],
  a: number,
  b: number,
  wind?: readonly [number, number] | null,
): CircleStats {
  const seg = F.slice(a, b + 1);
  const dur = seg[seg.length - 1].t - seg[0].t;

  let turned = 0;
  for (let i = 0; i < seg.length - 1; i++) {
    if (seg[i].trk !== null && seg[i + 1].trk !== null && seg[i].good) {
      turned += wrap(seg[i + 1].trk! - seg[i].trk!);
    }
  }
  const circles = Math.abs(turned) / 360;

  let T = 0;
  for (let i = 0; i < seg.length - 1; i++) if (seg[i].good) T += seg[i].dt;
  if (T === 0) T = 1;

  let wx: number;
  let wy: number;
  if (wind === undefined || wind === null) {
    wx = 0;
    wy = 0;
    for (let i = 0; i < seg.length - 1; i++) {
      if (seg[i].good) {
        wx += seg[i].vx * seg[i].dt;
        wy += seg[i].vy * seg[i].dt;
      }
    }
    wx /= T;
    wy /= T;
  } else {
    [wx, wy] = wind;
  }

  const air: number[] = [];
  for (let i = 0; i < seg.length - 1; i++) {
    if (seg[i].good) air.push(Math.hypot(seg[i].vx - wx, seg[i].vy - wy));
  }
  const va = air.length ? median(air) : 0;

  const rate = dur ? Math.abs(turned) / dur : 0;
  const turning = rate > 0.5;

  return {
    start: seg[0].t,
    end: seg[seg.length - 1].t,
    duration_s: dur,
    gain_m: seg[seg.length - 1].alt - seg[0].alt,
    alt_bottom_m: seg[0].alt,
    alt_top_m: seg[seg.length - 1].alt,
    avg_climb_ms: dur ? (seg[seg.length - 1].alt - seg[0].alt) / dur : 0,
    circles,
    direction: turned > 0 ? 'right' : 'left',
    circle_time_s: turning ? 360 / rate : null,
    radius_m: turning ? va / radians(rate) : null,
    bank_deg: turning ? degrees(Math.atan((va * radians(rate)) / G)) : null,
    airspeed_kmh: va * 3.6,
    turn_rate_deg_s: rate,
    drift_vx: wx,
    drift_vy: wy,
  };
}

/** Split a circling segment into individual 360s: climb rate and centre. */
export function perCircle(F: Fix[], a: number, b: number): PerCircle[] {
  const seg = F.slice(a, b + 1);
  const out: PerCircle[] = [];
  let acc = 0;
  let start = 0;
  for (let i = 0; i < seg.length - 1; i++) {
    if (seg[i].trk === null || seg[i + 1].trk === null || !seg[i].good) continue;
    acc += wrap(seg[i + 1].trk! - seg[i].trk!);
    if (Math.abs(acc) >= 360) {
      const s = seg[start];
      const e = seg[i + 1];
      const d = e.t - s.t;
      const pts = seg.slice(start, i + 2);
      out.push({
        start: s.t,
        duration_s: d,
        gain_m: e.alt - s.alt,
        climb_ms: d ? (e.alt - s.alt) / d : 0,
        cx: mean(pts.map((p) => p.x)),
        cy: mean(pts.map((p) => p.y)),
        ct: mean(pts.map((p) => p.t)),
        alt_m: s.alt,
      });
      acc = 0;
      start = i + 1;
    }
  }
  return out;
}

/**
 * The best sustained climb rate over any `win`-second window in the segment.
 * Compared against the average, this is what separates a climb that was worked
 * well from one that was entered badly or left late.
 */
export function bestWindow(F: Fix[], a: number, b: number, win = 30): number | null {
  const seg = F.slice(a, b + 1);
  let best: number | null = null;
  for (let i = 0; i < seg.length; i++) {
    let j = i;
    while (j < seg.length - 1 && seg[j].t - seg[i].t < win) j++;
    const d = seg[j].t - seg[i].t;
    if (d >= win * 0.8) {
      const r = (seg[j].alt - seg[i].alt) / d;
      best = best === null ? r : Math.max(best, r);
    }
  }
  return best;
}
