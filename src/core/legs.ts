/**
 * Straight-leg airmass energy balance.
 *
 * `mean_airmass_ms` is the vertical motion of the air the glider flew through:
 * measured height change minus the polar sink for the speed and density it was
 * flown at. It is the most useful figure in the analysis for a line-running
 * flight, and it is only ever as good as the assumed polar — which is why
 * nothing here should be shown without the polar note attached.
 *
 * Port of `analyse_leg`.
 */

import type { Fix } from './types.ts';
import { Polar, sigma } from './polar.ts';
import { mean, pstdev } from './pyutil.ts';

export interface Leg {
  start: number;
  end: number;
  duration_s: number;
  distance_m: number;
  dh_m: number;
  /** Distance over height lost. Not wind-corrected. Null if the leg climbed. */
  ld_over_ground: number | null;
  mean_ias_kmh: number | null;
  sd_ias_kmh: number | null;
  alt_start_m: number;
  alt_end_m: number;
  mean_airmass_ms?: number;
  frac_rising_air?: number;
  sampled_s?: number;
  /** Set once the flight as a whole is known: part of the landing circuit. */
  circuit?: boolean;
}

export function analyseLeg(
  F: Fix[],
  a: number,
  b: number,
  polar: Polar | null,
  wind: readonly [number, number] | null,
): Leg {
  const seg = F.slice(a, b + 1);
  const dur = seg[seg.length - 1].t - seg[0].t;

  let dist = 0;
  for (let i = 0; i < seg.length - 1; i++) if (seg[i].dt > 0) dist += seg[i].step;
  const dh = seg[seg.length - 1].alt - seg[0].alt;
  const [wx, wy] = wind ?? [0, 0];

  const ias: number[] = [];
  const ws: [number, number][] = [];
  let T = 0;
  let up = 0;

  for (let i = 0; i < seg.length - 1; i++) {
    const f = seg[i];
    if (!f.good) continue;
    const tas = Math.hypot(f.vx - wx, f.vy - wy);
    const s = sigma(f.alt);
    const eas = tas * Math.sqrt(s);
    ias.push(eas * 3.6);
    T += f.dt;
    if (polar) {
      const w = f.vz + polar.sink(eas) / Math.sqrt(s);
      ws.push([w, f.dt]);
      if (w > 0) up += f.dt;
    }
  }

  const leg: Leg = {
    start: seg[0].t,
    end: seg[seg.length - 1].t,
    duration_s: dur,
    distance_m: dist,
    dh_m: dh,
    ld_over_ground: dh < 0 ? dist / -dh : null,
    mean_ias_kmh: ias.length ? mean(ias) : null,
    sd_ias_kmh: ias.length > 2 ? pstdev(ias) : null,
    alt_start_m: seg[0].alt,
    alt_end_m: seg[seg.length - 1].alt,
  };

  if (ws.length && T) {
    leg.mean_airmass_ms = ws.reduce((acc, [w, d]) => acc + w * d, 0) / T;
    leg.frac_rising_air = up / T;
    leg.sampled_s = T;
  }
  return leg;
}
