import { test, expect, type Page } from '@playwright/test';

/**
 * The Holdings list and a holding's own screen (docs/design/holdings.md). Read-only: nothing here writes.
 *
 * HD-I1 to HD-I6, each named in a title so `check:invariants` counts them. The arithmetic behind HD-I2 is a unit
 * test (`holdingGroups.test.ts`), where the figures are exact; the compact figures on a screen are not.
 */

async function onHoldings(page: Page, hash = '#/holdings') {
  await page.goto(`/${hash}`);
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.holding-row').first()).toBeVisible({ timeout: 20_000 });
}

test('HD-I5 — exactly one control named Add on the list, and no per-row purchase or sale', async ({ page }) => {
  await onHoldings(page);
  await expect(page.getByRole('button', { name: /^Add\b/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /purchase or sale/i })).toHaveCount(0);
});

test('HD-I4 — the filter is in the URL: only deposits, the chip pressed, and Back returns to All', async ({ page }) => {
  await onHoldings(page);
  const all = await page.locator('.holding-row').count();

  await onHoldings(page, '#/holdings?kind=deposit');
  const rows = page.locator('.holding-row');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(all);
  await expect(page.getByRole('link', { name: /^Deposits\b/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('link', { name: /^All\b/ })).not.toHaveAttribute('aria-current', 'true');
  // The summary card describes the filter, and the list's Add names the class.
  await expect(page.getByRole('button', { name: 'Add a deposit' })).toBeVisible();

  await page.goBack();
  await expect(page.locator('.holding-row')).toHaveCount(all, { timeout: 20_000 });
});

test('HD-I3 — a holding whose return is refused keeps its mark and its reason on the row', async ({ page }) => {
  await onHoldings(page);
  const refused = page.locator('.holding-row').filter({ hasText: /return not shown|no cost recorded/ });
  // The demo household has positions resting on a partial statement; if it has none, say so and not pass.
  expect(await refused.count(), 'a row with a refused return in the demo household').toBeGreaterThan(0);
  await expect(refused.first().getByRole('button', { name: /Why there is no/ })).toBeVisible();
});

test('HD-I1 — a row shows the latest recorded reading, and the holding opens on the same figure', async ({ page }) => {
  await onHoldings(page);
  const row = page.locator('.holding-row').filter({ has: page.locator('.holding-value') }).first();
  const rowText = (await row.locator('.holding-value').innerText()).replace(/\s+/g, '');
  await row.locator('a.holding-link').click();
  await expect(page.getByTestId('detail-value')).toBeVisible({ timeout: 20_000 });
  const detail = (await page.getByTestId('detail-value').innerText()).replace(/\s+/g, '');
  // Compact in both places, so the same text: two views, one answer to "what is this worth".
  expect(detail).toBe(rowText);
});

test('HD-I6 — a deposit opens on its terms, with no units, purchases or realised figure', async ({ page }) => {
  await onHoldings(page, '#/holdings?kind=deposit');
  await page.locator('.holding-row').first().locator('a.holding-link').click();
  await expect(page.getByTestId('term-progress')).toBeVisible({ timeout: 20_000 });
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\bunits?\b/i);
  expect(text).not.toMatch(/purchase/i);
  expect(text).not.toMatch(/realised/i);
  // Archive is a visible button, named for the holding.
  await expect(page.getByRole('button', { name: /^Archive\b/ })).toBeVisible();
});

test('a fund opens on units, cost and its transactions, and Back returns to the list', async ({ page }) => {
  await onHoldings(page, '#/holdings?kind=mutual_fund');
  await page.locator('.holding-row').first().locator('a.holding-link').click();
  await expect(page.getByText(/units/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /Holdings$/ }).first()).toBeVisible();
  await page.goBack();
  await expect(page.locator('.holding-row').first()).toBeVisible({ timeout: 20_000 });
});

test('a row is compact: about a glance, and a screen of eight holdings is not seven', async ({ page }) => {
  await onHoldings(page);
  const first = await page.locator('.holding-row').first().boundingBox();
  // A row is a glance, not a card: about a hundred pixels. Measured at 412px on the seeded household, the first row
  // (a deposit whose terms wrap to a second line, under an earmark pill) is 103px; a fund's is under 96. 112 is room
  // for one wrapped line and a pill, and well under the 150px or more that inline detail cost.
  expect(first?.height ?? 999).toBeLessThan(112);
  const viewport = page.viewportSize()?.height ?? 800;
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  // Eight holdings took about 6.7 phone screens of inline detail; the list is a handful.
  expect(total / viewport).toBeLessThan(5);
});

test('a filtered summary describes the filter: its share of the portfolio, and none of another class\'s caveat', async ({
  page,
}) => {
  await onHoldings(page, '#/holdings?kind=deposit');
  const summary = page.locator('.card').first();
  await expect(page.getByTestId('filter-share')).toContainText(/\d+\.\d% of the INR portfolio/);
  // The partial-statement positions are mutual funds: they are not the deposits' to carry.
  await expect(summary).not.toContainText('return not shown');
  const share = Number(/(\d+\.\d)%/.exec(await page.getByTestId('filter-share').innerText())?.[1] ?? '100');
  expect(share, 'deposits are a part of the portfolio and not all of it').toBeLessThan(100);
});

test('HD-I6 — a deposit shows what was lent, and a bond filter opens Add as a bond', async ({ page }) => {
  await onHoldings(page, '#/holdings?kind=deposit');
  await page.locator('.holding-row').first().locator('a.holding-link').click();
  await expect(page.getByTestId('term-progress')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('main').getByText('Principal', { exact: true })).toBeVisible();

  await onHoldings(page, '#/holdings?kind=bond');
  await page.getByRole('button', { name: 'Add a bond' }).click();
  await expect(page.getByLabel('Face value')).toBeVisible();
});
