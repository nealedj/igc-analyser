/**
 * Glider polars: a polynomial fit through (speed, sink) points, matched to the
 * glider-type header.
 *
 * Every airmass figure in the analysis depends on this, and the polars are
 * indicative rather than manufacturer-certified. Which polar was used, and on
 * what evidence, has to travel with any number derived from it.
 *
 * Three points give a quadratic and four give a cubic. The shipped database is
 * quadratic: measured against published polars a cubic derived from the same
 * summary figures is worse, not better, and `test/tools/make-polars.ts` has the
 * numbers. Four points are accepted because a custom polar taken off a real
 * measured curve has a shape a quadratic cannot hold, and because the fit
 * should not be the thing that stops it.
 *
 * Port of `Polar`, `solve3`, `load_polar` and `sigma`.
 */


/**
 * The published figures an entry's points are derived from.
 *
 * Two anchors, not one. Best glide alone pins the curve only if you also
 * assume where minimum sink sits relative to it, and that assumption is what
 * made the old database read 20% low at 150 km/h and worse above it. A
 * published point out at cruise speed replaces the assumption with a fact.
 */
export interface PublishedPolar {
  best_ld: number;
  best_ld_kmh: number;
  /** Published minimum sink. Not an input to the fit; the test checks it. */
  min_sink_ms: number;
  /** A published point at cruise speed: the second anchor. */
  fast_kmh: number;
  fast_sink_ms: number;
  /**
   * Wing loading the published figures are for, kg/m². Dry, at the all-up
   * weight the handbook polar was measured at. This is what the loading
   * override is a ratio against.
   */
  loading_kg_m2: number;
}

export interface PolarPoints {
  name: string;
  match?: string[];
  /**
   * Published figures for this type, carried so the database can be checked
   * against the glider it names rather than only against itself. See
   * `test/tools/make-polars.ts`, which derives `points` from them.
   */
  published?: PublishedPolar;
  /** Three or four (IAS km/h, sink m/s) pairs. Loosely typed: it is JSON. */
  points: number[][];
}

/** A database entry: a glider, so it must carry the keys it is matched on. */
export type PolarEntry = PolarPoints & { match: string[] };

export interface PolarDb {
  gliders: PolarEntry[];
  default: PolarPoints;
}

/** Solve an n x n system by Gauss-Jordan with partial pivoting. */
export function solveN(A: number[][], y: number[]): number[] {
  const n = y.length;
  const M = A.map((row, i) => [...row, y[i]]);
  for (let i = 0; i < n; i++) {
    // Python's max() keeps the first maximal element, so compare strictly.
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) throw new Error('degenerate polar points');
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  // Gauss-Jordan leaves the matrix diagonal, so each row is one unknown.
  return M.map((row, i) => row[n] / row[i]);
}

/** Solve a 3x3 system. Kept as its own name because the oracle has one. */
export function solve3(A: number[][], y: number[]): [number, number, number] {
  const [a, b, c] = solveN(A, y);
  return [a, b, c];
}

/**
 * Sink as a polynomial in equivalent airspeed, all SI.
 *
 * Three points give `a + b·v + c·v²` and four give a cubic. `a`, `b` and `c`
 * are the first three coefficients either way, so a quadratic reads the same
 * as it always did.
 */
export class Polar {
  readonly name: string;
  /** Polynomial coefficients, lowest order first. */
  readonly coef: readonly number[];

  constructor(name: string, points: number[][], loadingRatio = 1) {
    if (points.length < 3 || points.length > 4 || points.some((p) => p.length !== 2)) {
      throw new Error('a polar needs three or four (speed, sink) points');
    }
    this.name = name;
    const n = points.length;
    const p = points.map(([v, s]) => [v / 3.6, s] as const);
    const A = p.map(([v]) => Array.from({ length: n }, (_, k) => v ** k));
    const fitted = solveN(A, p.map(([, s]) => s));

    // Wing loading scales the whole curve: at k times the loading the glider
    // flies every point at sqrt(k) times the speed and sqrt(k) times the sink,
    // so s'(v) = sqrt(k)·s(v/sqrt(k)). On a polynomial that is one factor per
    // term, which is why the loading override is arithmetic rather than a refit.
    const r = Math.sqrt(loadingRatio);
    this.coef = fitted.map((k, i) => k * r ** (1 - i));
  }

  get a(): number {
    return this.coef[0];
  }
  get b(): number {
    return this.coef[1];
  }
  get c(): number {
    return this.coef[2];
  }

  /** Still-air sink, m/s, for an equivalent airspeed in m/s. */
  sink(eas: number): number {
    let s = 0;
    for (let i = this.coef.length - 1; i >= 0; i--) s = s * eas + this.coef[i];
    return s;
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

  /**
   * Minimum sink and the speed it happens at, m/s.
   *
   * Swept rather than solved, because a cubic's turning point is a quadratic
   * root and only one of the two is the one wanted. The step is the same as
   * `bestLd`'s, and nothing downstream needs it finer than that.
   */
  minSink(): { sink: number; speed: number | null } {
    let best = Infinity;
    let speed: number | null = null;
    let v = 15.0;
    while (v < 60) {
      const s = this.sink(v);
      if (s < best) {
        best = s;
        speed = v;
      }
      v += 0.1;
    }
    return { sink: best, speed };
  }
}

export interface PolarMatch {
  polar: Polar | null;
  /** How the polar was arrived at, for display next to any derived figure. */
  note: string;
  /** Whether the glider was actually recognised, or a generic was assumed. */
  matched: boolean;
  /** Wing loading the curve was published at, kg/m²; null where unknown. */
  referenceLoading: number | null;
  /** Loading the curve was scaled to, kg/m²; null when it was not scaled. */
  loading: number | null;
}

export interface LoadPolarOptions {
  /** Force a polar by name or match-key substring, or 'none' to disable. */
  force?: string;
  /** Custom polar as three or four (IAS km/h, sink m/s) pairs. */
  custom?: number[][];
  /**
   * Wing loading actually flown, kg/m². The polar is scaled from the loading
   * its published figures are for. Ignored where that reference is unknown,
   * which is any custom polar: without a reference there is no ratio.
   */
  loadingKgM2?: number;
}

/**
 * The published figures are dry, at club loading. Water, a heavy pilot or a
 * light one all move the curve, and by more than the choice between two
 * plausible polars does: a Duo Discus at 45 kg/m² against its published 37 is
 * flying 10% faster for 10% more sink everywhere, which is a bigger change to
 * every airmass figure than picking the wrong single-seater would be.
 */
function scaled(
  name: string,
  points: number[][],
  published: PublishedPolar | undefined,
  wanted: number | undefined,
): { polar: Polar; note: string; referenceLoading: number | null; loading: number | null } {
  const reference = published?.loading_kg_m2 ?? null;
  if (wanted === undefined || reference === null) {
    return { polar: new Polar(name, points), note: '', referenceLoading: reference, loading: null };
  }
  if (!(wanted > 0)) throw new Error('wing loading must be positive');
  return {
    polar: new Polar(name, points, wanted / reference),
    note:
      `, scaled from ${fmt1(reference)} to ${fmt1(wanted)} kg/m²` +
      ` (${fmt1((100 * wanted) / reference)}% of the published loading)`,
    referenceLoading: reference,
    loading: wanted,
  };
}

const fmt1 = (x: number): string => (Math.round(x * 10) / 10).toString();

export function loadPolar(
  db: PolarDb,
  gliderType: string | undefined,
  opts: LoadPolarOptions = {},
): PolarMatch {
  if (opts.custom) {
    // A custom polar is whatever curve was handed in, at whatever loading it
    // was measured at. There is no reference to scale from, so there is no
    // scaling - saying so beats silently applying a ratio to an unknown.
    return {
      polar: new Polar('custom', opts.custom),
      note:
        'custom polar supplied' +
        (opts.loadingKgM2 === undefined
          ? ''
          : '; the loading override does not apply to it, because a custom curve does ' +
            'not say what loading it is for'),
      matched: true,
      referenceLoading: null,
      loading: null,
    };
  }
  const force = opts.force;
  if (force && force.toLowerCase() === 'none') {
    return {
      polar: null,
      note: 'polar disabled - no airmass analysis',
      matched: false,
      referenceLoading: null,
      loading: null,
    };
  }
  if (force) {
    const f = force.toLowerCase();
    for (const g of db.gliders) {
      if (g.name.toLowerCase().includes(f) || g.match.some((m) => m.includes(f))) {
        const s = scaled(g.name, g.points, g.published, opts.loadingKgM2);
        return {
          polar: s.polar,
          note: `polar forced to ${g.name}${s.note}`,
          matched: true,
          referenceLoading: s.referenceLoading,
          loading: s.loading,
        };
      }
    }
  }
  // Longest match wins, not first. The oracle takes the first entry whose key
  // is a substring of the glider type, which makes the result depend on the
  // order of the database: 'Duo Discus' hits the single-seat Discus, because
  // its key 'discus' appears earlier in the file than 'duo discus' does. See
  // DIVERGENCE.md (polar matched by first key rather than longest).
  const squash = (s: string) => s.replace(/-/g, '').replace(/ /g, '');
  const t = squash((gliderType ?? '').toLowerCase());
  let best: { glider: (typeof db.gliders)[number]; key: string } | null = null;
  for (const g of db.gliders) {
    for (const m of g.match) {
      const key = squash(m);
      if (t.includes(key) && (best === null || key.length > best.key.length)) {
        best = { glider: g, key };
      }
    }
  }
  if (best) {
    const s = scaled(best.glider.name, best.glider.points, best.glider.published, opts.loadingKgM2);
    return {
      polar: s.polar,
      note: `polar matched to ${best.glider.name} from the glider-type header${s.note}`,
      matched: true,
      referenceLoading: s.referenceLoading,
      loading: s.loading,
    };
  }
  const d = db.default;
  const s = scaled(d.name, d.points, d.published, opts.loadingKgM2);
  return {
    polar: s.polar,
    note:
      `no polar match for ${gliderType === undefined ? 'None' : `'${gliderType}'`}; ` +
      `using a ${d.name}${s.note} - treat airmass figures as indicative only`,
    matched: false,
    referenceLoading: s.referenceLoading,
    loading: s.loading,
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

