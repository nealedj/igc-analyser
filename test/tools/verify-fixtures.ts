/**
 * Check the committed fixtures still match what the oracle produces today.
 *
 * This is what keeps drift between the oracle and the port visible: if
 * `reference/` is updated and the fixtures are not, this fails and names the
 * fields that moved.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { compare } from '../compare.ts';
import { fixtures } from './fixtures.ts';

const ORACLE = 'reference/igc_analyse.py';
let stale = 0;

for (const f of fixtures()) {
  const tmp = `${f.expected}.actual.json`;
  let committed: unknown;
  try {
    committed = JSON.parse(readFileSync(f.expected, 'utf8'));
  } catch {
    console.error(`MISSING ${f.name}: no committed fixture; run npm run make-fixtures`);
    stale++;
    continue;
  }
  try {
    execFileSync('python3', [ORACLE, f.igc, '--json', tmp], { stdio: 'pipe' });
    const fresh: unknown = JSON.parse(readFileSync(tmp, 'utf8'));
    // No fixture name, so no divergence is excused: this compares the oracle
    // with itself and must be exact.
    const diff = compare(committed, fresh, '<none>');
    if (diff.length) {
      stale++;
      console.error(`DRIFT ${f.name}: ${diff.length} field(s) changed`);
      for (const d of diff.slice(0, 8)) {
        console.error(`   ${d.path}: committed ${JSON.stringify(d.oracle)} -> oracle now ${JSON.stringify(d.port)}`);
      }
    } else {
      console.log(`ok    ${f.name}`);
    }
  } finally {
    rmSync(tmp, { force: true });
  }
}

if (stale) {
  console.error(`\n${stale} fixture(s) are stale. Run npm run make-fixtures and review the diff.`);
  process.exit(1);
}
console.log('\nAll fixtures match the vendored oracle.');
