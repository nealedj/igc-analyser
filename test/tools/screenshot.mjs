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
 *
 * URL, IGC, OUT and CHROMIUM_PATH all override the defaults.
 */

import { chromium } from 'playwright';

const url = process.env.URL ?? 'http://localhost:4173/';
const igc = process.env.IGC ?? new URL('../golden/thermal-day.igc', import.meta.url).pathname;
const out = process.env.OUT ?? 'docs/screenshot.png';

// CHROMIUM_PATH lets a sandbox with a browser already on disk skip the
// download step; without it Playwright uses whatever it installed itself.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1100, height: 980 }, deviceScaleFactor: 1.5 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.setInputFiles('#file-input', igc);
await page.waitForSelector('#results .panel', { timeout: 15000 });
// The whole page is several thousand pixels tall and makes a poor README
// image. Frame the part that says what the tool is: the honesty panel, the
// summary and the barogram.
await page.$eval('.quality', (e) => e.scrollIntoView({ block: 'start' }));
await page.evaluate(() => window.scrollBy(0, -24));
await page.waitForTimeout(500);
await page.screenshot({ path: out });

console.log(errors.length ? `console errors: ${errors.join('\n')}` : `wrote ${out}, no console errors`);
await browser.close();
