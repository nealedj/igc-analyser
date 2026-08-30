/**
 * Circling versus straight-flight classification.
 *
 * A fix is circling when its smoothed turn rate exceeds the threshold. Short
 * runs are then absorbed into their neighbours, so a single noisy fix in the
 * middle of a cruise does not become a one-fix "climb" and a brief wings-level
 * moment does not split one thermal into two.
 *
 * Port of `segment` and `runs`.
 */

import type { Fix, Run } from './types.ts';

/** Maximal stretches of fixes sharing a phase. `b` is inclusive. */
export function runs(F: Fix[]): Run[] {
  const out: Run[] = [];
  let s = 0;
  for (let i = 1; i <= F.length; i++) {
    if (i === F.length || F[i].circ !== F[s].circ) {
      out.push({ a: s, b: i - 1, circ: F[s].circ });
      s = i;
    }
  }
  return out;
}

export function segment(F: Fix[], rateThresh = 6.0, minRun = 25): Run[] {
  for (const f of F) f.circ = Math.abs(f.trs) > rateThresh;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    // The run list is a snapshot: flips made during this pass are not seen
    // until the next one, exactly as in the Python.
    for (const { a, b, circ } of runs(F)) {
      if (F[b].t - F[a].t < minRun) {
        for (let j = a; j <= b; j++) F[j].circ = !circ;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return runs(F);
}
