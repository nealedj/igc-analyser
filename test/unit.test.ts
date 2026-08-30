/**
 * Unit tests for the parts that are fiddly enough to get wrong quietly, and
 * that a whole-file golden comparison would not localise.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dm, parseB, parseIgc, chooseAltitude } from '../src/core/parse.ts';
import { wrap, addKinematics } from '../src/core/kinematics.ts';
import { mean, median, pstdev, pyFixed, pyMod, pyRound } from '../src/core/pyutil.ts';
import { Polar, loadPolar, sigma, solve3 } from '../src/core/polar.ts';
import type { PolarDb } from '../src/core/polar.ts';
import realPolars from '../src/data/polars.json' with { type: 'json' };

const REAL_DB = realPolars as PolarDb;

// ------------------------------------------------ DDMMmmm coordinate parsing

test('dm decodes degrees, minutes and thousandths of a minute', () => {
  // 51 deg 43.108 min = 51 + 43.108/60
  assert.equal(dm('5143108', 2, 'N'), 51 + 43.108 / 60);
  assert.equal(dm('00250575', 3, 'E'), 2 + 50.575 / 60);
});

test('dm negates in the southern and western hemispheres', () => {
  assert.equal(dm('5143108', 2, 'S'), -(51 + 43.108 / 60));
  assert.equal(dm('00250575', 3, 'W'), -(2 + 50.575 / 60));
});

test('dm keeps three-digit longitude degrees distinct from minutes', () => {
  // 179 deg 59.999 min, the case where a two-digit read would silently work.
  assert.ok(Math.abs(dm('17959999', 3, 'E') - (179 + 59.999 / 60)) < 1e-12);
});

test('dm rejects non-numeric fields rather than coercing them', () => {
  assert.throws(() => dm('51431XX', 2, 'N'));
});

test('parseB reads a minimal 35-character B record', () => {
  const f = parseB('B1508535143108N00250575WA0000000220');
  assert.ok(f);
  assert.equal(f.t, 15 * 3600 + 8 * 60 + 53);
  assert.equal(f.palt, 0);
  assert.equal(f.galt, 220);
  assert.equal(f.valid, true);
});

test('parseB reports a 2D fix as invalid but still returns it', () => {
  const f = parseB('B1508535143108N00250575WV0000000220');
  assert.equal(f?.valid, false);
});

test('parseB rejects short records and the null island', () => {
  assert.equal(parseB('B150853514310'), null);
  assert.equal(parseB('B1508530000000N00000000EA0000000220'), null);
});

test('parseB reads a negative pressure altitude', () => {
  const f = parseB('B1508535143108N00250575WA-005000220');
  assert.equal(f?.palt, -50);
});

// ------------------------------------------------------- midnight rollover

/** A trace of `n` fixes at one-second intervals starting at `start`. */
function trace(start: number, n: number): string {
  const L = ['AXGD001', 'HFDTE211221', 'HFGTYGLIDERTYPE:ASK 21'];
  for (let i = 0; i < n; i++) {
    const s = (start + i) % 86400;
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    L.push(`B${hh}${mm}${ss}5143108N00250575WA00500${String(500 + i).padStart(5, '0')}`);
  }
  return L.join('\r\n');
}

test('B-record times unwrap across midnight into one continuous flight', () => {
  const { fixes } = parseIgc(trace(86400 - 30, 60));
  assert.equal(fixes.length, 60);
  assert.equal(fixes[0].t, 86370);
  // 30 seconds before midnight plus 30 after, with no jump anywhere.
  assert.equal(fixes[59].t, 86429);
  for (let i = 1; i < fixes.length; i++) {
    assert.equal(fixes[i].t - fixes[i - 1].t, 1, `gap at fix ${i}`);
  }
});

test('a trace that does not cross midnight is left alone', () => {
  const { fixes } = parseIgc(trace(12 * 3600, 20));
  assert.equal(fixes[0].t, 12 * 3600);
  assert.equal(fixes[19].t, 12 * 3600 + 19);
});

test('two rollovers still produce a monotonic sequence', () => {
  // Pathological, but nothing downstream should have to assume otherwise.
  const { fixes } = parseIgc(trace(86400 - 5, 86400 + 10));
  for (let i = 1; i < fixes.length; i++) {
    assert.ok(fixes[i].t > fixes[i - 1].t, `not increasing at fix ${i}`);
  }
});

// -------------------------------------------------------- heading wrap

test('wrap folds bearings into [-180, 180)', () => {
  assert.equal(wrap(0), 0);
  assert.equal(wrap(90), 90);
  // The half-turn belongs to the negative end, as it does in the oracle:
  // both +180 and -180 come back as -180.
  assert.equal(wrap(180), -180);
  assert.equal(wrap(-180), -180);
  assert.equal(wrap(270), -90);
  assert.equal(wrap(-270), 90);
});

test('wrap takes the short way round the 360 boundary', () => {
  // 359 -> 1 is a 2 degree right turn, not a 358 degree left one.
  assert.equal(wrap(1 - 359), 2);
  assert.equal(wrap(359 - 1), -2);
});

test('turn rate stays finite and small across the 360 boundary', () => {
  // A steady right-hand circle crossing north.
  const L = ['AXGD001', 'HFDTE010123'];
  const lat0 = 51.5;
  const lon0 = -1.5;
  const r = 100; // metres
  for (let i = 0; i < 40; i++) {
    const th = ((350 + i * 9) % 360) * (Math.PI / 180);
    const lat = lat0 + (r * Math.cos(th)) / 6371000 / (Math.PI / 180);
    const lon = lon0 + (r * Math.sin(th)) / 6371000 / Math.cos(lat0 * (Math.PI / 180)) / (Math.PI / 180);
    const la = Math.floor(lat);
    const lo = Math.abs(lon);
    const lom = Math.floor(lo);
    const s = String(9 * 3600 + i).padStart(1, '0');
    const hh = String(Math.floor((32400 + i) / 3600)).padStart(2, '0');
    const mm = String(Math.floor((32400 + i) / 60) % 60).padStart(2, '0');
    const ss = String((32400 + i) % 60).padStart(2, '0');
    void s;
    L.push(
      `B${hh}${mm}${ss}` +
        `${String(la).padStart(2, '0')}${String(Math.round((lat - la) * 60000)).padStart(5, '0')}N` +
        `${String(lom).padStart(3, '0')}${String(Math.round((lo - lom) * 60000)).padStart(5, '0')}W` +
        `A00500${String(500 + i).padStart(5, '0')}`,
    );
  }
  const { fixes } = parseIgc(L.join('\r\n'));
  chooseAltitude(fixes);
  addKinematics(fixes);
  for (const f of fixes) {
    if (f.tr !== null) assert.ok(Math.abs(f.tr) < 90, `implausible turn rate ${f.tr}`);
  }
  // The circle is right-handed throughout, so the smoothed rate never flips.
  const mid = fixes.slice(5, -5);
  assert.ok(mid.every((f) => f.trs > 0), 'smoothed turn rate changed sign mid-circle');
});

// ---------------------------------------------------- altitude channel

test('a dead pressure channel falls back to GNSS', () => {
  const L = ['AXGD001', 'HFDTE010123'];
  for (let i = 0; i < 50; i++) {
    const hh = '10';
    const mm = String(Math.floor(i / 60)).padStart(2, '0');
    const ss = String(i % 60).padStart(2, '0');
    L.push(`B${hh}${mm}${ss}5143108N00250575WA00000${String(500 + i * 10).padStart(5, '0')}`);
  }
  const { fixes } = parseIgc(L.join('\r\n'));
  assert.equal(chooseAltitude(fixes), 'GNSS');
  assert.equal(fixes[0].alt, 500);
});

test('a live pressure channel is preferred', () => {
  const L = ['AXGD001', 'HFDTE010123'];
  for (let i = 0; i < 50; i++) {
    const ss = String(i % 60).padStart(2, '0');
    L.push(`B1000${ss}5143108N00250575WA${String(400 + i * 10).padStart(5, '0')}${String(500 + i * 10).padStart(5, '0')}`);
  }
  const { fixes } = parseIgc(L.join('\r\n'));
  assert.equal(chooseAltitude(fixes), 'pressure');
  assert.equal(fixes[0].alt, 400);
});

// -------------------------------------------------------- Python semantics

test('pyMod takes the sign of the divisor, as Python does', () => {
  assert.equal(pyMod(-10, 360), 350);
  assert.equal(pyMod(370, 360), 10);
  assert.equal(pyMod(-0.5, 360), 359.5);
});

test('pyRound rounds halves to even', () => {
  assert.equal(pyRound(0.5), 0);
  assert.equal(pyRound(1.5), 2);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(-0.5), -0);
  assert.equal(pyRound(2.675, 2), 2.67); // the classic: 2.675 is really 2.67499...
  assert.equal(pyRound(51.123455, 5), 51.12345);
});

test('pyFixed formats like Python, not like toFixed', () => {
  assert.equal(pyFixed(0.5, 0), '0');
  assert.equal(pyFixed(1.5, 0), '2');
  assert.equal(pyFixed(2.5, 0), '2');
  assert.equal(pyFixed(-0.4, 0), '-0');
  assert.equal(pyFixed(1234.5678, 1), '1234.6');
  assert.equal(pyFixed(3, 2), '3.00');
});

test('mean, median and pstdev match the statistics module', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(pstdev([2, 4, 4, 4, 5, 5, 7, 9]), 2);
});

test('mean is bit-exact where float summation is not', () => {
  // Latitude-shaped values where summing left to right in double lands one
  // unit in the last place away from statistics.mean. Expected values are
  // CPython's. The circling threshold is decided on a mean of turn rates, so
  // one ulp here can move a phase boundary by a whole fix.
  const cases: [number[], number][] = [
    [[25.154975147299, 31.643549611924, 40.613727988597, 2.176790092607, 13.687069444349,
      1.986879562051, 41.530449390195, 35.139116539768, -0.696581499658], 21.248441808570224],
    [[50.061677961906, 32.965739344361, 30.855948751821, 5.662175232709, -2.174959467772,
      26.060969639376], 23.90525857706683],
    [[-1.039097074706, 45.376073489389, 29.978994672407], 24.771990362363333],
    [[2.935980357394, 2.929170784072, 12.999659122961, 0.67545789251, -2.07102401106,
      34.669361122176, 8.742592316378, 47.987318158634, -0.122257420053], 12.082917591445778],
    [[50.919741764586, 18.85834134436, 1.017108910853, 31.620020172871, 39.818097227216,
      11.837657276758], 25.678494449440667],
    [[51.884704527762, -1.920310984633, 7.301904839911, 51.770964622428, 30.111017236866],
      27.8296560484668],
  ];
  for (const [xs, expected] of cases) {
    assert.equal(mean(xs), expected, `mean(${xs.slice(0, 3)}...)`);
    // And confirm each case really is one the naive route gets wrong, so this
    // test cannot quietly stop testing anything.
    const naive = xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.notEqual(naive, expected, 'case no longer distinguishes the two routes');
  }
});

test('mean handles the textbook cancellation cases', () => {
  // Summing left to right loses the 1.0 entirely and returns 0.
  assert.equal(mean([1e16, 1.0, -1e16]), 0.3333333333333333);
  // And the classic: the naive route gives 0.20000000000000004.
  assert.equal(mean([0.1, 0.2, 0.3]), 0.2);
});

test('an empty file is rejected rather than analysed', () => {
  assert.throws(() => parseIgc('HFDTE010123\r\n'), /no usable B records/);
});

// ------------------------------------------------------- the quadratic polar

test('the polar passes exactly through its three defining points', () => {
  const points: number[][] = [
    [95, 0.54],
    [115, 0.6],
    [170, 1.32],
  ];
  const p = new Polar('ASW 27', points);
  for (const [kmh, sink] of points) {
    assert.ok(Math.abs(p.sink(kmh / 3.6) - sink) < 1e-12, `off at ${kmh} km/h`);
  }
});

test('the polar is convex, so it has a genuine best glide', () => {
  const p = new Polar('ASW 27', [[95, 0.54], [115, 0.6], [170, 1.32]]);
  assert.ok(p.c > 0, 'quadratic term should be positive');
  const { ld, speed } = p.bestLd();
  // A 15m glass single-seater: somewhere near 40:1 in the 90-110 km/h band.
  assert.ok(ld > 30 && ld < 55, `implausible best L/D ${ld}`);
  assert.ok(speed !== null && speed * 3.6 > 80 && speed * 3.6 < 130, `at ${speed! * 3.6} km/h`);
});

test('best glide really is the tangent point, not just a sampled maximum', () => {
  const p = new Polar('ASW 27', [[95, 0.54], [115, 0.6], [170, 1.32]]);
  const { ld, speed } = p.bestLd();
  for (const v of [speed! - 5, speed! - 1, speed! + 1, speed! + 5]) {
    assert.ok(v / p.sink(v) <= ld + 1e-9, `${v} m/s beats the reported best`);
  }
});

test('solve3 pivots rather than dividing by a zero leading coefficient', () => {
  // First row has a zero in the first column: needs a row swap to proceed.
  const x = solve3([[0, 1, 1], [1, 2, 3], [2, 1, 1]], [3, 6, 4]);
  const A = [[0, 1, 1], [1, 2, 3], [2, 1, 1]];
  const y = [3, 6, 4];
  A.forEach((row, i) => {
    const got = row[0] * x[0] + row[1] * x[1] + row[2] * x[2];
    assert.ok(Math.abs(got - y[i]) < 1e-9, `row ${i}: ${got} != ${y[i]}`);
  });
});

test('solve3 refuses a degenerate system instead of returning nonsense', () => {
  assert.throws(() => solve3([[1, 1, 1], [2, 2, 2], [3, 3, 3]], [1, 2, 3]));
});

test('a polar needs exactly three points', () => {
  assert.throws(() => new Polar('bad', [[95, 0.54], [115, 0.6]]));
});

// -------------------------------------------------------------- polar matching

const DB = {
  gliders: [
    { name: 'ASK 21', match: ['ask21', 'ask 21', 'k-21', 'k21'], points: [[80, 0.7], [100, 0.83], [140, 1.6]] },
    { name: 'ASW 27', match: ['asw27', 'asw 27'], points: [[95, 0.54], [115, 0.6], [170, 1.32]] },
  ],
  default: { name: 'generic 38:1 glass single-seater', points: [[85, 0.63], [105, 0.75], [150, 1.6]] },
};

test('the glider-type header is matched ignoring spaces and hyphens', () => {
  for (const t of ['ASK-21', 'ask 21', 'Schleicher ASK21 Mi', 'K-21']) {
    const m = loadPolar(DB, t);
    assert.equal(m.polar?.name, 'ASK 21', `failed to match ${t}`);
    assert.equal(m.matched, true);
  }
});

test('an unrecognised glider falls back to the generic, and says so', () => {
  const m = loadPolar(DB, 'Slingsby T21');
  assert.equal(m.polar?.name, 'generic 38:1 glass single-seater');
  assert.equal(m.matched, false);
  assert.match(m.note, /indicative only/);
});

test('a missing glider type still yields a usable polar and a warning', () => {
  const m = loadPolar(DB, undefined);
  assert.equal(m.matched, false);
  assert.ok(m.polar);
});

test('the polar can be forced, and disabled entirely', () => {
  assert.equal(loadPolar(DB, 'ASK 21', { force: 'asw27' }).polar?.name, 'ASW 27');
  const off = loadPolar(DB, 'ASK 21', { force: 'none' });
  assert.equal(off.polar, null);
  assert.equal(off.matched, false);
});

// ------------------------------------------------------------ density altitude

test('sigma falls with height across the range a glider can reach', () => {
  assert.ok(Math.abs(sigma(0) - 1) < 1e-12);
  assert.ok(sigma(3000) < sigma(1000) && sigma(1000) < sigma(0));
  // Wave heights: still well inside the fit.
  assert.ok(sigma(10000) > 0.3 && sigma(10000) < 0.4);
});

test('sigma returns the floor rather than NaN outside the fit', () => {
  // Above ~44,330 m the base goes negative. Unreachable in a glider, but a
  // NaN here would spread through every airmass figure without a word.
  assert.equal(sigma(1e6), 0.3);
  assert.ok(Number.isFinite(sigma(50000)));
});

test('the longest matching key wins, so a Duo Discus is not a Discus', () => {
  // The database lists Discus before Duo Discus, so first-match would make the
  // Duo Discus entry unreachable and put a single-seater's polar on a
  // two-seater. See test/DIVERGENCE.md.
  const db = {
    gliders: [
      { name: 'Discus', match: ['discus 2', 'discus2', 'discus'], points: [[90, 0.56], [110, 0.63], [160, 1.4]] },
      { name: 'Duo Discus', match: ['duo discus', 'duo'], points: [[95, 0.6], [115, 0.66], [170, 1.42]] },
    ],
    default: { name: 'generic', points: [[85, 0.63], [105, 0.75], [150, 1.6]] },
  };
  assert.equal(loadPolar(db, 'Duo Discus').polar?.name, 'Duo Discus');
  assert.equal(loadPolar(db, 'Duo Discus XT').polar?.name, 'Duo Discus');
  // And the single-seater still resolves to itself.
  assert.equal(loadPolar(db, 'Discus b').polar?.name, 'Discus');
  assert.equal(loadPolar(db, 'Discus 2c').polar?.name, 'Discus');
});

test('real database: every glider type resolves to the entry it names', () => {
  for (const [type, expected] of [
    ['Duo Discus', 'Duo Discus'],
    ['Discus b', 'Discus'],
    ['Grob Twin Astir', 'Grob G103 Twin Astir'],
    ['Astir CS 77', 'Grob G102 Astir CS'],
    ['ASK 21', 'ASK 21'],
    ['K-21', 'ASK 21'],
    ['Std Cirrus', 'Standard Cirrus'],
    ['Nimbus 3DM', 'Nimbus'],
    ['Ventus 2cxa', 'Ventus'],
    ['SZD-51 Junior', 'SZD-51 Junior'],
  ] as const) {
    assert.equal(loadPolar(REAL_DB, type).polar?.name, expected, `${type} matched wrongly`);
  }
});
