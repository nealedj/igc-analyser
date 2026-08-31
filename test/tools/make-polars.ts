/**
 * Generate `src/data/polars.json` from published best-glide figures.
 *
 * The app models a polar as a quadratic in equivalent airspeed, fitted through
 * three (speed, sink) points. Three points chosen by eye do not reproduce the
 * glider they are named after: the file this replaces gave a PIK-20D 47:1 and
 * a Standard Cirrus 43:1, against published figures of 41 and 36.5. Every
 * airmass figure in the analysis is measured against that curve, and the best
 * glide ratio is printed next to them, so the error was visible and wrong.
 *
 * So the points are derived rather than chosen. For a quadratic
 * `s(v) = a + b·v + c·v²` the best glide sits at `v_bg = sqrt(a/c)` with
 * `s_bg = 2a + b·v_bg`, which pins the curve given a target glide ratio, the
 * speed it happens at, and where minimum sink sits relative to it:
 *
 *   r = v_minsink / v_bg      chosen, not published - see below
 *   a = s_bg / (2(1 - r))     s_bg = v_bg / bestLD
 *   b = -2·a·r / v_bg
 *   c = a / v_bg²
 *
 * `r` is fixed at 0.75 for every glider. It cannot come from the published
 * minimum sink: a quadratic forces `s_min / s_bg = (1 + r) / 2`, and real
 * polars are peakier than that. Solving for `r` from a published minimum sink
 * therefore skews the curve badly at speed - for an ASK 13 it puts sink at
 * 130 km/h at 3.3 m/s against a real 1.9. Fixing `r` at a realistic ratio
 * instead keeps the cruise range honest, which is the range every airmass
 * figure is computed in, and leaves minimum sink within about 15%.
 *
 * Run with `npm run make-polars`. `npm test` re-derives every curve from the
 * `published` block committed alongside it, so a hand-edited point that no
 * longer matches its own glider fails.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data', 'polars.json');

/** Where minimum sink sits as a fraction of best-glide speed. See above. */
export const MIN_SINK_RATIO = 0.75;

export interface Published {
  /** Best glide ratio, dry, at the loading in `loading`. */
  best_ld: number;
  /** The speed it happens at, IAS km/h. */
  best_ld_kmh: number;
  /** Published minimum sink, m/s. Carried for reference; see the note above. */
  min_sink_ms: number;
}

interface Entry {
  name: string;
  match: string[];
  published: Published;
}

/**
 * Indicative published figures at typical club loading, dry. Handbook and
 * Idaflieg numbers vary by a point either way with loading, span option and
 * whose measurement you take; these are the commonly quoted ones, rounded.
 * Where a type spans several wingspans the entry says which it is, because a
 * 15 m ASG 29 and an 18 m one are four points of glide apart.
 */
const GLIDERS: Entry[] = [
  { name: 'ASK 13', match: ['ask13', 'ask 13', 'k-13', 'k13'],
    published: { best_ld: 27, best_ld_kmh: 80, min_sink_ms: 0.79 } },
  { name: 'ASK 21', match: ['ask21', 'ask 21', 'k-21', 'k21'],
    published: { best_ld: 34, best_ld_kmh: 95, min_sink_ms: 0.68 } },
  { name: 'Grob G103 Twin Astir', match: ['twin astir', 'g103', 'g-103', 'twin ii', 'twin iii', 'twin 3'],
    published: { best_ld: 38, best_ld_kmh: 100, min_sink_ms: 0.70 } },
  { name: 'Grob G102 Astir CS', match: ['astir cs', 'g102', 'g-102', 'astir'],
    published: { best_ld: 36, best_ld_kmh: 95, min_sink_ms: 0.66 } },
  { name: 'SZD-50 Puchacz', match: ['puchacz', 'szd-50', 'szd50'],
    published: { best_ld: 30, best_ld_kmh: 90, min_sink_ms: 0.80 } },
  { name: 'SZD-51 Junior', match: ['junior', 'szd-51', 'szd51'],
    published: { best_ld: 35, best_ld_kmh: 92, min_sink_ms: 0.62 } },
  { name: 'Schleicher K8', match: ['k8', 'k-8', 'ka8', 'ka-8'],
    published: { best_ld: 26, best_ld_kmh: 72, min_sink_ms: 0.72 } },
  { name: 'Standard Cirrus', match: ['cirrus'],
    published: { best_ld: 36.5, best_ld_kmh: 95, min_sink_ms: 0.60 } },
  { name: 'PIK-20D', match: ['pik-20', 'pik20', 'pik 20'],
    published: { best_ld: 41, best_ld_kmh: 108, min_sink_ms: 0.57 } },
  { name: 'LS4', match: ['ls4', 'ls-4'],
    published: { best_ld: 40.5, best_ld_kmh: 100, min_sink_ms: 0.60 } },
  { name: 'Discus', match: ['discus 2', 'discus2', 'discus'],
    published: { best_ld: 42.5, best_ld_kmh: 105, min_sink_ms: 0.59 } },
  { name: 'Duo Discus', match: ['duo discus', 'duo'],
    published: { best_ld: 45, best_ld_kmh: 110, min_sink_ms: 0.61 } },
  { name: 'ASW 19', match: ['asw19', 'asw 19'],
    published: { best_ld: 38, best_ld_kmh: 95, min_sink_ms: 0.60 } },
  { name: 'ASW 20', match: ['asw20', 'asw 20'],
    published: { best_ld: 42.5, best_ld_kmh: 110, min_sink_ms: 0.58 } },
  { name: 'ASW 24', match: ['asw24', 'asw 24'],
    published: { best_ld: 42.5, best_ld_kmh: 105, min_sink_ms: 0.58 } },
  { name: 'ASW 27', match: ['asw27', 'asw 27'],
    published: { best_ld: 48, best_ld_kmh: 115, min_sink_ms: 0.55 } },
  { name: 'ASW 28 (15 m)', match: ['asw28', 'asw 28'],
    published: { best_ld: 45, best_ld_kmh: 110, min_sink_ms: 0.55 } },
  { name: 'ASG 29 (18 m)', match: ['asg29', 'asg 29'],
    published: { best_ld: 52, best_ld_kmh: 120, min_sink_ms: 0.51 } },
  { name: 'Ventus (15 m)', match: ['ventus'],
    published: { best_ld: 46, best_ld_kmh: 112, min_sink_ms: 0.55 } },
  { name: 'LAK-17 (18 m)', match: ['lak-17', 'lak17'],
    published: { best_ld: 50, best_ld_kmh: 118, min_sink_ms: 0.52 } },
  { name: 'JS1 (18 m)', match: ['js1', 'js-1'],
    published: { best_ld: 52, best_ld_kmh: 120, min_sink_ms: 0.50 } },
  { name: 'DG-1000 (20 m)', match: ['dg-1000', 'dg1000'],
    published: { best_ld: 46, best_ld_kmh: 115, min_sink_ms: 0.58 } },
  { name: 'DG-505 (20 m)', match: ['dg-505', 'dg505'],
    published: { best_ld: 43, best_ld_kmh: 108, min_sink_ms: 0.60 } },
  { name: 'Nimbus (25 m)', match: ['nimbus'],
    published: { best_ld: 57, best_ld_kmh: 120, min_sink_ms: 0.45 } },
  { name: 'ASH 25 (25 m)', match: ['ash25', 'ash 25'],
    published: { best_ld: 57, best_ld_kmh: 120, min_sink_ms: 0.45 } },
  { name: 'Perkoz', match: ['perkoz', 'szd-54', 'szd54'],
    published: { best_ld: 36, best_ld_kmh: 100, min_sink_ms: 0.65 } },
  { name: 'Grob G109 / motorglider', match: ['g109', 'g-109', 'motorglider', 'falke', 'dimona'],
    published: { best_ld: 26, best_ld_kmh: 95, min_sink_ms: 0.85 } },
];

const DEFAULT: Entry = {
  name: 'generic 38:1 glass single-seater',
  match: [],
  published: { best_ld: 38, best_ld_kmh: 98, min_sink_ms: 0.62 },
};

/** The quadratic that reproduces a published best glide. All SI. */
export function coefficients(p: Published): { a: number; b: number; c: number } {
  const vbg = p.best_ld_kmh / 3.6;
  const sbg = vbg / p.best_ld;
  const a = sbg / (2 * (1 - MIN_SINK_RATIO));
  return { a, b: (-2 * a * MIN_SINK_RATIO) / vbg, c: a / (vbg * vbg) };
}

/**
 * Three points on that curve, at minimum sink, best glide and half again
 * best-glide speed - the range a cruise leg is actually flown in. Speeds are
 * whole km/h and sinks are three decimals, so the file stays readable and the
 * re-fit stays within a thousandth of the curve it came from.
 */
export function points(p: Published): number[][] {
  const { a, b, c } = coefficients(p);
  const sink = (kmh: number): number => {
    const v = kmh / 3.6;
    return Number((a + b * v + c * v * v).toFixed(3));
  };
  const speeds = [
    Math.round(p.best_ld_kmh * MIN_SINK_RATIO),
    Math.round(p.best_ld_kmh),
    Math.round(p.best_ld_kmh * 1.5),
  ];
  return speeds.map((v) => [v, sink(v)]);
}

const entry = (e: Entry): Record<string, unknown> => ({
  name: e.name,
  ...(e.match.length ? { match: e.match } : {}),
  published: e.published,
  points: points(e.published),
});

const db = {
  _comment:
    'Generated by test/tools/make-polars.ts - run `npm run make-polars` rather than ' +
    'editing points by hand. Each entry: the published best glide it is derived from, ' +
    'and three (IAS km/h, sink m/s) points on the quadratic that reproduces it, fitted ' +
    'at runtime. Match keys are lowercase substrings tested against the HFGTY ' +
    'glider-type header; the longest match wins. Figures are indicative values at ' +
    'typical club loading, dry, not manufacturer-certified: a glider flying wet, heavy ' +
    'or buggy reads worse. A quadratic cannot hold both the published best glide and ' +
    'the published minimum sink, so it is fitted to the first - minimum sink can read ' +
    'up to 15% out, and slow flight with it. Always caveat derived airmass figures.',
  gliders: GLIDERS.map(entry),
  default: entry(DEFAULT),
};

/** The database as it should be on disk. Exported so the tests can diff it. */
export const database = db;

// Importing this file must not rewrite the database: the test does exactly
// that to check the committed file still matches its own published figures.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(OUT, `${JSON.stringify(db, null, 1)}\n`);
  console.log(`wrote ${db.gliders.length + 1} polars to ${OUT}`);
}
