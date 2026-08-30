/** Shared fixture discovery, so the tools and the tests agree on the set. */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), '..', 'golden');

/**
 * Every `.igc` in `test/golden/`, synthetic or real. Dropping your own trace
 * in there and running `npm run make-fixtures` is all it takes to add a case.
 */
export function fixtures(): { name: string; igc: string; expected: string }[] {
  return readdirSync(GOLDEN)
    .filter((f) => f.toLowerCase().endsWith('.igc'))
    .sort()
    .map((f) => {
      const name = f.replace(/\.igc$/i, '');
      return {
        name,
        igc: join(GOLDEN, f),
        expected: join(GOLDEN, `${name}.expected.json`),
      };
    });
}
