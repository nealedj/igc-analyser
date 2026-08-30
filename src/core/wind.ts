/**
 * Wind from circle drift.
 *
 * A circling glider drifts with the air it is in, so the mean ground velocity
 * over whole circles is the wind. It needs at least a couple of complete
 * circles to mean anything, which is why the per-climb estimates carry their
 * circle count: an estimate from 1.6 circles is not evidence.
 *
 * Port of `estimate_wind`.
 */

import type { Fix } from './types.ts';
import { circleStats } from './climbs.ts';
import { degrees, pyMod } from './pyutil.ts';

export interface WindEstimate {
  time: number;
  speed_ms: number;
  /** Direction the wind is coming from, degrees true. */
  from_deg: number;
  circles: number;
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
  const ests: { vx: number; vy: number; circles: number; start: number }[] = [];
  for (const c of climbs) {
    const s = circleStats(F, c.a, c.b);
    if (s.circles >= 1.5) {
      ests.push({ vx: s.drift_vx, vy: s.drift_vy, circles: s.circles, start: s.start });
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
