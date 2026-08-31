/**
 * The final glide and the landing circuit.
 *
 * The trace does not distinguish them: a flight that lands ends in one
 * unbroken stretch of straight flight from the top of the last glide to the
 * ground. The oracle labels the whole of it a circuit, which on a 300 km
 * flight means reporting a landing twenty minutes long, and averages the glide
 * home together with the approach. This is where the split is checked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse } from '../src/core/index.ts';
import { CIRCUIT_M, circuitEntry } from '../src/core/legs.ts';
import type { Fix } from '../src/core/types.ts';
import { GOLDEN } from './tools/fixtures.ts';

const fix = (alt: number): Fix => ({ alt }) as Fix;
const trace = (name: string): string => readFileSync(join(GOLDEN, `${name}.igc`), 'latin1');

// ------------------------------------------------------------ circuit entry

test('circuit entry is the start of the final descent below circuit height', () => {
  const F = [1200, 800, 400, 260, 120, 0].map(fix);
  // The field is at 0, so the ceiling is CIRCUIT_M: the 260 m fix is the first
  // that stays below it to the end.
  assert.equal(CIRCUIT_M, 300);
  assert.equal(circuitEntry(F, true), 3);
});

test('circuit entry is measured above the landing field, not sea level', () => {
  const F = [1400, 900, 700, 500, 380].map(fix);
  // Landing at 380 m, so the ceiling is 680 m and the 500 m fix is the entry.
  assert.equal(circuitEntry(F, true), 3);
});

test('a low save is not circuit entry, because it did not stay down', () => {
  const F = [1200, 200, 150, 900, 1100, 400, 200, 0].map(fix);
  // Down to 150 m mid-flight and climbed away again: only the last descent
  // counts, and the 400 m fix is still above the ceiling, so entry is the
  // 200 m fix after it.
  assert.equal(circuitEntry(F, false), null, 'a trace that does not land has no circuit');
  assert.equal(circuitEntry(F, true), 6);
});

test('a trace that stops in the air has no circuit at all', () => {
  assert.equal(circuitEntry([1200, 1100, 1000].map(fix), false), null);
});

// ------------------------------------------------- the split, on real traces

test('the final glide is reported as a glide, not as a very long landing', () => {
  // The wave fixture descends 3.5 km at the end of the flight in one straight
  // run. Before the split the whole 35 minutes of it was labelled 'circuit'.
  const { result } = analyse(trace('wave'));
  const legs = result.legs;
  const glide = legs.find((l) => l.kind === 'final glide');
  const circuit = legs.find((l) => l.kind === 'circuit');

  assert.ok(glide, 'no final glide found');
  assert.ok(circuit, 'no circuit found');
  assert.ok(glide!.duration_s > 1200, `final glide only ${glide!.duration_s} s`);
  assert.ok(circuit!.duration_s < 600, `circuit is ${circuit!.duration_s} s, which is not a circuit`);
  assert.equal(glide!.end, circuit!.start, 'the split should not lose or duplicate any of the run');
  assert.equal(glide!.circuit, false);
  assert.equal(circuit!.circuit, true);
});

test('the circuit starts within circuit height of the field', () => {
  for (const name of ['wave', 'thermal-day', 'two-seater', 'coarse-ogn']) {
    const { result } = analyse(trace(name));
    const landAlt = result.profile[result.profile.length - 1].alt_m;
    for (const l of result.legs) {
      if (l.kind !== 'circuit') continue;
      assert.ok(
        l.alt_start_m < landAlt + CIRCUIT_M + 1,
        `${name}: circuit starts ${(l.alt_start_m - landAlt).toFixed(0)} m above the field`,
      );
    }
  }
});

test('soaring down to the circuit is not a final glide', () => {
  // The ridge fixture beats along the ridge for half an hour and finishes 400 m
  // lower than it started. That is soaring, not a glide home, and calling it a
  // final glide would be as wrong as calling it a circuit.
  const { result } = analyse(trace('ridge-day'));
  assert.equal(result.legs.filter((l) => l.kind === 'final glide').length, 0);
  assert.ok(result.legs.some((l) => l.kind === 'circuit'), 'the landing is still a circuit');
});

test('splitCircuit: false reproduces the oracle, run for run', () => {
  for (const name of ['wave', 'thermal-day', 'ridge-day', 'coarse-ogn']) {
    const split = analyse(trace(name)).result.legs;
    const whole = analyse(trace(name), { splitCircuit: false }).result.legs;
    assert.equal(whole.length, split.length - 1, `${name}: exactly one run should be cut`);

    // The uncut run covers both halves, and every other leg is untouched.
    const cut = split.findIndex((l) => l.kind === 'circuit');
    assert.equal(whole[cut - 1].start, split[cut - 1].start);
    assert.equal(whole[cut - 1].end, split[cut].end);
    for (let i = 0; i < cut - 1; i++) {
      assert.deepEqual(whole[i], split[i], `${name}: leg ${i} should not have moved`);
    }
  }
});

test('only the circuit is kept out of the rising-air figure', () => {
  // A final glide flies through the day's air like any other leg and belongs
  // in the sample; a descending circuit says nothing about the day.
  const { result } = analyse(trace('coarse-ogn'));
  const counted = result.legs.filter((l) => l.kind !== 'circuit' && l.sampled_s !== undefined);
  const want =
    counted.reduce((acc, l) => acc + l.frac_rising_air! * l.sampled_s!, 0) /
    counted.reduce((acc, l) => acc + l.sampled_s!, 0);

  assert.ok(counted.some((l) => l.kind === 'final glide'), 'the final glide should be counted');
  assert.ok(
    Math.abs(result.rising_air_fraction! - want) < 1e-12,
    `${result.rising_air_fraction} != ${want}`,
  );
});
