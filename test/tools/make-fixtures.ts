/**
 * Regenerate `*.expected.json` from the vendored Python oracle.
 *
 * Run this after changing a fixture or updating `reference/`. Review the
 * resulting diff before committing — that diff is the whole point.
 */

import { execFileSync } from 'node:child_process';
import { fixtures } from './fixtures.ts';

const ORACLE = 'reference/igc_analyse.py';
let failed = 0;

for (const f of fixtures()) {
  try {
    execFileSync('python3', [ORACLE, f.igc, '--json', f.expected], { stdio: 'pipe' });
    console.log(`ok   ${f.name}`);
  } catch (e) {
    failed++;
    const err = e as { stderr?: Buffer; message: string };
    console.error(`FAIL ${f.name}: ${err.stderr?.toString().trim() || err.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} fixture(s) could not be generated.`);
  process.exit(1);
}
