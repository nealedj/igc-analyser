/**
 * Golden-file regression against the vendored Python oracle.
 *
 * This is the whole test strategy for the analysis: the oracle is the
 * specification, and every number the port produces has to match it to within
 * float drift. Anything that differs on purpose is registered in
 * `divergence.ts` and explained in `DIVERGENCE.md`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyse } from '../src/core/index.ts';
import { compare } from './compare.ts';
import { DIVERGENCES } from './divergence.ts';
import { fixtures } from './tools/fixtures.ts';

/**
 * Oracle top-level keys the port is expected to reproduce. Phases add to this
 * list; a key missing from here is a key nobody is checking, so it is spelled
 * out rather than inferred.
 */
const COVERED = [
  // Phase 1: parsing, kinematics, segmentation, launch detection.
  'header',
  'warnings',
  'altitude_source',
  'launch',
  'track_distance_m',
  'task',
  'profile',
];

const cases = fixtures();

test('there are enough fixtures to be a regression suite', () => {
  assert.ok(cases.length >= 5, `only ${cases.length} fixtures`);
});

for (const f of cases) {
  test(`golden: ${f.name}`, () => {
    const oracle = JSON.parse(readFileSync(f.expected, 'utf8')) as Record<string, unknown>;
    const { result } = analyse(readFileSync(f.igc, 'latin1'));

    const subject: Record<string, unknown> = {};
    for (const k of COVERED) {
      assert.ok(k in oracle, `oracle fixture has no key ${k}`);
      subject[k] = oracle[k];
    }

    const diff = compare(subject, result, f.name);
    const report = diff
      .slice(0, 12)
      .map((d) => `  ${d.path}\n    oracle: ${JSON.stringify(d.oracle)}\n    port  : ${JSON.stringify(d.port)}`)
      .join('\n');
    assert.equal(diff.length, 0, `${diff.length} mismatch(es) in ${f.name}:\n${report}`);
  });
}

test('every registered divergence names a real fixture', () => {
  const names = new Set(cases.map((c) => c.name));
  for (const d of DIVERGENCES) {
    for (const name of d.fixtures) {
      assert.ok(names.has(name), `divergence "${d.reason}" names unknown fixture ${name}`);
    }
  }
});

test('DIVERGENCE.md documents every registered divergence', () => {
  const doc = readFileSync(new URL('./DIVERGENCE.md', import.meta.url), 'utf8');
  for (const d of DIVERGENCES) {
    assert.ok(doc.includes(d.reason), `DIVERGENCE.md has no section for "${d.reason}"`);
  }
});
