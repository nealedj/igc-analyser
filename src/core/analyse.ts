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
import { median, pyRound } from './pyutil.ts';

export interface AnalyseOptions {
  /** Turn-rate threshold for circling, deg/s. */
  minCircleRate?: number;
  /** Release time override, seconds since midnight UTC. */
  releaseTime?: number;
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
