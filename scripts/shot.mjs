// Usage: node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs] [--click "text"]...
// Headless screenshot + console error capture for verifying prototype screens.
import { chromium } from 'playwright';

const [url, out, w = '1440', h = '900', wait = '2500', ...rest] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(+wait);
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--click') { await page.getByText(rest[++i], { exact: false }).first().click().catch((e) => errors.push('click failed: ' + rest[i])); await page.waitForTimeout(700); }
  if (rest[i] === '--type') { await page.keyboard.type(rest[++i]); await page.waitForTimeout(400); }
  if (rest[i] === '--key') { await page.keyboard.press(rest[++i]); await page.waitForTimeout(400); }
}
await page.screenshot({ path: out });
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
