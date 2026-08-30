/**
 * Regenerate the README screenshot.
 *
 * Playwright is deliberately not a devDependency: it pulls a few hundred
 * megabytes of browsers on install, which everyone running `npm ci` would pay
 * for to produce one image. Install it when you need it:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run build && npx vite preview --port 4173 &
 *   npm run screenshot
 */

import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://localhost:4173/';
const igc = process.env.IGC ?? new URL('../golden/thermal-day.igc', import.meta.url).pathname;
const out = process.env.OUT ?? 'docs/screenshot.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.setInputFiles('#file-input', igc);
await page.waitForSelector('#results .panel', { timeout: 15000 });
await page.waitForTimeout(500);
await page.screenshot({ path: out, fullPage: true });

console.log(errors.length ? `console errors: ${errors.join('\n')}` : `wrote ${out}, no console errors`);
await browser.close();
