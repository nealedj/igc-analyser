/**
 * The trace against the declared task: start, turnpoint rounding, finish, and
 * the speed that comes out of them.
 *
 * "103 km/h round the 300" is the number a pilot wants back from a day, and it
 * is the one figure a debrief cannot assemble from the phase split and the
 * climbs. It needs the declaration and the trace put side by side, which is
 * what this does.
 *
 * ## It is still not a score
 *
 * A scoring program has the task the organisers set, the observation zones
 * they set with it, the start height and time limits, the airspace, and a
 * penalty schedule. This has an IGC declaration and a track log. So the zones
 * here are a stated assumption, chosen on the page rather than read from the
 * file, and every figure carries which one it used. What it can do is tell you
 * whether the trace went round the course as declared and how long it took,
 * which is what a debrief is for.
 *
 * ## The zones
 *
 * Two, both real rules, both stated:
 *
 * - **`cylinder`** - within `radius_m` of the point. The 1 km turnpoint
 *   cylinder is what most modern tasks and most ladder claims use.
 * - **`fai-sector`** - the 90° sector of the Sporting Code: apex on the point,
 *   bisected by the outward bisector of the two legs, unlimited radius, or
 *   within 500 m of the point, which the code allows as the alternative.
 *
 * A sector is only defined where there is a leg either side, so start and
 * finish use a cylinder under both settings. Real start lines, start rings and
 * finish rings are none of these, which is exactly why the assumption is on the
 * page rather than buried here.
 *
 * ## The start
 *
 * The last exit from the start zone before the first turnpoint was achieved,
 * and never before release. The last exit is the ordinary rule - a glider that
 * dips back into the start zone has not started yet - and it is what makes the
 * speed mean anything on a flight that pushed out, thought better of it, and
 * came back. The release bound matters because a glider launching from its own
 * start point leaves the start zone on tow: without it, the clock would run
 * from somewhere over the winch run and a 300 km day would come out ten
 * minutes slow.
 */

import type { Fix, TaskPoint } from './types.ts';
import { haversine, bearing } from './task.ts';
import type { TaskSummary } from './task.ts';
import { pyMod } from './pyutil.ts';
import { wrap } from './kinematics.ts';

export type ObservationZone = 'cylinder' | 'fai-sector';

/** Radius of the cylinder the FAI sector may be achieved inside instead. */
export const FAI_SECTOR_CYLINDER_M = 500;

export interface TaskZoneOptions {
  kind?: ObservationZone;
  /** Cylinder radius, metres. Also the start and finish zone under both. */
  radius_m?: number;
}

export interface FlyTaskOptions extends TaskZoneOptions {
  /**
   * Release time, seconds UTC. Nothing before it can be a start: a glider
   * launching from its own start point leaves the start zone on tow.
   */
  releaseTime?: number;
}

/** One declared point, and what the trace did about it. */
export interface TaskPointFlown {
  name: string;
  role: 'start' | 'turn' | 'finish';
  /** Which zone this point was tested with; start and finish are cylinders. */
  zone: ObservationZone;
  /**
   * When this point counted, seconds UTC; null if it never did. For a
   * turnpoint or the finish that is when the zone was first achieved; for the
   * start it is the last exit from it, which is the time the clock runs from.
   */
  time: number | null;
  /** Closest the glider came, metres. The evidence when it was missed. */
  closest_m: number;
  /** When it came closest, seconds UTC. */
  closest_at: number;
}

export interface TaskFlight {
  zone: ObservationZone;
  radius_m: number;
  points: TaskPointFlown[];
  /** Last exit from the start zone before the first turnpoint, seconds UTC. */
  start: number | null;
  /** First entry into the finish zone after the last turnpoint. */
  finish: number | null;
  /** Turnpoints rounded in order, and how many were declared. */
  turnpoints_rounded: number;
  turnpoints_declared: number;
  /** Every point achieved in order, start and finish included. */
  complete: boolean;
  /** Finish minus start. Null unless both are there. */
  duration_s: number | null;
  /** Declared distance over elapsed time. The number, when there is one. */
  speed_ms: number | null;
  /** Declared task distance this speed is over, metres. */
  distance_m: number;
  /** What happened, in words, for the case where it is not a clean round. */
  note: string;
  /**
   * True when no crossing out of the start zone was found after release, so
   * the clock runs from the release itself. It happens when the glider towed
   * out of the start zone and never came back to make a proper start, and it
   * means the elapsed time - and the speed - is an upper bound on the task
   * rather than a start that was flown.
   */
  start_assumed: boolean;
}

/** Distance from a fix to a declared point, metres. */
const range = (f: Fix, p: TaskPoint): number => haversine(f.lat, f.lon, p.lat, p.lon);

/**
 * Is this fix in the point's observation zone?
 *
 * `axis` is the bisector the sector is built on, or null where the point has
 * no leg either side and a cylinder is used instead.
 */
function inZone(
  f: Fix,
  p: TaskPoint,
  kind: ObservationZone,
  radius: number,
  axis: number | null,
): boolean {
  const d = range(f, p);
  if (kind === 'cylinder' || axis === null) return d <= radius;
  // The Sporting Code sector, or the small cylinder it allows instead.
  if (d <= FAI_SECTOR_CYLINDER_M) return true;
  return Math.abs(wrap(bearing(p.lat, p.lon, f.lat, f.lon) - axis)) <= 45;
}

/**
 * The direction the sector opens in.
 *
 * Per the Sporting Code the sector is symmetric about the *extension* of the
 * bisector of the angle between the two legs, and extends outwards away from
 * them. So it is the bisector turned through 180°, and the glider has to fly
 * past the turnpoint to be in it rather than cutting the corner short of it -
 * which is the whole point of a sector.
 *
 * On an out-and-return, where both legs leave the turnpoint in the same
 * direction, this is the 90° quadrant directly beyond it.
 */
function sectorAxis(prev: TaskPoint, at: TaskPoint, next: TaskPoint): number {
  const toPrev = bearing(at.lat, at.lon, prev.lat, prev.lon);
  const toNext = bearing(at.lat, at.lon, next.lat, next.lon);
  return pyMod(toPrev + wrap(toNext - toPrev) / 2 + 180, 360);
}

/**
 * Time at which the glider crossed a range from a point, between two fixes.
 *
 * Fixes are seconds apart and a glider covers 40 m in one of them, so taking
 * the fix time would put the start and the finish up to a fix out each. Range
 * is close enough to linear over one step to interpolate across.
 */
function crossing(a: Fix, b: Fix, p: TaskPoint, radius: number): number {
  const da = range(a, p);
  const db = range(b, p);
  if (da === db) return b.t;
  const k = (da - radius) / (da - db);
  return a.t + Math.max(0, Math.min(1, k)) * (b.t - a.t);
}

interface Achieved {
  /** Index of the first fix inside the zone. */
  index: number;
  time: number;
  closest_m: number;
  closest_at: number;
}

/** First fix at or after `from` that is in the zone, plus the closest approach. */
function achieve(
  F: Fix[],
  from: number,
  p: TaskPoint,
  kind: ObservationZone,
  radius: number,
  axis: number | null,
): Achieved | { index: null; closest_m: number; closest_at: number } {
  let closest = Infinity;
  let closestAt = F[Math.min(from, F.length - 1)].t;
  for (let i = from; i < F.length; i++) {
    const d = range(F[i], p);
    if (d < closest) {
      closest = d;
      closestAt = F[i].t;
    }
    if (inZone(F[i], p, kind, radius, axis)) {
      // Interpolating only makes sense for the cylinder, where the boundary is
      // the range being crossed. A sector edge is an angle, and the fix that
      // first satisfies it is as good as this gets.
      const t =
        (kind === 'cylinder' || axis === null) && i > from
          ? crossing(F[i - 1], F[i], p, radius)
          : F[i].t;
      return { index: i, time: t, closest_m: closest, closest_at: closestAt };
    }
  }
  return { index: null, closest_m: closest, closest_at: closestAt };
}

/**
 * Check the trace against the declared task.
 *
 * Returns null where there is nothing to check against: no declaration, or one
 * with fewer than two scoring points.
 */
export function flyTask(
  F: Fix[],
  summary: TaskSummary | null,
  opts: FlyTaskOptions = {},
): TaskFlight | null {
  if (!summary || summary.points.length < 2 || F.length < 2) return null;
  const kind = opts.kind ?? 'cylinder';
  const radius = opts.radius_m ?? 1000;

  const pts = summary.points;
  const last = pts.length - 1;
  const declared = Math.max(0, pts.length - 2);

  /** Start and finish have no leg on one side, so they are always cylinders. */
  const axisOf = (i: number): number | null =>
    kind === 'fai-sector' && i > 0 && i < last ? sectorAxis(pts[i - 1], pts[i], pts[i + 1]) : null;
  const zoneOf = (i: number): ObservationZone =>
    axisOf(i) === null ? 'cylinder' : 'fai-sector';

  const flown: TaskPointFlown[] = [];
  const roleOf = (i: number): 'start' | 'turn' | 'finish' =>
    i === 0 ? 'start' : i === last ? 'finish' : 'turn';

  // Walk the course in order. A point can only be achieved after the one
  // before it: flying through a turnpoint on the way out and rounding it for
  // real an hour later are the same place and different events.
  let cursor = 0;
  let rounded = 0;
  let startIndex: number | null = null;
  let startTime: number | null = null;
  let startAssumed = false;
  let finishTime: number | null = null;

  for (let i = 0; i <= last; i++) {
    const got = achieve(F, cursor, pts[i], kind, radius, axisOf(i));
    flown.push({
      name: pts[i].name || label(pts[i]),
      role: roleOf(i),
      zone: zoneOf(i),
      time: got.index === null ? null : got.time,
      closest_m: got.closest_m,
      closest_at: got.closest_at,
    });
    if (got.index === null) break;
    if (i === 0) startIndex = got.index;
    else if (i === last) finishTime = got.time;
    else rounded++;
    cursor = got.index;
  }

  // The start is the last exit from the start zone before the first point
  // after it was achieved. A glider that pushed out and came back has not
  // started; the ordinary rule is the last one that counts, and it is what
  // stops a false start turning a 103 km/h day into an 84 km/h one.
  const nextAfterStart = flown[1]?.time ?? null;
  if (startIndex !== null && nextAfterStart !== null) {
    const got = lastExit(F, pts[0], radius, startIndex, nextAfterStart, opts.releaseTime ?? -Infinity);
    startTime = got.time;
    startAssumed = got.assumed;
    // The row for the start should read the time the clock runs from, not the
    // first moment the glider was near the point, which on a flight launching
    // from the start point is the take-off.
    flown[0].time = startTime;
  }

  const complete = flown.length === pts.length && flown.every((p) => p.time !== null);
  const duration = complete && startTime !== null && finishTime !== null
    ? finishTime - startTime
    : null;

  return {
    zone: kind,
    radius_m: radius,
    points: flown,
    start: startTime,
    finish: complete ? finishTime : null,
    turnpoints_rounded: rounded,
    turnpoints_declared: declared,
    complete,
    duration_s: duration,
    speed_ms: duration !== null && duration > 0 ? summary.distance_m / duration : null,
    distance_m: summary.distance_m,
    note: describe(flown, complete, duration, startAssumed),
    start_assumed: startAssumed,
  };
}

/**
 * The last time the glider left the start zone, between release and `before`.
 *
 * An exit on tow is not a start, so anything before release is skipped. Where
 * that leaves nothing - the glider was already outside the zone at release, or
 * the start zone is big enough to hold the first leg - the answer is release
 * itself, which is the earliest the task could have begun.
 */
function lastExit(
  F: Fix[],
  start: TaskPoint,
  radius: number,
  from: number,
  before: number,
  notBefore: number,
): { time: number; assumed: boolean } {
  let exit: number | null = null;
  for (let i = from; i < F.length - 1 && F[i].t < before; i++) {
    if (F[i].t < notBefore) continue;
    const inside = range(F[i], start) <= radius;
    const out = range(F[i + 1], start) > radius;
    if (inside && out) exit = crossing(F[i], F[i + 1], start, radius);
  }
  if (exit !== null) return { time: exit, assumed: false };
  const fallback = Number.isFinite(notBefore) ? Math.max(F[from].t, notBefore) : F[from].t;
  return { time: fallback, assumed: true };
}

function describe(
  flown: TaskPointFlown[],
  complete: boolean,
  duration: number | null,
  startAssumed: boolean,
): string {
  if (complete && duration !== null && duration > 0) {
    return startAssumed
      ? 'the declared course was flown, but the glider left the start zone on tow and ' +
        'never returned to it, so the clock runs from release and the time is an upper bound'
      : 'the declared course was flown';
  }
  if (complete) return 'every point was reached, but not in a time that makes a speed';
  const missed = flown[flown.length - 1];
  if (flown.length === 1) {
    return `the trace never came within reach of the declared start (closest ${km(missed.closest_m)})`;
  }
  return (
    `${missed.role === 'finish' ? 'the finish' : `the ${ordinal(flown.length - 1)} turnpoint`}` +
    ` was not reached: closest ${km(missed.closest_m)}`
  );
}

const km = (m: number): string =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

const ordinal = (n: number): string => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
};

const label = (p: TaskPoint): string => `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
