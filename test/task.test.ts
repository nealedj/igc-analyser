/**
 * The declared task: reading the `C` block, and what counts as the task.
 *
 * An IGC declaration is take-off, start, the turnpoints, finish, landing. Only
 * the middle three are the task. Counting the other two turns a 300 km
 * triangle into a five-leg course by way of the launch point, and draws two
 * phantom legs across the map.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIgc, parseDeclaration, summariseTask, analyse } from '../src/core/index.ts';
import { GOLDEN } from './tools/fixtures.ts';

const B = 'B1020045111220N00101980WA0019000202\r\n';

/** A file with the given C block, and one B record so it parses at all. */
const withTask = (...c: string[]): string =>
  `HFDTE070623\r\nHFGTYGLIDERTYPE:PIK-20D\r\n${c.map((l) => `${l}\r\n`).join('')}${B}`;

// ------------------------------------------------------ the block header

test('the declaration header gives the date, the time and the turnpoint count', () => {
  const d = parseDeclaration('C070623093500070623000102300KM TRIANGLE');
  assert.equal(d.declared_date, '2023-06-07');
  assert.equal(d.declared_time_s, 9 * 3600 + 35 * 60);
  assert.equal(d.turnpoints, 2);
  assert.equal(d.description, '300KM TRIANGLE');
});

test('a short header is read as far as it goes rather than rejected', () => {
  // Loggers that stop after the task number are common; the count is missing,
  // not zero, and saying so is what lets the roles fall back to a guess.
  const d = parseDeclaration('C1406231142001406230001');
  assert.equal(d.declared_date, '2023-06-14');
  assert.equal(d.turnpoints, undefined);
  assert.equal(d.description, '');
});

test('the header is never read as a turnpoint', () => {
  // It has no hemisphere letters, which is what tells it apart from a point.
  // The oracle reads its digits as a coordinate and invents a turnpoint in the
  // South China Sea. See DIVERGENCE.md.
  const { task } = parseIgc(withTask('C070623093500070623000100'));
  assert.deepEqual(task, []);
});

// ------------------------------------------------------------ the roles

test('take-off and landing records are labelled, not counted as turnpoints', () => {
  const { task, declaration } = parseIgc(
    withTask(
      'C070623093500070623000102300KM TRIANGLE',
      'C5111220N00101980WTAKEOFF LASHAM',
      'C5111220N00101980WSTART LASHAM',
      'C5201920N00131680WEDGEHILL',
      'C5115540N00223940WDEVIZES',
      'C5111220N00101980WFINISH LASHAM',
      'C5111220N00101980WLANDING LASHAM',
    ),
  );
  assert.equal(declaration?.turnpoints, 2);
  assert.deepEqual(
    task.map((p) => p.role),
    ['takeoff', 'start', 'turn', 'turn', 'finish', 'landing'],
  );

  const t = summariseTask(task, declaration)!;
  assert.equal(t.points.length, 4, 'the task is start, two turnpoints and finish');
  assert.equal(t.turnpoints, 2);
  assert.equal(t.shape, 'triangle');
  assert.equal(t.legs.length, 3);
  assert.equal(t.takeoff?.name, 'TAKEOFF LASHAM');
  assert.equal(t.landing?.name, 'LANDING LASHAM');
  assert.ok(Math.abs(t.distance_m - 300000) < 5000, `${(t.distance_m / 1000).toFixed(1)} km`);
});

test('a zero-coordinate take-off record still shifts the roles behind it', () => {
  // Some loggers write TAKEOFF as all zeros. The point is dropped, but the
  // block is still six records long, so the ones after it keep their places.
  const { task, declaration } = parseIgc(
    withTask(
      'C070623093500070623000101',
      'C0000000N00000000WTAKEOFF',
      'C5111220N00101980WSTART LASHAM',
      'C5201920N00131680WEDGEHILL',
      'C5111220N00101980WFINISH LASHAM',
      'C0000000N00000000WLANDING',
    ),
  );
  assert.deepEqual(
    task.map((p) => p.role),
    ['start', 'turn', 'finish'],
  );
  assert.equal(summariseTask(task, declaration)!.shape, 'out and return');
});

test('a block with no take-off or landing is all task, and the count says so', () => {
  const { task, declaration } = parseIgc(
    withTask(
      'C070623093500070623000101',
      'C5111220N00101980WSTART LASHAM',
      'C5201920N00131680WEDGEHILL',
      'C5111220N00101980WFINISH LASHAM',
    ),
  );
  assert.deepEqual(task.map((p) => p.role), ['start', 'turn', 'finish']);
  assert.equal(summariseTask(task, declaration)!.turnpoints, 1);
});

test('names carry the layout where the header does not', () => {
  // No turnpoint count in this header, but the block names its ends.
  const { task, declaration } = parseIgc(
    withTask(
      'C1406231142001406230001',
      'C5111220N00101980WTAKE OFF',
      'C5111220N00101980WSTART',
      'C5201920N00131680WEDGEHILL',
      'C5111220N00101980WFINISH',
      'C5111220N00101980WLANDING',
    ),
  );
  assert.deepEqual(
    task.map((p) => p.role),
    ['takeoff', 'start', 'turn', 'finish', 'landing'],
  );
  assert.equal(summariseTask(task, declaration)!.turnpoints, 1);
});

test('an unlabelled block is treated as all task rather than guessed at', () => {
  const { task, declaration } = parseIgc(
    withTask(
      'C1406231142001406230001',
      'C5111220N00101980WASTON DOWN',
      'C5201920N00131680WEDGEHILL',
      'C5111220N00101980WASTON DOWN',
    ),
  );
  assert.deepEqual(task.map((p) => p.role), ['start', 'turn', 'finish']);
  const t = summariseTask(task, declaration)!;
  assert.equal(t.points.length, 3);
  assert.equal(t.shape, 'out and return');
});

// ------------------------------------------------------------- the numbers

test('leg distances and tracks are great-circle, not flat-earth', () => {
  const t = summariseTask([
    { lat: 51.187, lon: -1.033, name: 'LASHAM', role: 'start' },
    { lat: 52.032, lon: -1.528, name: 'EDGEHILL', role: 'turn' },
    { lat: 51.187, lon: -1.033, name: 'LASHAM', role: 'finish' },
  ])!;
  // 100 km on a bearing of about 340, and the reciprocal coming back.
  assert.ok(Math.abs(t.legs[0].distance_m - 100000) < 500, `${t.legs[0].distance_m} m`);
  assert.ok(Math.abs(t.legs[0].bearing_deg - 340) < 1, `${t.legs[0].bearing_deg}°`);
  assert.ok(Math.abs(t.legs[1].bearing_deg - 160) < 1, `${t.legs[1].bearing_deg}°`);
  assert.equal(t.closed, true);
});

test('no declaration is null, not an empty task', () => {
  const { task, declaration } = parseIgc(`HFDTE070623\r\n${B}`);
  assert.deepEqual(task, []);
  assert.equal(declaration, null);
  assert.equal(summariseTask(task, declaration), null);
});

test('the 300 km fixture reports the triangle it declares', () => {
  const igc = readFileSync(join(GOLDEN, 'declared-300k.igc'), 'latin1');
  const t = analyse(igc).result.task_summary!;
  assert.equal(t.shape, 'triangle');
  assert.equal(t.turnpoints, 2);
  assert.ok(
    Math.abs(t.distance_m - 300000) < 2000,
    `declared ${(t.distance_m / 1000).toFixed(1)} km, not 300`,
  );
  assert.equal(t.declaration?.description, '300KM TRIANGLE');
  assert.equal(t.takeoff?.name, 'TAKEOFF LASHAM');
});
