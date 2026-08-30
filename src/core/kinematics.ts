/**
 * Per-fix speed, heading, turn rate and vertical rate.
 *
 * Everything is differentiated from positions and times. Gaps are handled by
 * marking a fix `good` only when the step to the next fix is short enough to
 * differentiate across; long gaps still count towards distance but are kept
 * out of every rate.
 *
 * Port of `add_kinematics` and `wrap`.
 */

import type { Fix } from './types.ts';
import { mean, pyMod, degrees, radians } from './pyutil.ts';

export const R_EARTH = 6371000.0;
export const G = 9.80665;
/** m/s to knots. */
export const KT = 1.943844;
/** metres to feet. */
export const FT = 3.280840;

/** Signed smallest angle between two bearings, in (-180, 180]. */
export function wrap(a: number): number {
  return pyMod(a + 180, 360) - 180;
}

export function addKinematics(F: Fix[], maxGap = 12): void {
  const lat0 = mean(F.map((f) => f.lat));
  const lon0 = mean(F.map((f) => f.lon));
  const cosl = Math.cos(radians(lat0));
  for (const f of F) {
    f.x = radians(f.lon - lon0) * R_EARTH * cosl;
    f.y = radians(f.lat - lat0) * R_EARTH;
  }

  for (let i = 0; i < F.length; i++) {
    const f = F[i];
    f.dt = i < F.length - 1 ? F[i + 1].t - f.t : 0;
    if (f.dt > 0) {
      f.dx = F[i + 1].x - f.x;
      f.dy = F[i + 1].y - f.y;
      f.step = Math.hypot(f.dx, f.dy);
      f.vx = f.dx / f.dt;
      f.vy = f.dy / f.dt;
      f.gs = f.step / f.dt;
      f.vz = (F[i + 1].alt - f.alt) / f.dt;
    } else {
      f.dx = f.dy = f.step = f.vx = f.vy = 0;
      f.gs = f.vz = 0;
    }
    f.good = f.dt > 0 && f.dt <= maxGap;
  }

  // Track taken from the neighbours either side: less noisy than a single step.
  for (let i = 0; i < F.length; i++) {
    F[i].trk =
      i > 0 && i < F.length - 1
        ? pyMod(degrees(Math.atan2(F[i + 1].x - F[i - 1].x, F[i + 1].y - F[i - 1].y)), 360)
        : null;
  }

  for (let i = 0; i < F.length; i++) {
    const f = F[i];
    f.tr =
      f.trk !== null && i < F.length - 1 && F[i + 1].trk !== null && f.dt > 0 && f.dt <= maxGap
        ? wrap(F[i + 1].trk! - f.trk) / f.dt
        : null;
  }

  for (let i = 0; i < F.length; i++) {
    const f = F[i];
    const w: number[] = [];
    for (let j = Math.max(0, i - 5); j < Math.min(F.length, i + 6); j++) {
      if (F[j].tr !== null && Math.abs(F[j].t - f.t) <= 10) w.push(F[j].tr!);
    }
    f.trs = w.length ? mean(w) : 0;
  }
}
