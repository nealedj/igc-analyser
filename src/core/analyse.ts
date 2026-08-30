/**
 * Orchestrates the analysis and returns the result object.
 *
 * The field names and units mirror `reference/igc_analyse.py --json`, because
 * that output is the test oracle. Everything is SI here; unit conversion is a
 * presentation concern and lives in the UI.
 */

import type { Fix, Header, Run, TaskPoint } from './types.ts';
import { chooseAltitude, parseIgc } from './parse.ts';
import { addKinematics } from './kinematics.ts';
import { segment } from './segment.ts';
import { findLaunch } from './launch.ts';
import { bestWindow, circleStats, perCircle } from './climbs.ts';
import type { CircleStats, PerCircle } from './climbs.ts';
import { estimateWind } from './wind.ts';
import type { Wind } from './wind.ts';
import { analyseLeg } from './legs.ts';
import type { Leg } from './legs.ts';
import { loadPolar } from './polar.ts';
import type { LoadPolarOptions, PolarDb } from './polar.ts';
import polarsDb from '../data/polars.json' with { type: 'json' };
import { median, pyRound } from './pyutil.ts';

export interface AnalyseOptions {
  /** Turn-rate threshold for circling, deg/s. */
  minCircleRate?: number;
  /** Release time override, seconds since midnight UTC. */
  releaseTime?: number;
  /** Force or disable the polar, or supply a custom one. */
  polar?: LoadPolarOptions;
  /** Override the polar database. Defaults to the bundled one. */
  polarDb?: PolarDb;
}

export interface ProfilePoint {
  t: number;
  alt_m: number;
  lat: number;
  lon: number;
  circling: boolean;
}

export interface TraceQuality {
  fixes: number;
  median_interval_s: number;
  max_gap_s: number;
  /** Gaps over 20 s: count, total seconds, and the largest with its time. */
  gaps_over_20s: number;
  gap_total_s: number;
  largest_gap_s: number;
  largest_gap_at: number;
  /** True when the fix rate is too coarse to see inside a circle. */
  coarse: boolean;
}

/** A climb: circle geometry, its best sustained 30 s, and each 360 in it. */
export interface Climb extends CircleStats {
  best_30s_ms: number | null;
  per_circle: PerCircle[];
}

export interface Result {
  header: Header;
  warnings: string[];
  altitude_source: 'pressure' | 'GNSS';
  launch: {
    takeoff: number;
    release: number;
    type: string;
    note: string;
    /** Not in the oracle's JSON: whether the release is a real detection. */
    release_confident: boolean;
  };
  track_distance_m: number;
  task: TaskPoint[];
  phase: {
    circling_s: number;
    soaring_s: number;
    gain_circling_m: number;
    /** Not in the oracle's JSON; it prints these as text. */
    straight_s: number;
    circling_fraction: number;
    mean_circling_rate_ms: number | null;
    working_band: { bottom_m: number; top_m: number } | null;
  };
  wind: Wind | null;
  climbs: Climb[];
  legs: Leg[];
  /** Which polar was used and on what evidence. Not in the oracle's JSON. */
  polar: {
    name: string | null;
    note: string;
    matched: boolean;
    best_ld: number | null;
    best_ld_speed_ms: number | null;
  };
  /** Fraction of straight flight spent in rising air, circuit legs excluded. */
  rising_air_fraction: number | null;
  profile: ProfilePoint[];
  /** Not in the oracle's JSON; the oracle prints the same figures as text. */
  trace: {
    start: number;
    end: number;
    duration_s: number;
    max_alt_m: number;
    landed: boolean;
    quality: TraceQuality;
  };
}

/** Everything the analysis derives, kept alongside the result for the UI. */
export interface Analysis {
  result: Result;
  fixes: Fix[];
  runs: Run[];
}

export function analyse(text: string, opts: AnalyseOptions = {}): Analysis {
  const { header, fixes: F, task, warnings } = parseIgc(text);
  const altitudeSource = chooseAltitude(F);
  addKinematics(F);
  const rs = segment(F, opts.minCircleRate ?? 6.0);

  const launch = findLaunch(F);
  let release = launch.release;
  let releaseConfident = launch.confident;
  let note = launch.note;
  if (opts.releaseTime !== undefined) {
    const want = opts.releaseTime;
    let bi = 0;
    for (let i = 1; i < F.length; i++) {
      if (Math.abs(F[i].t - want) < Math.abs(F[bi].t - want)) bi = i;
    }
    release = bi;
    releaseConfident = true;
    note += '  [release time supplied by the operator]';
  }

  let dist = 0;
  for (const f of F) if (f.dt > 0) dist += f.step;

  const dts: number[] = [];
  for (let i = 0; i < F.length - 1; i++) dts.push(F[i + 1].t - F[i].t);
  const gaps = dts.map((d, i) => ({ t: F[i].t, d })).filter((g) => g.d > 20);
  const largest = gaps.reduce((m, g) => (g.d > m.d ? g : m), { t: 0, d: 0 });

  let maxAlt = -Infinity;
  for (const f of F) if (f.alt > maxAlt) maxAlt = f.alt;
  const tailSpeeds: number[] = [];
  for (let i = Math.max(0, F.length - 6); i < F.length - 1; i++) {
    if (F[i].good) tailSpeeds.push(F[i].gs * 3.6);
  }
  const tailGs = tailSpeeds.length
    ? tailSpeeds.reduce((a, b) => a + b, 0) / tailSpeeds.length
    : 999;
  const landed = F[F.length - 1].alt < maxAlt - 300 && tailGs < 60;

  const medianInterval = dts.length ? median(dts) : 0;

  // ------------------------------------------------------ climbs and phases
  // Only circling after release counts: the tow is not a climb the pilot flew.
  const relT = F[release].t;
  const climbRuns = rs.filter(
    (r) => r.circ && F[r.a].t >= relT && F[r.b].alt - F[r.a].alt > 0 && F[r.b].t - F[r.a].t >= 30,
  );
  const wind = estimateWind(F, climbRuns);
  const windVec = wind ? wind.vector : null;

  const climbs: Climb[] = climbRuns.map((r) => ({
    ...circleStats(F, r.a, r.b, windVec),
    best_30s_ms: bestWindow(F, r.a, r.b),
    per_circle: perCircle(F, r.a, r.b),
  }));

  let circlingS = 0;
  for (const r of rs) if (r.circ && F[r.a].t >= relT) circlingS += F[r.b].t - F[r.a].t;
  const soaringS = Math.max(1, F[F.length - 1].t - relT);
  const gainCircling = climbRuns.reduce((acc, r) => acc + (F[r.b].alt - F[r.a].alt), 0);

  const workingBand = climbs.length
    ? {
        bottom_m: Math.min(...climbRuns.map((r) => F[r.a].alt)),
        top_m: Math.max(...climbRuns.map((r) => F[r.b].alt)),
      }
    : null;

  // ------------------------------------------------------------ cruise legs
  const match = loadPolar((opts.polarDb ?? (polarsDb as PolarDb)), header.glider_type, opts.polar ?? {});
  const bestLd = match.polar ? match.polar.bestLd() : null;

  const legRuns = rs.filter((r) => !r.circ && F[r.a].t >= relT && F[r.b].t - F[r.a].t >= 60);
  const landAlt = F[F.length - 1].alt;
  const legs: Leg[] = legRuns.map((r) => {
    const leg = analyseLeg(F, r.a, r.b, match.polar, windVec);
    leg.circuit = landed && F[r.b].alt < landAlt + 250;
    return leg;
  });

  // Circuit legs are excluded: a descending circuit is not a comment on the day.
  let upT = 0;
  let totT = 0;
  for (const leg of legs) {
    if (leg.frac_rising_air !== undefined && !leg.circuit) {
      upT += leg.frac_rising_air * leg.sampled_s!;
      totT += leg.sampled_s!;
    }
  }

  const result: Result = {
    header,
    warnings,
    altitude_source: altitudeSource,
    launch: {
      takeoff: F[launch.takeoff].t,
      release: F[release].t,
      type: launch.type,
      note,
      release_confident: releaseConfident,
    },
    track_distance_m: dist,
    task,
    phase: {
      circling_s: circlingS,
      soaring_s: soaringS,
      gain_circling_m: gainCircling,
      straight_s: soaringS - circlingS,
      circling_fraction: circlingS / soaringS,
      mean_circling_rate_ms: circlingS ? gainCircling / circlingS : null,
      working_band: workingBand,
    },
    wind,
    climbs,
    legs,
    polar: {
      name: match.polar ? match.polar.name : null,
      note: match.note,
      matched: match.matched,
      best_ld: bestLd ? bestLd.ld : null,
      best_ld_speed_ms: bestLd ? bestLd.speed : null,
    },
    rising_air_fraction: totT ? upT / totT : null,
    profile: F.map((f) => ({
      t: f.t,
      alt_m: f.alt,
      lat: pyRound(f.lat, 5),
      lon: pyRound(f.lon, 5),
      circling: f.circ,
    })),
    trace: {
      start: F[0].t,
      end: F[F.length - 1].t,
      duration_s: F[F.length - 1].t - F[0].t,
      max_alt_m: maxAlt,
      landed,
      quality: {
        fixes: F.length,
        median_interval_s: medianInterval,
        max_gap_s: dts.length ? Math.max(...dts) : 0,
        gaps_over_20s: gaps.length,
        gap_total_s: gaps.reduce((a, g) => a + g.d, 0),
        largest_gap_s: largest.d,
        largest_gap_at: largest.t,
        coarse: medianInterval > 4,
      },
    },
  };

  return { result, fixes: F, runs: rs };
}
