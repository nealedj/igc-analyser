/**
 * Wind that varies with height.
 *
 * Every airspeed and every airmass figure is a ground velocity with the wind
 * taken off it, and until now the wind taken off was one flight-mean vector.
 * On a day that veers and picks up through the band that is wrong twice over:
 * too little wind low down, too much high up, and on a crosswind leg the error
 * goes straight into the airspeed rather than cancelling out.
 *
 * These are built by hand rather than taken from a fixture, because the
 * fixtures are generated with one constant wind and cannot show a gradient
 * they do not have.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windField, windProfileLevels } from '../src/core/wind.ts';
import type { Wind, WindEstimate } from '../src/core/wind.ts';

const est = (alt: number, vx: number, vy: number, circles = 6): WindEstimate => ({
  time: 40000,
  speed_ms: Math.hypot(vx, vy),
  from_deg: 0,
  circles,
  alt_m: alt,
  vx,
  vy,
});

const wind = (vector: [number, number], per: WindEstimate[]): Wind => ({
  vector,
  speed_ms: Math.hypot(...vector),
  from_deg: 0,
  per_climb: per,
  spread_ms: 0,
  unreliable: false,
});

// --------------------------------------------------------- interpolation

test('the wind between two measured heights is interpolated', () => {
  // 5 m/s of westerly at 600 m, 11 m/s at 1,800 m: a plain gradient.
  const w = wind([8, 0], [est(600, 5, 0), est(1800, 11, 0)]);
  const f = windField(w)!;

  assert.deepEqual(f(600), [5, 0]);
  assert.deepEqual(f(1800), [11, 0]);
  // Halfway up is halfway between, not the flight mean.
  const [mid] = f(1200);
  assert.ok(Math.abs(mid - 8) < 1e-9, `${mid} at 1,200 m`);
  const [low] = f(900);
  assert.ok(Math.abs(low - 6.5) < 1e-9, `${low} at 900 m`);
});

test('the wind is held flat outside the heights that measured it', () => {
  // Extrapolating a gradient past the climbs that measured it invents wind for
  // the tow, the final glide and the circuit - the parts of the flight there
  // is no evidence about, and where a wrong wind is most visible.
  const w = wind([8, 0], [est(600, 5, 0), est(1800, 11, 0)]);
  const f = windField(w)!;

  assert.deepEqual(f(0), [5, 0]);
  assert.deepEqual(f(-50), [5, 0]);
  assert.deepEqual(f(3000), [11, 0]);
});

test('direction is interpolated as a vector, not as a bearing', () => {
  // A westerly below and a southerly above. Taken as components the halfway
  // wind is from the south-west; taken as bearings it could come out from the
  // north-east, which is the classic way to get this exactly backwards.
  const w = wind([3, 3], [est(800, 6, 0), est(1600, 0, 6)]);
  const f = windField(w)!;
  const [vx, vy] = f(1200);
  assert.ok(Math.abs(vx - 3) < 1e-9 && Math.abs(vy - 3) < 1e-9, `${vx}, ${vy}`);
});

// ------------------------------------------------------ when not to do it

test('one measured height gives the flight mean everywhere', () => {
  const w = wind([8, 1], [est(1000, 5, 0)]);
  const f = windField(w)!;
  assert.deepEqual(f(200), [8, 1]);
  assert.deepEqual(f(2500), [8, 1]);
  assert.equal(windProfileLevels(w), 1);
});

test('climbs in the same part of the band are one height, not a gradient', () => {
  // Two climbs 80 m apart that disagree by 2 m/s are two samples of one wind.
  // Left as separate levels they would be a near-vertical step that every leg
  // through that height picks up.
  const w = wind([6, 0], [est(1000, 5, 0), est(1080, 7, 0)]);
  assert.equal(windProfileLevels(w), 1);
  const f = windField(w)!;
  assert.deepEqual(f(1040), [6, 0], 'the flight mean, because there is nothing to span');
});

test('thin estimates are kept out of the profile', () => {
  // The flight-mean vector weights by circle count, so an estimate from 1.6
  // circles is diluted there. In a profile it would be a point the
  // interpolation runs through at full strength.
  const w = wind([8, 0], [est(600, 5, 0), est(1800, 30, 0, 1.6)]);
  assert.equal(windProfileLevels(w), 1, 'only the solid estimate counts');
  assert.deepEqual(windField(w)!(1800), [8, 0], 'so the thin one does not move anything');
});

test('no wind at all is no field at all', () => {
  assert.equal(windField(null), null);
  assert.equal(windProfileLevels(null), 0);
});

test('profile: false is the flight mean everywhere, whatever was measured', () => {
  // This is what the golden tests use to reproduce the oracle exactly.
  const w = wind([8, 0], [est(600, 5, 0), est(1800, 11, 0)]);
  const f = windField(w, false)!;
  assert.deepEqual(f(600), [8, 0]);
  assert.deepEqual(f(1800), [8, 0]);
});

test('estimates arrive in climb order and are sorted by height', () => {
  // Climbs come in the order they were flown, which on a day with a
  // strengthening band is not the order of their heights.
  const w = wind([8, 0], [est(1800, 11, 0), est(600, 5, 0), est(1200, 8, 0)]);
  const f = windField(w)!;
  assert.deepEqual(f(600), [5, 0]);
  assert.deepEqual(f(1200), [8, 0]);
  assert.deepEqual(f(1800), [11, 0]);
  assert.equal(windProfileLevels(w), 3);
});
