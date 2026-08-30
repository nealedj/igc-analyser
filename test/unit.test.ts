/**
 * Unit tests for the parts that are fiddly enough to get wrong quietly, and
 * that a whole-file golden comparison would not localise.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dm, parseB, parseIgc, chooseAltitude } from '../src/core/parse.ts';
import { wrap, addKinematics } from '../src/core/kinematics.ts';
import { mean, median, pstdev, pyFixed, pyMod, pyRound } from '../src/core/pyutil.ts';

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

test('an empty file is rejected rather than analysed', () => {
  assert.throws(() => parseIgc('HFDTE010123\r\n'), /no usable B records/);
});
