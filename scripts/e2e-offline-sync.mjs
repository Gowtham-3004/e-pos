// Cross-app offline-first check (requires `pnpm dev`):
// POS goes offline → completes a sale → Back Office does not see it → POS online → Back Office sees it.
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5170';
const OUT = process.argv[2] ?? '/tmp';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const errors = [];
const watch = (p, name) => { p.on('pageerror', (e) => errors.push(`${name}: ${e}`)); p.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`)); };
const pos = await ctx.newPage(); watch(pos, 'pos');
const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  try { await fn(); console.log('ok'); }
  catch (e) { console.log('FAILED'); await ctx.pages().at(-1)?.screenshot({ path: `${OUT}/e2e-fail.png` }); console.log(String(e).split('\n')[0]); console.log(errors.join('\n')); await browser.close(); process.exit(1); }
};

await step('POS activate + login + open shift', async () => {
  await pos.goto(`${BASE}/pos/`, { waitUntil: 'networkidle' });
  await pos.getByText('ABC Supermarket').first().click({ timeout: 30000 });
  await pos.getByText('Anna Nagar').first().click();
  await pos.getByText('C02 · Counter 2').first().click();
  await pos.getByText('Activate as').first().click();
  await pos.getByText('Arun Prakash').first().click();
  await pos.keyboard.type('1234');
  await pos.getByText('Open shift (Day-In)').first().click();
  await pos.fill('[aria-label="Count of ₹500"]', '4');
  await pos.getByRole('button', { name: 'Open shift' }).click();
  await pos.waitForTimeout(800);
});

await step('POS go offline', async () => {
  await pos.getByRole('button', { name: /Network simulator/ }).click();
  await pos.getByText('Offline (internet down)').click();
  await pos.waitForTimeout(400);
});

let invoice = '';
await step('POS sell while offline', async () => {
  await pos.keyboard.type('Tata Salt');
  await pos.waitForTimeout(500);
  await pos.keyboard.press('Enter');
  await pos.waitForTimeout(400);
  await pos.keyboard.press('Enter');
  await pos.waitForTimeout(500);
  await pos.keyboard.press('F7');
  await pos.waitForTimeout(600);
  await pos.keyboard.type('100');
  await pos.keyboard.press('Enter');
  await pos.getByText('Sale completed').first().waitFor({ timeout: 10000 });
  invoice = (await pos.getByText(/^Invoice /).first().textContent()).replace('Invoice ', '').trim();
  await pos.screenshot({ path: `${OUT}/e2e-1-pos-offline-sale.png` });
});
console.log('  invoice', invoice);

const bo = await ctx.newPage(); watch(bo, 'backoffice');
const boHasInvoice = async () => {
  await bo.goto(`${BASE}/backoffice/sales?demo=t-abc:owner`, { waitUntil: 'networkidle' });
  await bo.waitForTimeout(2500);
  const search = bo.getByPlaceholder(/Search/i).first();
  if (await search.count()) { await search.fill(invoice); await bo.waitForTimeout(600); }
  return (await bo.locator('tbody tr', { hasText: invoice }).count()) > 0;
};

let before = true;
await step('Back Office does NOT have the offline sale', async () => {
  before = await boHasInvoice();
  await bo.screenshot({ path: `${OUT}/e2e-2-bo-before.png` });
  if (before) throw new Error('invoice visible before sync');
});

await step('POS back online → sync drains', async () => {
  await pos.bringToFront();
  await pos.keyboard.press('Escape');
  await pos.getByRole('button', { name: /Network simulator/ }).click();
  await pos.getByText('Online', { exact: true }).click();
  await pos.waitForTimeout(6000);
  await pos.screenshot({ path: `${OUT}/e2e-3-pos-online.png` });
});

await step('Back Office now has the sale', async () => {
  await bo.bringToFront();
  const after = await boHasInvoice();
  await bo.screenshot({ path: `${OUT}/e2e-4-bo-after.png` });
  if (!after) throw new Error('invoice not visible after sync');
});

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
