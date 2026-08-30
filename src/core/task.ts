/**
 * The declared task, as distances rather than just a list of points.
 *
 * The oracle carries the turnpoints and nothing else, because it prints their
 * names and stops there. A flight page has to say "303 km triangle", so the
 * legs and the total are computed here.
 *
 * Great-circle distances: a 300 km task leg is long enough that a flat-earth
 * approximation would be off by a few hundred metres, and a badge claim is not
 * the place for that.
 */

import type { TaskPoint } from './types.ts';
import { R_EARTH } from './kinematics.ts';
import { radians } from './pyutil.ts';

export interface TaskLeg {
  from: string;
  to: string;
  distance_m: number;
}

export interface TaskSummary {
  points: TaskPoint[];
  legs: TaskLeg[];
  /** Total declared distance along the legs, metres. */
  distance_m: number;
  /** True when the task finishes where it started. */
  closed: boolean;
  /** 'triangle', 'out and return', '4-leg closed course', and so on. */
  shape: string;
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

export function summariseTask(points: TaskPoint[]): TaskSummary | null {
  if (points.length < 2) return null;

  const legs: TaskLeg[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = haversine(points[i].lat, points[i].lon, points[i + 1].lat, points[i + 1].lon);
    total += d;
    legs.push({
      from: points[i].name || label(points[i]),
      to: points[i + 1].name || label(points[i + 1]),
      distance_m: d,
    });
  }

  const first = points[0];
  const last = points[points.length - 1];
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

  return { points, legs, distance_m: total, closed, shape };
}

const label = (p: TaskPoint): string => `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
