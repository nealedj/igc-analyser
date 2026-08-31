/**
 * The declared task, as distances rather than just a list of points.
 *
 * The oracle carries the turnpoints and nothing else, because it prints their
 * names and stops there. A flight page has to say "303 km triangle", so the
 * legs and the total are computed here.
 *
 * Only the scoring points count. An IGC declaration also carries the take-off
 * and landing records, and including those turns a 300 km triangle into a
 * four-leg task of some other length; `parse.ts` labels them and this file
 * drops them.
 *
 * Great-circle distances: a 300 km task leg is long enough that a flat-earth
 * approximation would be off by a few hundred metres, and a badge claim is not
 * the place for that.
 */

import type { TaskDeclaration, TaskPoint } from './types.ts';
import { R_EARTH } from './kinematics.ts';
import { degrees, pyMod, radians } from './pyutil.ts';

export interface TaskLeg {
  from: string;
  to: string;
  distance_m: number;
  /** Initial great-circle bearing, degrees true. */
  bearing_deg: number;
}

export interface TaskSummary {
  /** Start, turnpoints and finish. Take-off and landing are not in here. */
  points: TaskPoint[];
  legs: TaskLeg[];
  /** Total declared distance along the legs, metres. */
  distance_m: number;
  /** True when the task finishes where it started. */
  closed: boolean;
  /** 'triangle', 'out and return', '4-leg closed course', and so on. */
  shape: string;
  /** Turnpoints between the start and the finish. */
  turnpoints: number;
  /** The declaration header, where the file had a readable one. */
  declaration: TaskDeclaration | null;
  /** Declared take-off and landing points, where the file names them. */
  takeoff: TaskPoint | null;
  landing: TaskPoint | null;
}

/** Great-circle distance in metres. */
export function haversine(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const p1 = radians(lat1);
  const p2 = radians(lat2);
  const dp = radians(lat2 - lat1);
  const dl = radians(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing from one point to another, degrees true. */
export function bearing(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const p1 = radians(lat1);
  const p2 = radians(lat2);
  const dl = radians(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return pyMod(degrees(Math.atan2(y, x)), 360);
}

/** The scoring points: start, turnpoints and finish, in declared order. */
export function scoringPoints(points: TaskPoint[]): TaskPoint[] {
  const scored = points.filter((p) => p.role !== 'takeoff' && p.role !== 'landing');
  // A block with no roles at all is a task the parser could not lay out. Every
  // point in it is a candidate, which is what this did before roles existed.
  return scored.length ? scored : points;
}

export function summariseTask(
  points: TaskPoint[],
  declaration: TaskDeclaration | null = null,
): TaskSummary | null {
  const scored = scoringPoints(points);
  if (scored.length < 2) return null;

  const legs: TaskLeg[] = [];
  let total = 0;
  for (let i = 0; i < scored.length - 1; i++) {
    const [a, b] = [scored[i], scored[i + 1]];
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    total += d;
    legs.push({
      from: a.name || label(a),
      to: b.name || label(b),
      distance_m: d,
      bearing_deg: bearing(a.lat, a.lon, b.lat, b.lon),
    });
  }

  const first = scored[0];
  const last = scored[scored.length - 1];
  // Within a kilometre of the start is the same point: turnpoints are declared
  // to three decimal minutes and start lines are not points anyway.
  const closed = haversine(first.lat, first.lon, last.lat, last.lon) < 1000;

  let shape: string;
  if (closed && legs.length === 2) shape = 'out and return';
  else if (closed && legs.length === 3) shape = 'triangle';
  else if (closed && legs.length === 4) shape = 'quadrilateral';
  else if (closed) shape = `${legs.length}-leg closed course`;
  else if (legs.length === 1) shape = 'straight distance';
  else shape = `${legs.length}-leg task`;

  return {
    points: scored,
    legs,
    distance_m: total,
    closed,
    shape,
    turnpoints: Math.max(0, scored.length - 2),
    declaration,
    takeoff: points.find((p) => p.role === 'takeoff') ?? null,
    landing: points.find((p) => p.role === 'landing') ?? null,
  };
}

const label = (p: TaskPoint): string => `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
