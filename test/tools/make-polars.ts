/**
 * Generate `src/data/polars.json` from published figures.
 *
 * The app models a polar as a polynomial in equivalent airspeed, fitted
 * through the points stored per glider. The points are derived here rather
 * than chosen by eye, because points chosen by eye do not reproduce the
 * glider they are named after: the file this replaced gave a PIK-20D 47:1 and
 * a Standard Cirrus 43:1 against published figures of 41 and 36.5.
 *
 * ## Two anchors, not one
 *
 * A quadratic has three coefficients, and best glide supplies two constraints:
 * the ratio, and the fact that the origin's tangent touches the curve there.
 * The third has to come from somewhere. It used to come from an assumption -
 * that minimum sink sits at 0.75 of best-glide speed for every glider - and
 * that assumption is what was wrong. It sets the curvature, curvature is what
 * high-speed sink is made of, and the error is all at the fast end where it
 * does the most damage: a final glide at 160 km/h is exactly where the airmass
 * figure gets read.
 *
 * Measured against published polars for the types in this file, the old curves
 * came out:
 *
 * | speed | mean error | worst |
 * | --- | --- | --- |
 * | below 110 km/h | −2% | −7% |
 * | 110–150 km/h | −6% | −23% |
 * | 150 km/h and above | −13% | −41% |
 *
 * Systematically low, and low means the air reads better than it was. So the
 * third constraint is now a published point out at cruise speed - `fast_kmh`
 * and `fast_sink_ms` - which drops the same comparison to about 4% mean and
 * takes the bias out. Published minimum sink stays in the block, no longer as
 * an input but as the check: the tests fail an entry whose fitted curve puts
 * minimum sink somewhere a glider would not.
 *
 * ## Why not a cubic
 *
 * `Polar` will fit one, and for a custom polar taken off a measured curve it
 * is the right thing. Deriving one here is not. A cubic needs a fourth
 * constraint, and the only ones available are the published minimum sink and
 * its slope; pinning all four onto a cubic makes it bend hard between the
 * anchors and run away outside them. Measured the same way, a cubic derived
 * like that misbehaved - sink negative at low speed, or climbing without bound
 * above about 200 km/h - on eleven of the sixteen types that could be checked,
 * and its mean error at 150 km/h and above was +88% against the quadratic's
 * 4%. The quadratic is not the problem. The missing second anchor was.
 *
 * ## The arithmetic
 *
 * For `s(v) = a + b·v + c·v²` the tangent from the origin touches at
 * `v_bg = sqrt(a/c)`, so `a = c·v_bg²` and `s_bg = 2a + b·v_bg`. Adding the
 * published fast point `s(v_f) = s_f` closes it:
 *
 *   c = (s_f − v_f·s_bg/v_bg) / (v_f − v_bg)²
 *   a = c·v_bg²
 *   b = s_bg/v_bg − 2·c·v_bg
 *
 * Minimum sink then falls out at `v_ms = −b/(2c)` instead of being assumed.
 *
 * ## Where the quadratic runs out
 *
 * A quadratic forces `s_min / s_bg = (1 + r) / 2` with `r = v_ms / v_bg`, and
 * that is a real constraint, not an artefact of how the curve is anchored. For
 * the open-class 25 m ships it cannot be met: 57:1 puts best-glide sink at
 * 0.58 m/s, and a published minimum sink of 0.45 would need `r = 0.57`, which
 * is minimum sink at 68 km/h - below the speed the glider will fly at. Their
 * real polars are peakier than a parabola, so the fit takes best glide and the
 * cruise range and reads minimum sink about 20% high. `POLAR_PEAKY` in
 * `test/polar-model.test.ts` names them, so a new entry cannot join them
 * quietly. The cruise range, where every airmass figure is computed, is the
 * part that is right for all of them.
 *
 * ## The figures
 *
 * Indicative published values at typical club loading, dry. Handbook and
 * Idaflieg numbers vary by a point either way with loading, span option and
 * whose measurement you take. They are not manufacturer-certified and the app
 * says so wherever it shows anything derived from them.
 *
 * Run with `npm run make-polars`. `npm test` re-derives every curve from the
 * `published` block committed alongside it, so a hand-edited point that no
 * longer sits on its glider's curve fails.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data', 'polars.json');

export interface Published {
  /** Best glide ratio, dry, at `loading_kg_m2`. */
  best_ld: number;
  /** The speed it happens at, IAS km/h. */
  best_ld_kmh: number;
  /** Published minimum sink, m/s. Checked against, not fitted to. */
  min_sink_ms: number;
  /** A published point at cruise speed: the second anchor. */
  fast_kmh: number;
  fast_sink_ms: number;
  /** Wing loading the figures are for, kg/m², dry. */
  loading_kg_m2: number;
}

interface Entry {
  name: string;
  match: string[];
  published: Published;
}

const GLIDERS: Entry[] = [
  { name: 'ASK 13', match: ['ask13', 'ask 13', 'k-13', 'k13'],
    published: { best_ld: 27, best_ld_kmh: 80, min_sink_ms: 0.79, fast_kmh: 135, fast_sink_ms: 2.07, loading_kg_m2: 26 } },
  { name: 'ASK 21', match: ['ask21', 'ask 21', 'k-21', 'k21'],
    published: { best_ld: 34, best_ld_kmh: 90, min_sink_ms: 0.68, fast_kmh: 135, fast_sink_ms: 1.59, loading_kg_m2: 26 } },
  { name: 'Grob G103 Twin Astir', match: ['twin astir', 'g103', 'g-103', 'twin ii', 'twin iii', 'twin 3'],
    published: { best_ld: 38, best_ld_kmh: 100, min_sink_ms: 0.70, fast_kmh: 180, fast_sink_ms: 2.85, loading_kg_m2: 33 } },
  { name: 'Grob G102 Astir CS', match: ['astir cs', 'g102', 'g-102', 'astir'],
    published: { best_ld: 36, best_ld_kmh: 95, min_sink_ms: 0.66, fast_kmh: 160, fast_sink_ms: 2.30, loading_kg_m2: 27 } },
  { name: 'SZD-50 Puchacz', match: ['puchacz', 'szd-50', 'szd50'],
    published: { best_ld: 30, best_ld_kmh: 85, min_sink_ms: 0.80, fast_kmh: 135, fast_sink_ms: 1.84, loading_kg_m2: 24 } },
  { name: 'SZD-51 Junior', match: ['junior', 'szd-51', 'szd51'],
    published: { best_ld: 35, best_ld_kmh: 90, min_sink_ms: 0.62, fast_kmh: 150, fast_sink_ms: 2.20, loading_kg_m2: 27 } },
  { name: 'Schleicher K8', match: ['k8', 'k-8', 'ka8', 'ka-8'],
    published: { best_ld: 26, best_ld_kmh: 72, min_sink_ms: 0.72, fast_kmh: 130, fast_sink_ms: 2.46, loading_kg_m2: 21 } },
  { name: 'Standard Cirrus', match: ['cirrus'],
    published: { best_ld: 36.5, best_ld_kmh: 95, min_sink_ms: 0.60, fast_kmh: 165, fast_sink_ms: 2.26, loading_kg_m2: 33 } },
  { name: 'PIK-20D', match: ['pik-20', 'pik20', 'pik 20'],
    published: { best_ld: 41, best_ld_kmh: 100, min_sink_ms: 0.57, fast_kmh: 185, fast_sink_ms: 2.79, loading_kg_m2: 35 } },
  { name: 'LS4', match: ['ls4', 'ls-4'],
    published: { best_ld: 40.5, best_ld_kmh: 100, min_sink_ms: 0.60, fast_kmh: 160, fast_sink_ms: 1.75, loading_kg_m2: 34 } },
  { name: 'Discus', match: ['discus 2', 'discus2', 'discus'],
    published: { best_ld: 42.5, best_ld_kmh: 100, min_sink_ms: 0.59, fast_kmh: 160, fast_sink_ms: 1.70, loading_kg_m2: 33 } },
  { name: 'Duo Discus', match: ['duo discus', 'duo'],
    published: { best_ld: 45, best_ld_kmh: 105, min_sink_ms: 0.61, fast_kmh: 170, fast_sink_ms: 1.65, loading_kg_m2: 37 } },
  { name: 'ASW 19', match: ['asw19', 'asw 19'],
    published: { best_ld: 38, best_ld_kmh: 95, min_sink_ms: 0.60, fast_kmh: 175, fast_sink_ms: 2.27, loading_kg_m2: 33 } },
  { name: 'ASW 20', match: ['asw20', 'asw 20'],
    published: { best_ld: 42.5, best_ld_kmh: 105, min_sink_ms: 0.58, fast_kmh: 190, fast_sink_ms: 2.40, loading_kg_m2: 36 } },
  { name: 'ASW 24', match: ['asw24', 'asw 24'],
    published: { best_ld: 42.5, best_ld_kmh: 100, min_sink_ms: 0.58, fast_kmh: 165, fast_sink_ms: 1.73, loading_kg_m2: 35 } },
  { name: 'ASW 27', match: ['asw27', 'asw 27'],
    published: { best_ld: 48, best_ld_kmh: 105, min_sink_ms: 0.55, fast_kmh: 170, fast_sink_ms: 1.61, loading_kg_m2: 38 } },
  { name: 'ASW 28 (15 m)', match: ['asw28', 'asw 28'],
    published: { best_ld: 45, best_ld_kmh: 100, min_sink_ms: 0.55, fast_kmh: 148, fast_sink_ms: 1.39, loading_kg_m2: 30 } },
  { name: 'ASG 29 (18 m)', match: ['asg29', 'asg 29'],
    published: { best_ld: 52, best_ld_kmh: 105, min_sink_ms: 0.51, fast_kmh: 185, fast_sink_ms: 2.00, loading_kg_m2: 34 } },
  { name: 'Ventus (15 m)', match: ['ventus'],
    published: { best_ld: 46, best_ld_kmh: 105, min_sink_ms: 0.55, fast_kmh: 175, fast_sink_ms: 1.90, loading_kg_m2: 36 } },
  { name: 'LAK-17 (18 m)', match: ['lak-17', 'lak17'],
    published: { best_ld: 50, best_ld_kmh: 108, min_sink_ms: 0.52, fast_kmh: 180, fast_sink_ms: 2.00, loading_kg_m2: 33 } },
  { name: 'JS1 (18 m)', match: ['js1', 'js-1'],
    published: { best_ld: 52, best_ld_kmh: 110, min_sink_ms: 0.50, fast_kmh: 175, fast_sink_ms: 1.58, loading_kg_m2: 36 } },
  { name: 'DG-1000 (20 m)', match: ['dg-1000', 'dg1000'],
    published: { best_ld: 46, best_ld_kmh: 105, min_sink_ms: 0.58, fast_kmh: 180, fast_sink_ms: 2.40, loading_kg_m2: 35 } },
  { name: 'DG-505 (20 m)', match: ['dg-505', 'dg505'],
    published: { best_ld: 43, best_ld_kmh: 105, min_sink_ms: 0.60, fast_kmh: 165, fast_sink_ms: 1.75, loading_kg_m2: 36 } },
  { name: 'Nimbus (25 m)', match: ['nimbus'],
    published: { best_ld: 57, best_ld_kmh: 120, min_sink_ms: 0.45, fast_kmh: 190, fast_sink_ms: 2.10, loading_kg_m2: 32 } },
  { name: 'ASH 25 (25 m)', match: ['ash25', 'ash 25'],
    published: { best_ld: 57, best_ld_kmh: 120, min_sink_ms: 0.45, fast_kmh: 190, fast_sink_ms: 2.10, loading_kg_m2: 40 } },
  { name: 'Perkoz', match: ['perkoz', 'szd-54', 'szd54'],
    published: { best_ld: 36, best_ld_kmh: 100, min_sink_ms: 0.65, fast_kmh: 165, fast_sink_ms: 2.30, loading_kg_m2: 32 } },
  { name: 'Grob G109 / motorglider', match: ['g109', 'g-109', 'motorglider', 'falke', 'dimona'],
    published: { best_ld: 26, best_ld_kmh: 95, min_sink_ms: 0.85, fast_kmh: 160, fast_sink_ms: 2.83, loading_kg_m2: 44 } },
];

const DEFAULT: Entry = {
  name: 'generic 38:1 glass single-seater',
  match: [],
  published: { best_ld: 38, best_ld_kmh: 98, min_sink_ms: 0.62, fast_kmh: 165, fast_sink_ms: 2.05, loading_kg_m2: 33 },
};

/** The quadratic that reproduces the published anchors. All SI. See above. */
export function coefficients(p: Published): { a: number; b: number; c: number } {
  const vbg = p.best_ld_kmh / 3.6;
  const sbg = vbg / p.best_ld;
  const vf = p.fast_kmh / 3.6;
  const c = (p.fast_sink_ms - (vf * sbg) / vbg) / (vf - vbg) ** 2;
  return { a: c * vbg * vbg, b: sbg / vbg - 2 * c * vbg, c };
}

/**
 * Three points on that curve: at minimum sink, at best glide, and at the
 * published fast point. Speeds are whole km/h and sinks are three decimals, so
 * the file stays readable and the re-fit stays within a thousandth of the
 * curve it came from.
 *
 * They span the range a leg is actually flown in, which matters because the
 * re-fit is exact only at the points and the rounding error grows outside
 * them. Minimum sink is where it lands, not where it was assumed to be.
 */
export function points(p: Published): number[][] {
  const { a, b, c } = coefficients(p);
  const sink = (kmh: number): number => {
    const v = kmh / 3.6;
    return Number((a + b * v + c * v * v).toFixed(3));
  };
  const speeds = [
    Math.round((-b / (2 * c)) * 3.6),
    Math.round(p.best_ld_kmh),
    Math.round(p.fast_kmh),
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
    'editing points by hand. Each entry: the published figures it is derived from, and ' +
    'three (IAS km/h, sink m/s) points on the quadratic that reproduces them, fitted at ' +
    'runtime. The curve is anchored at two published places - best glide, and a point out ' +
    'at cruise speed - because best glide alone leaves the curvature to an assumption, and ' +
    'the curvature is what high-speed sink is made of. Match keys are lowercase substrings ' +
    'tested against the HFGTY glider-type header; the longest match wins. Figures are ' +
    'indicative values at the stated wing loading, dry, not manufacturer-certified: a ' +
    'glider flying wet, heavy or buggy reads worse, and the page has a loading override ' +
    'for the first two. Always caveat derived airmass figures.',
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
