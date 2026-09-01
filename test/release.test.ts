/**
 * The release-time override.
 *
 * Release detection is a heuristic and is routinely wrong when the tow ran
 * through lift. Everything after release - the phase split, which climbs
 * count, which straight runs are legs, the soaring time - is measured from it,
 * so being able to say "I pulled the bung at 12:04" is not a convenience. This
 * is where the override is checked, including the part that is easy to get
 * quietly wrong: a time of day is not a fix time on a flight across midnight.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse } from '../src/core/index.ts';
import { GOLDEN } from './tools/fixtures.ts';

const trace = (name: string): string => readFileSync(join(GOLDEN, `${name}.igc`), 'latin1');
const at = (h: number, m: number, s = 0): number => h * 3600 + m * 60 + s;

test('an operator release time replaces the detected one', () => {
  const text = trace('thermal-day');
  const found = analyse(text).result.launch;
  const set = analyse(text, { releaseTime: at(12, 30) }).result.launch;

  assert.notEqual(found.release, set.release, 'the override should have moved the release');
  assert.equal(set.release, at(12, 30), 'it should land on the fix at the time asked for');
  assert.equal(set.release_override, true);
  assert.equal(found.release_override, false);
});

test('an overridden release is confident, but is not a detection', () => {
  // `release_confident` is true either way once a person has said so, which is
  // exactly why it cannot be the flag a consumer reads to tell them apart.
  const { result } = analyse(trace('thermal-day'), { releaseTime: at(12, 30) });
  assert.equal(result.launch.release_confident, true);
  assert.equal(result.launch.release_override, true);
  assert.match(result.launch.note, /release taken as 12:30:00, supplied by the operator/);
});

test('the phase split is measured from the release that was supplied', () => {
  const text = trace('thermal-day');
  const whole = analyse(text).result;
  const late = analyse(text, { releaseTime: at(12, 30) }).result;

  assert.ok(
    late.phase.soaring_s < whole.phase.soaring_s,
    'releasing later leaves less of the flight to be soaring',
  );
  assert.ok(late.climbs.length < whole.climbs.length, 'and fewer climbs after it');
  for (const c of late.climbs) assert.ok(c.start >= at(12, 30), 'no climb before the release');
});

// ------------------------------------------------------- across midnight

test('a time of day after midnight resolves to the far side of the rollover', () => {
  // The fixture runs 23:44:01 to 00:07:45. Fix times keep counting past
  // midnight so the flight stays one sequence, so 00:05 is t = 86700, not
  // t = 300 - and t = 300 is nearest the *first* fix of the trace, which is
  // what a naive nearest-time search would return.
  const { result } = analyse(trace('midnight-rollover'), { releaseTime: at(0, 5) });
  assert.equal(result.launch.release, 86400 + at(0, 5));
  assert.match(result.launch.note, /release taken as 00:05:00/);
});

test('a time of day before midnight still resolves on the first day', () => {
  const { result } = analyse(trace('midnight-rollover'), { releaseTime: at(23, 50) });
  assert.equal(result.launch.release, at(23, 50));
});

// ------------------------------------------------------- outside the trace

test('a release time the trace does not cover says how far off it landed', () => {
  // It snaps to the nearest end, which is a different answer from the one that
  // was asked for, so it has to be visible rather than silently substituted.
  const { result } = analyse(trace('thermal-day'), { releaseTime: at(6, 0) });
  assert.match(result.launch.note, /the nearest fix is \d+ s away/);
});

test('a release time inside the trace does not claim to be off', () => {
  const { result } = analyse(trace('thermal-day'), { releaseTime: at(12, 30) });
  assert.doesNotMatch(result.launch.note, /the nearest fix is/);
});
