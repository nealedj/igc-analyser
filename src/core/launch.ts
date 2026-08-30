/**
 * Take-off and release detection.
 *
 * Release detection is genuinely hard: on a good day the tow speed and the
 * post-release cruise speed overlap. When nothing clean is found, the top of
 * the initial continuous climb is used instead and `confident` is false, which
 * the report flags so the reader can override it.
 *
 * Port of `find_launch`.
 */

import type { Fix, Launch } from './types.ts';
import { FT } from './kinematics.ts';
import { mean, pyFixed } from './pyutil.ts';

export function findLaunch(F: Fix[]): Launch {
  let to = 0;
  for (let i = 0; i < F.length; i++) {
    if (F[i].gs * 3.6 > 25 && F[i].good) {
      to = i;
      break;
    }
  }
  // If the trace starts on the ground, back up to the first fix.
  if (to > 0 && F[0].alt < F[to].alt - 30) to = 0;

  // The initial continuous climb: run up until height is given back properly.
  let top = to;
  let best = F[to].alt;
  for (let i = to; i < F.length; i++) {
    if (F[i].alt >= best) {
      best = F[i].alt;
      top = i;
    } else if (F[i].alt < best - 60) {
      break;
    }
  }

  const dur = F[top].t - F[to].t;
  const gain = F[top].alt - F[to].alt;
  const spd: number[] = [];
  for (let i = to; i < top; i++) if (F[i].good) spd.push(F[i].gs * 3.6);
  const mspd = spd.length ? mean(spd) : 0;

  let type: string;
  if (gain < 50) type = 'no launch in this file - the trace appears to start airborne';
  else if (dur <= 100 && gain > 100) type = 'winch or bungee launch';
  else if (mspd >= 90 && mspd <= 155 && dur > 100) type = 'aerotow';
  else type = 'unclear - possibly a self-launch or a partial trace';

  // Release: the first sustained drop below tow speed.
  let release: number | null = null;
  let confident = false;
  if (type === 'aerotow') {
    for (let i = to + 5; i < Math.min(top + 40, F.length - 3); i++) {
      if (!F[i].good) continue;
      const nxt: number[] = [];
      for (let j = i; j < Math.min(i + 8, F.length); j++) if (F[j].good) nxt.push(F[j].gs * 3.6);
      if (nxt.length >= 4 && mean(nxt) < mspd - 15) {
        release = i;
        confident = true;
        break;
      }
    }
  }
  if (release === null) release = top;

  const mins = Math.floor(dur / 60);
  const secs = String(dur % 60).padStart(2, '0');
  const note =
    `initial climb ${pyFixed(gain * FT, 0)} ft in ${mins}m${secs}s ` +
    `at ${pyFixed(mspd, 0)} km/h mean ground speed`;

  return { takeoff: to, release, type, note, confident };
}
