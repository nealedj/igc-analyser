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

/**
 * What a straight leg was for.
 *
 * `final glide` is the last glide of the flight: from the top of the descent
 * down to circuit height, whether or not a task was declared. `circuit` is
 * what is left below that - the join, the circuit and the approach.
 */
export type LegKind = 'cruise' | 'final glide' | 'circuit';

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
  /** Set once the flight as a whole is known. */
  kind?: LegKind;
  /**
   * `kind === 'circuit'`. Kept because the oracle emits it and the export
   * format publishes it; `kind` is the one to read.
   */
  circuit?: boolean;
}

/**
 * Circuit height above the landing field, metres. About 1,000 ft: the height a
 * British circuit is joined at, and low enough that nothing above it is still
 * part of the landing.
 */
export const CIRCUIT_M = 300;

/**
 * The first fix of the final descent below circuit height, or null.
 *
 * "Final" is the point of it: the glider has to stay below from there to the
 * end, so a low save at 800 ft in the middle of the day is not circuit entry.
 * Returns null when the flight did not land, because then there is no circuit
 * and no field height to measure against.
 */
export function circuitEntry(F: Fix[], landed: boolean): number | null {
  if (!landed || F.length === 0) return null;
  const ceiling = F[F.length - 1].alt + CIRCUIT_M;
  let entry: number | null = null;
  for (let i = F.length - 1; i >= 0; i--) {
    if (F[i].alt >= ceiling) break;
    entry = i;
  }
  return entry;
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
