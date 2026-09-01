#!/usr/bin/env node
/**
 * Node entry point: analyse a file and print the result object as JSON.
 *
 * This exists so the port can be diffed against the Python oracle without a
 * browser. It is not shipped in the build.
 */

import { readFileSync } from 'node:fs';
import { analyse } from './core/index.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error(
    'usage: npm run analyse -- FLIGHT.igc [--min-circle-rate DEG] [--release HH:MM:SS]' +
      ' [--polar NAME] [--loading KG_PER_M2]',
  );
  process.exit(2);
}

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const rate = flag('min-circle-rate');
const rel = flag('release');
const releaseTime = rel
  ? rel.split(':').reduce((acc, p) => acc * 60 + Number(p), 0)
  : undefined;

const polarName = flag('polar');
const loading = flag('loading');

const { result } = analyse(readFileSync(file, 'utf8'), {
  minCircleRate: rate ? Number(rate) : undefined,
  releaseTime,
  polar: {
    ...(polarName ? { force: polarName } : {}),
    ...(loading ? { loadingKgM2: Number(loading) } : {}),
  },
});

process.stdout.write(JSON.stringify(result, null, 1));
