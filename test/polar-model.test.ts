/**
 * The polar model, and whether the shipped database is the gliders it names.
 *
 * Every airmass and L/D figure the app produces is measured against these
 * curves, and the best glide ratio is printed next to them, so an error here
 * is not confined to one number - it moves the whole debrief in one direction
 * and looks like weather while doing it.
 *
 * The old curves were anchored at one published place, best glide, with the
 * remaining freedom taken up by assuming minimum sink sat at 0.75 of
 * best-glide speed. That assumption sets the curvature, and curvature is what
 * high-speed sink is made of: measured against published polars the result ran
 * about 13% low above 150 km/h and up to 41% low, always low, which reads the
 * air as better than it was on exactly the fast final glides where somebody
 * would care. There is a second published anchor now, out at cruise speed, and
 * these tests are what keeps it honest.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Polar, loadPolar } from '../src/core/polar.ts';
import type { PolarDb } from '../src/core/polar.ts';
import realPolars from '../src/data/polars.json' with { type: 'json' };
import { points as derivedPoints } from './tools/make-polars.ts';

const REAL_DB = realPolars as PolarDb;
const ENTRIES = [...REAL_DB.gliders, REAL_DB.default];

/**
 * Types whose real polar is too peaky for a quadratic to hold both published
 * figures at once. 57:1 puts best-glide sink at 0.58 m/s, and a published
 * minimum sink of 0.45 would need minimum sink at 68 km/h, below the speed the
 * glider flies at. The fit takes best glide and the cruise range - which is
 * where every airmass figure is computed - and reads minimum sink high.
 *
 * Named rather than tolerated, so a new entry cannot join them quietly.
 */
const POLAR_PEAKY = new Set(['Nimbus (25 m)', 'ASH 25 (25 m)']);

// ------------------------------------------------------------- the model

test('three points give a quadratic and four give a cubic, exactly through both', () => {
  const quad = [[95, 0.54], [115, 0.6], [170, 1.32]];
  const cube = [[80, 0.62], [95, 0.54], [115, 0.6], [170, 1.32]];

  const q = new Polar('quadratic', quad);
  assert.equal(q.coef.length, 3);
  for (const [kmh, sink] of quad) assert.ok(Math.abs(q.sink(kmh / 3.6) - sink) < 1e-12);

  const c = new Polar('cubic', cube);
  assert.equal(c.coef.length, 4);
  for (const [kmh, sink] of cube) assert.ok(Math.abs(c.sink(kmh / 3.6) - sink) < 1e-10);
});

test('a cubic is a strictly better fit where the curve is not a parabola', () => {
  // Four points off a peaky real curve: a quadratic cannot pass through all
  // four, and the fourth is where it shows.
  const pts = [[80, 0.62], [100, 0.55], [140, 1.00], [190, 2.60]];
  const cubic = new Polar('cubic', pts);
  const quad = new Polar('quadratic', [pts[0], pts[2], pts[3]]);
  assert.ok(
    Math.abs(cubic.sink(pts[1][0] / 3.6) - pts[1][1]) <
      Math.abs(quad.sink(pts[1][0] / 3.6) - pts[1][1]),
    'the cubic should be the one that goes through the held-out point',
  );
});

test('loading scales speed and sink by the square root of the ratio', () => {
  // At twice the loading the glider flies every point of the polar at sqrt(2)
  // times the speed for sqrt(2) times the sink. That is the whole of it, and
  // it means the glide ratio at corresponding speeds is unchanged.
  const pts = [[80, 0.62], [100, 0.55], [160, 1.60]];
  const dry = new Polar('dry', pts);
  const wet = new Polar('wet', pts, 2);
  const k = Math.sqrt(2);

  for (const kmh of [70, 90, 110, 140, 180]) {
    const v = kmh / 3.6;
    assert.ok(
      Math.abs(wet.sink(v * k) - dry.sink(v) * k) < 1e-12,
      `${kmh} km/h dry should be ${kmh * k} km/h wet`,
    );
  }
  const d = dry.bestLd();
  const w = wet.bestLd();
  assert.ok(Math.abs(w.ld - d.ld) < 0.05, 'best glide ratio does not change with loading');
  assert.ok(Math.abs(w.speed! - d.speed! * k) < 0.15, 'but the speed it happens at does');
});

test('a loading ratio of one changes nothing at all', () => {
  const pts = [[80, 0.62], [100, 0.55], [160, 1.6]];
  const a = new Polar('a', pts);
  const b = new Polar('b', pts, 1);
  for (let kmh = 60; kmh <= 220; kmh += 10) {
    assert.ok(Math.abs(a.sink(kmh / 3.6) - b.sink(kmh / 3.6)) < 1e-15);
  }
});

// ---------------------------------------------- the database is the glider

test('real database: every entry declares the published figures it came from', () => {
  for (const g of ENTRIES) {
    const p = g.published;
    assert.ok(p, `${g.name} has no published block`);
    assert.ok(p!.best_ld > 15 && p!.best_ld < 75, `${g.name}: implausible best L/D`);
    assert.ok(p!.fast_kmh > p!.best_ld_kmh + 20, `${g.name}: the fast anchor is not fast`);
    assert.ok(
      p!.loading_kg_m2 > 15 && p!.loading_kg_m2 < 60,
      `${g.name}: implausible wing loading ${p!.loading_kg_m2} kg/m²`,
    );
  }
});

test('real database: the fitted curve reproduces the published best glide', () => {
  for (const g of ENTRIES) {
    const { ld, speed } = new Polar(g.name, g.points).bestLd();
    const want = g.published!;
    assert.ok(
      Math.abs(ld - want.best_ld) < 0.3,
      `${g.name}: fitted ${ld.toFixed(1)}:1, published ${want.best_ld}:1`,
    );
    assert.ok(
      speed !== null && Math.abs(speed * 3.6 - want.best_ld_kmh) < 3,
      `${g.name}: best glide at ${((speed ?? 0) * 3.6).toFixed(0)} km/h, published ${want.best_ld_kmh}`,
    );
  }
});

test('real database: the fitted curve reproduces the published fast point', () => {
  // This is the anchor that was missing, and the reason the old curves read
  // 13% low above 150 km/h. If it drifts, so does every fast-glide airmass
  // figure on the page.
  for (const g of ENTRIES) {
    const p = new Polar(g.name, g.points);
    const want = g.published!;
    const got = p.sink(want.fast_kmh / 3.6);
    assert.ok(
      Math.abs(got - want.fast_sink_ms) / want.fast_sink_ms < 0.01,
      `${g.name}: ${got.toFixed(2)} m/s at ${want.fast_kmh} km/h, published ${want.fast_sink_ms}`,
    );
  }
});

test('real database: a PIK-20D is 41:1, not 47:1', () => {
  const m = loadPolar(REAL_DB, 'PIK-20D');
  const { ld } = m.polar!.bestLd();
  assert.equal(Math.round(ld), 41, `PIK-20D fitted ${ld.toFixed(1)}:1`);
});

test('real database: minimum sink lands where a glider would have it', () => {
  // Minimum sink is no longer an input to the fit, so this is a real check on
  // the two published anchors rather than a restatement of an assumption.
  for (const g of ENTRIES) {
    const p = new Polar(g.name, g.points);
    const { sink, speed } = p.minSink();
    const { speed: vbg } = p.bestLd();
    const r = speed! / vbg!;
    assert.ok(r > 0.65 && r < 0.95, `${g.name}: minimum sink at ${r.toFixed(2)} of best-glide speed`);

    const want = g.published!.min_sink_ms;
    const off = Math.abs(sink - want) / want;
    const limit = POLAR_PEAKY.has(g.name) ? 0.25 : 0.15;
    assert.ok(
      off < limit,
      `${g.name}: fitted min sink ${sink.toFixed(2)}, published ${want} (${(off * 100).toFixed(0)}% out)`,
    );
  }
});

test('real database: nothing is quietly peaky', () => {
  // POLAR_PEAKY is a list of known limits, not a place to put a bad entry.
  for (const name of POLAR_PEAKY) {
    const g = ENTRIES.find((e) => e.name === name);
    assert.ok(g, `POLAR_PEAKY names ${name}, which is not in the database`);
    const p = new Polar(g!.name, g!.points);
    const off = Math.abs(p.minSink().sink - g!.published!.min_sink_ms) / g!.published!.min_sink_ms;
    assert.ok(off > 0.15, `${name} is within tolerance now, so take it out of POLAR_PEAKY`);
  }
});

test('real database: sink rises with speed all the way to Vne', () => {
  // A curve that turns back down, or goes negative, is a fit that has escaped
  // its data. It would show up as a glider gaining energy in still air.
  for (const g of ENTRIES) {
    const p = new Polar(g.name, g.points);
    const vms = p.minSink().speed!;
    let prev = -Infinity;
    for (let kmh = 55; kmh <= 250; kmh += 5) {
      const v = kmh / 3.6;
      const s = p.sink(v);
      assert.ok(s > 0, `${g.name}: sink ${s.toFixed(2)} at ${kmh} km/h`);
      if (v > vms) {
        assert.ok(s > prev, `${g.name}: sink falls between ${kmh - 5} and ${kmh} km/h`);
        prev = s;
      }
    }
  }
});

test('real database: the committed file still matches its own published figures', () => {
  // Points are derived, not chosen: `npm run make-polars` writes them. A
  // hand-edited point that no longer sits on its glider's curve fails here.
  for (const g of ENTRIES) {
    const want = derivedPoints(g.published!);
    assert.deepEqual(g.points, want, `${g.name}: points are not what its published figures give`);
  }
});
