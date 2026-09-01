/**
 * The trace against the declared task.
 *
 * The declaration says what the flight was for; this is whether it was flown
 * and how fast. It is the one figure a debrief cannot assemble from the phase
 * split and the climbs, and it is also the easiest to get quietly wrong: a
 * turnpoint counted on the way out rather than when it was rounded, a start
 * taken at take-off because the glider launched from the start point, a speed
 * over a course that was never completed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse, flyTask, parseIgc, summariseTask, addKinematics } from '../src/core/index.ts';
import type { Fix, TaskPoint } from '../src/core/index.ts';
import { GOLDEN } from './tools/fixtures.ts';

const trace = (name: string): string => readFileSync(join(GOLDEN, `${name}.igc`), 'latin1');

// ------------------------------------------------------- the real fixture

test('a declared triangle that was flown gives a start, a finish and a speed', () => {
  const { result } = analyse(trace('declared-300k'));
  const t = result.task_flight!;

  assert.ok(t, 'the fixture declares a task, so there is something to check');
  assert.equal(t.complete, true, t.note);
  assert.equal(t.turnpoints_rounded, 2);
  assert.equal(t.turnpoints_declared, 2);
  assert.ok(t.start !== null && t.finish !== null);
  assert.ok(t.finish! > t.start!, 'the finish comes after the start');

  // 300 km in a shade over four and a half hours: a real club speed, and the
  // arithmetic has to be the declared distance over the elapsed time.
  const want = t.distance_m / t.duration_s!;
  assert.ok(Math.abs(t.speed_ms! - want) < 1e-12);
  assert.ok(t.speed_ms! * 3.6 > 50 && t.speed_ms! * 3.6 < 120, `${(t.speed_ms! * 3.6).toFixed(0)} km/h`);
});

test('the points are reached in course order, not whenever the glider passed', () => {
  const { result } = analyse(trace('declared-300k'));
  const times = result.task_flight!.points.map((p) => p.time!);
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] > times[i - 1], `point ${i} was reached before point ${i - 1}`);
  }
});

test('the start is the last exit from the start zone, and never on tow', () => {
  // The fixture launches from the declared start point, so the glider is
  // inside the start zone from the first fix and leaves it on the wire.
  // Taking either would start the clock before the flight did.
  const { result } = analyse(trace('declared-300k'));
  const t = result.task_flight!;
  assert.ok(t.start! > result.launch.takeoff, 'the clock starts after the take-off');
  assert.ok(t.start! >= result.launch.release, 'and not before the release');
});

test('an operator release time moves the start with it', () => {
  // A start cannot precede the release, so correcting the release has to
  // correct the task speed too - otherwise fixing one figure silently leaves
  // the other measured from the old one.
  const text = trace('declared-300k');
  const found = analyse(text).result;
  const later = analyse(text, { releaseTime: found.launch.release + 900 }).result;
  assert.ok(
    later.task_flight!.start! >= later.launch.release,
    'the start still cannot be before the release',
  );
  assert.ok(later.task_flight!.start! > found.task_flight!.start!, 'and it moved');
});

test('the FAI sector and the 1 km cylinder are different rules, and both work', () => {
  const text = trace('declared-300k');
  const cyl = analyse(text, { taskZone: { kind: 'cylinder' } }).result.task_flight!;
  const fai = analyse(text, { taskZone: { kind: 'fai-sector' } }).result.task_flight!;

  assert.equal(cyl.complete, true);
  assert.equal(fai.complete, true);
  assert.equal(cyl.points[1].zone, 'cylinder');
  assert.equal(fai.points[1].zone, 'fai-sector');
  // Start and finish have a leg on one side only, so they stay cylinders.
  assert.equal(fai.points[0].zone, 'cylinder');
  assert.equal(fai.points[fai.points.length - 1].zone, 'cylinder');

  // A sector has to be flown into, so it is never achieved before the cylinder
  // around the same point is.
  assert.ok(fai.points[1].time! >= cyl.points[1].time!);
});

test('a wider cylinder is achieved sooner, and a small enough one is missed', () => {
  const text = trace('declared-300k');
  const wide = analyse(text, { taskZone: { radius_m: 3000 } }).result.task_flight!;
  const tight = analyse(text, { taskZone: { radius_m: 200 } }).result.task_flight!;
  const tiny = analyse(text, { taskZone: { radius_m: 20 } }).result.task_flight!;

  assert.equal(wide.complete, true);
  assert.equal(tight.complete, true, 'the fixture rounds well inside 200 m');
  assert.ok(wide.points[1].time! < tight.points[1].time!, 'a bigger circle is entered earlier');
  // The start does not follow the same way round: a wider start ring is left
  // later, not earlier, because the glider has further to fly to be out of it.
  assert.ok(wide.start! >= tight.start!, 'a wider start ring is left later');

  assert.equal(tiny.complete, false, 'nothing is flown to the nearest twenty metres');
  assert.match(tiny.note, /not reached: closest/);
});

test('a start that was never crossed is flagged, not quietly invented', () => {
  // This fixture tows out of its own start zone and never comes back, so there
  // is no start crossing to time from. Falling back to release is the honest
  // thing; doing it silently would not be, because the speed that comes out is
  // a floor rather than a measurement.
  const { result } = analyse(trace('declared-300k'));
  const t = result.task_flight!;
  assert.equal(t.start_assumed, true);
  assert.equal(t.start, result.launch.release);
  assert.match(t.note, /clock runs from release/);
});

test('a start that was crossed is not flagged', () => {
  const F = [
    ...line([51, -1], [51, -0.9], 200),
    ...line([51, -0.9], [51, -1], 200, 36201),
    ...line([51, -1], [51, -0.5], 800, 36402),
  ];
  addKinematics(F);
  const summary = summariseTask([
    point(51, -1, 'A', 'start'),
    point(51, -0.52, 'B', 'turn'),
    point(51, -0.5, 'C', 'finish'),
  ]);
  const t = flyTask(F, summary, { radius_m: 2000, releaseTime: F[0].t })!;
  assert.equal(t.start_assumed, false);
  assert.doesNotMatch(t.note, /clock runs from release/);
});

test('a file with no declaration has nothing to check and says nothing', () => {
  assert.equal(analyse(trace('ridge-day')).result.task_flight, null);
});

// ------------------------------------------------- the final glide is cut

test('the final glide ends at the finish, not at circuit height', () => {
  const { result } = analyse(trace('declared-300k'));
  const t = result.task_flight!;
  const glide = result.legs.find((l) => l.kind === 'final glide')!;
  const circuit = result.legs.find((l) => l.kind === 'circuit')!;

  assert.ok(glide, 'there should be a final glide');
  assert.ok(Math.abs(glide.end - t.finish!) <= 5, `glide ends ${glide.end}, finish ${t.finish}`);
  assert.equal(circuit.start, glide.end, 'and the circuit picks up exactly where it left off');
  assert.ok(
    glide.alt_end_m - result.profile[result.profile.length - 1].alt_m < 300,
    'this fixture finishes below circuit height, which is the case that used to cut it early',
  );
});

test('a flight with no finish still cuts the glide at circuit height', () => {
  // Nothing about the task check may change what happens to a flight that has
  // no declaration to check against.
  const { result } = analyse(trace('wave'));
  assert.equal(result.task_flight, null);
  assert.ok(result.legs.some((l) => l.kind === 'final glide'));
  assert.ok(result.legs.some((l) => l.kind === 'circuit'));
});

test('splitCircuit: false still leaves the run whole, task or no task', () => {
  const whole = analyse(trace('declared-300k'), { splitCircuit: false }).result.legs;
  const split = analyse(trace('declared-300k')).result.legs;
  assert.equal(whole.length, split.length - 1, 'exactly one run should be cut');
  assert.ok(!whole.some((l) => l.kind === 'final glide'));
});

// ------------------------------------------------------------- geometry

/** A trace flying a straight line between two points, one fix a second. */
function line(from: [number, number], to: [number, number], secs: number, t0 = 36000): Fix[] {
  const F: Fix[] = [];
  for (let i = 0; i <= secs; i++) {
    const k = i / secs;
    F.push({
      t: t0 + i,
      lat: from[0] + (to[0] - from[0]) * k,
      lon: from[1] + (to[1] - from[1]) * k,
      palt: 1000,
      galt: 1000,
      alt: 1000,
      valid: true,
    } as Fix);
  }
  addKinematics(F);
  return F;
}

const point = (lat: number, lon: number, name: string, role: TaskPoint['role']): TaskPoint =>
  ({ lat, lon, name, role });

test('a turnpoint the glider never came near is reported with how near it got', () => {
  // Straight east along 51°N, with a turnpoint half a degree north of the line.
  const F = line([51, -1], [51, 0], 600);
  const summary = summariseTask([
    point(51, -1, 'A', 'start'),
    point(51.5, -0.5, 'B', 'turn'),
    point(51, 0, 'C', 'finish'),
  ]);
  const t = flyTask(F, summary, { kind: 'cylinder', radius_m: 1000 })!;

  assert.equal(t.complete, false);
  assert.equal(t.turnpoints_rounded, 0);
  assert.equal(t.points[1].time, null);
  // Half a degree of latitude is about 55 km, and that is what it should say.
  assert.ok(t.points[1].closest_m > 50000 && t.points[1].closest_m < 60000);
  assert.match(t.note, /1st turnpoint was not reached: closest 5\d\.\d km/);
});

test('an out-and-return sector is the quadrant beyond the turnpoint', () => {
  // Out east to the turnpoint and back. Under the Sporting Code the sector
  // opens away from both legs, so the glider has to fly past the point - a
  // cylinder it merely reaches would not be enough.
  const out = line([51, -1], [51, -0.5], 400);
  const back = line([51, -0.5], [51, -1], 400, 36401);
  const F = [...out, ...back];
  addKinematics(F);
  const summary = summariseTask([
    point(51, -1, 'A', 'start'),
    // Short of where the trace turns, so the glider does overfly it.
    point(51, -0.52, 'B', 'turn'),
    point(51, -1, 'C', 'finish'),
  ]);

  const t = flyTask(F, summary, { kind: 'fai-sector' })!;
  assert.equal(t.points[1].zone, 'fai-sector');
  assert.equal(t.turnpoints_rounded, 1, t.note);
});

test('a start dipped back into does not count until the last time out', () => {
  // East, back west into the start zone, then east again for good. The clock
  // has to run from the second departure.
  const a = line([51, -1], [51, -0.9], 200);
  const b = line([51, -0.9], [51, -1], 200, 36201);
  const c = line([51, -1], [51, -0.5], 800, 36402);
  const F = [...a, ...b, ...c];
  addKinematics(F);
  const summary = summariseTask([
    point(51, -1, 'A', 'start'),
    point(51, -0.52, 'B', 'turn'),
    point(51, -0.5, 'C', 'finish'),
  ]);

  const t = flyTask(F, summary, { kind: 'cylinder', radius_m: 2000 })!;
  assert.ok(t.start !== null);
  // The first departure is around t+15; the second is after the return, past
  // t+400. Anything before that is a start the glider talked itself out of.
  assert.ok(t.start! > F[0].t + 400, `started at +${(t.start! - F[0].t).toFixed(0)} s`);
});

test('a one-point declaration is not a task and is not checked', () => {
  const F = line([51, -1], [51, 0], 100);
  assert.equal(flyTask(F, summariseTask([point(51, -1, 'A', 'start')])), null);
  assert.equal(flyTask(F, null), null);
});

test('the declaration in a real file drives the check without being re-parsed', () => {
  const { task, declaration } = parseIgc(trace('declared-300k'));
  const summary = summariseTask(task, declaration)!;
  assert.equal(summary.points.length, 4, 'start, two turnpoints and finish');
  const { result } = analyse(trace('declared-300k'));
  assert.equal(result.task_flight!.points.length, summary.points.length);
});
