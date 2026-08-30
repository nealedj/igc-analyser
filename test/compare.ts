/**
 * Numeric comparison of the port's result against the oracle's JSON.
 *
 * The oracle is the specification, so the walk is driven by its structure:
 * every value it produces must be reproduced. Values the port adds on top are
 * ignored here — they are covered by the port's own unit tests.
 */

import { isDivergent } from './divergence.ts';

/** Relative tolerance, for IEEE-754 drift between two languages only. */
export const TOL = 1e-9;

export interface Mismatch {
  path: string;
  oracle: unknown;
  port: unknown;
}

export function compare(oracle: unknown, port: unknown, fixture: string): Mismatch[] {
  const out: Mismatch[] = [];
  walk('', oracle, port);
  return out;

  function walk(path: string, a: unknown, b: unknown): void {
    if (path && isDivergent(fixture, path.replace(/^\./, ''))) return;
    const p = path || '<root>';

    if (a === null || b === null || a === undefined || b === undefined) {
      if (a !== b) out.push({ path: p, oracle: a, port: b });
      return;
    }
    if (typeof a === 'number' && typeof b === 'number') {
      const scale = Math.max(1, Math.abs(a), Math.abs(b));
      if (Math.abs(a - b) / scale > TOL) out.push({ path: p, oracle: a, port: b });
      return;
    }
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) return void out.push({ path: p, oracle: 'array', port: typeof b });
      if (a.length !== b.length) {
        return void out.push({ path: `${p}.length`, oracle: a.length, port: b.length });
      }
      a.forEach((x, i) => walk(`${path}[${i}]`, x, b[i]));
      return;
    }
    if (typeof a === 'object') {
      if (typeof b !== 'object' || Array.isArray(b)) {
        return void out.push({ path: p, oracle: 'object', port: typeof b });
      }
      for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
        const rec = b as Record<string, unknown>;
        if (!(k in rec)) {
          if (!isDivergent(fixture, `${path}.${k}`.replace(/^\./, ''))) {
            out.push({ path: `${p}.${k}`, oracle: v, port: '<missing>' });
          }
          continue;
        }
        walk(`${path}.${k}`, v, rec[k]);
      }
      return;
    }
    if (a !== b) out.push({ path: p, oracle: a, port: b });
  }
}
