/**
 * Glider polars: a quadratic fit through three (speed, sink) points, matched
 * to the glider-type header.
 *
 * Every airmass figure in the analysis depends on this, and the polars are
 * indicative rather than manufacturer-certified. Which polar was used, and on
 * what evidence, has to travel with any number derived from it.
 *
 * Port of `Polar`, `solve3`, `load_polar` and `sigma`.
 */


export interface PolarPoints {
  name: string;
  match?: string[];
  /** Three (IAS km/h, sink m/s) pairs. Loosely typed: this comes from JSON. */
  points: number[][];
}

export interface PolarDb {
  gliders: Required<PolarPoints>[];
  default: PolarPoints;
}

/** Solve a 3x3 system by Gauss-Jordan with partial pivoting. */
export function solve3(A: number[][], y: number[]): [number, number, number] {
  const M = A.map((row, i) => [...row, y[i]]);
  for (let i = 0; i < 3; i++) {
    // Python's max() keeps the first maximal element, so compare strictly.
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) throw new Error('degenerate polar points');
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/** Sink as a quadratic in equivalent airspeed: `a + b·v + c·v²`, all SI. */
export class Polar {
  readonly name: string;
  readonly a: number;
  readonly b: number;
  readonly c: number;

  constructor(name: string, points: number[][]) {
    if (points.length !== 3 || points.some((p) => p.length !== 2)) {
      throw new Error('a polar needs exactly three (speed, sink) points');
    }
    this.name = name;
    const p = points.map(([v, s]) => [v / 3.6, s] as const);
    const [[v1, s1], [v2, s2], [v3, s3]] = p;
    const A = [
      [1, v1, v1 * v1],
      [1, v2, v2 * v2],
      [1, v3, v3 * v3],
    ];
    [this.a, this.b, this.c] = solve3(A, [s1, s2, s3]);
  }

  /** Still-air sink, m/s, for an equivalent airspeed in m/s. */
  sink(eas: number): number {
    return this.a + this.b * eas + this.c * eas * eas;
  }

  /** Best glide ratio and the speed it happens at, m/s. */
  bestLd(): { ld: number; speed: number | null } {
    let ld = 0;
    let speed: number | null = null;
    let v = 15.0;
    while (v < 60) {
      const s = this.sink(v);
      if (s > 0 && v / s > ld) {
        ld = v / s;
        speed = v;
      }
      v += 0.1;
    }
    return { ld, speed };
  }
}

export interface PolarMatch {
  polar: Polar | null;
  /** How the polar was arrived at, for display next to any derived figure. */
  note: string;
  /** Whether the glider was actually recognised, or a generic was assumed. */
  matched: boolean;
}

export interface LoadPolarOptions {
  /** Force a polar by name or match-key substring, or 'none' to disable. */
  force?: string;
  /** Custom polar as three (IAS km/h, sink m/s) pairs. */
  custom?: number[][];
}

export function loadPolar(
  db: PolarDb,
  gliderType: string | undefined,
  opts: LoadPolarOptions = {},
): PolarMatch {
  if (opts.custom) {
    return { polar: new Polar('custom', opts.custom), note: 'custom polar supplied', matched: true };
  }
  const force = opts.force;
  if (force && force.toLowerCase() === 'none') {
    return { polar: null, note: 'polar disabled - no airmass analysis', matched: false };
  }
  if (force) {
    const f = force.toLowerCase();
    for (const g of db.gliders) {
      if (g.name.toLowerCase().includes(f) || g.match.some((m) => m.includes(f))) {
        return {
          polar: new Polar(g.name, g.points),
          note: `polar forced to ${g.name}`,
          matched: true,
        };
      }
    }
  }
  const squash = (s: string) => s.replace(/-/g, '').replace(/ /g, '');
  const t = squash((gliderType ?? '').toLowerCase());
  for (const g of db.gliders) {
    for (const m of g.match) {
      if (t.includes(squash(m))) {
        return {
          polar: new Polar(g.name, g.points),
          note: `polar matched to ${g.name} from the glider-type header`,
          matched: true,
        };
      }
    }
  }
  const d = db.default;
  return {
    polar: new Polar(d.name, d.points),
    note:
      `no polar match for ${gliderType === undefined ? 'None' : `'${gliderType}'`}; ` +
      `using a ${d.name} - treat airmass figures as indicative only`,
    matched: false,
  };
}

/**
 * Density ratio at a height, from the ISA, floored at 0.3.
 *
 * The base goes negative above about 44,330 m, where the oracle raises and a
 * bare `**` here would return NaN. No glider goes there, but a NaN would
 * propagate silently through every airmass figure on the flight, so the base
 * is clamped and the floor does the rest.
 */
export function sigma(hM: number): number {
  return Math.max(0.3, Math.max(0, 1 - 2.25577e-5 * hM) ** 4.256);
}

