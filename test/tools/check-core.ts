/**
 * `src/core/` must stay runnable in Node with no browser, no DOM types and no
 * third-party dependencies. That is what makes it usable as a library later,
 * and it is easy to break by reaching for `document` without noticing.
 *
 * Typechecking it against a DOM-free lib catches the types; a scan catches
 * the globals that would still typecheck through `any`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CORE = 'src/core';
const BANNED = /\b(document|window|localStorage|navigator|fetch|XMLHttpRequest|require)\b/;

let bad = 0;

/**
 * Blank out comments while keeping every newline, so reported line numbers
 * still point at the source. Prose is allowed to say "window"; code is not.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

for (const f of readdirSync(CORE).filter((n) => n.endsWith('.ts'))) {
  const src = readFileSync(join(CORE, f), 'utf8');
  const lines = src.split('\n');
  stripComments(src)
    .split('\n')
    .forEach((code, i) => {
      if (BANNED.test(code)) {
        console.error(`${CORE}/${f}:${i + 1}: core reached for a browser global\n    ${lines[i].trim()}`);
        bad++;
      }
    });
  for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) {
      console.error(`${CORE}/${f}: core imports a non-relative module '${spec}'`);
      bad++;
    }
  }
}

// Typecheck core alone, with the DOM library removed.
const cfg = 'tsconfig.core.generated.json';
writeFileSync(
  cfg,
  JSON.stringify(
    {
      extends: './tsconfig.json',
      compilerOptions: { lib: ['ES2022'], types: [] },
      include: ['src/core'],
    },
    null,
    2,
  ),
);
try {
  execFileSync('npx', ['tsc', '--noEmit', '-p', cfg], { stdio: 'inherit' });
} catch {
  console.error('core does not typecheck without the DOM library');
  bad++;
} finally {
  rmSync(cfg, { force: true });
}

if (bad) {
  console.error(`\ncore purity check failed with ${bad} problem(s).`);
  process.exit(1);
}
console.log('core is pure: no DOM, no I/O, no third-party imports.');
