import { test, expect, type Page } from '@playwright/test';

/**
 * Holdings as tabs, All first, and whose figures: Mine first (docs/design/simple-layout.md sections 2 and 2a).
 *
 * SL-I1 Holdings opens on All, which shows the whole-household total and a row per class; a class tab is a filter in the URL.
 * SL-I2 A class tab appears only for a class the household holds, and the active tab is always in view.
 * SL-I8 Overview and Holdings open on Mine, and the lifted figure's label says whose it is.
 *
 * Read-only: nothing here writes.
 */

test.use({ actionTimeout: 15_000 });

async function onHoldings(page: Page, hash = '#/holdings') {
  await page.goto(`/${hash}`);
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'Holdings by class' })).toBeVisible({ timeout: 20_000 });
}

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Holdings by class' }).getByRole('link');

test('SL-I1 — Holdings opens on All, with the total and one row per class, and a class tab is a filter in the URL', async ({ page }) => {
  await onHoldings(page);

  // All is the first tab and the current one.
  await expect(tabs(page).first()).toHaveText('All');
  await expect(tabs(page).first()).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('nav[aria-label="Holdings by class"] [aria-current="page"]')).toHaveCount(1);

  // The total, and what was invested, and one row for each class held: as many rows as there are tabs after All.
  await expect(page.getByTestId('holdings-total')).toBeVisible();
  const classes = (await tabs(page).allInnerTexts()).slice(1);
  expect(classes.length, 'the household holds some classes').toBeGreaterThan(0);
  const rows = page.getByTestId('by-class').getByRole('link');
  await expect(rows).toHaveCount(classes.length);

  // A class tab is an address: it filters, it is the current tab, and Back returns to All.
  const first = classes[0] ?? '';
  await tabs(page).filter({ hasText: first }).click();
  await expect(page).toHaveURL((url) => /kind=[a-z_]+/.test(url.hash));
  await expect(page.locator('nav[aria-label="Holdings by class"] [aria-current="page"]')).toHaveText(first);
  await expect(tabs(page).first()).not.toHaveAttribute('aria-current', 'page');

  await page.goBack();
  await expect(page).toHaveURL((url) => !url.hash.includes('kind='));
  await expect(tabs(page).first()).toHaveAttribute('aria-current', 'page');
});

test('SL-I1 — a row of By class opens that class’s tab, and the Gold tab opens as the Gold tab', async ({ page }) => {
  await onHoldings(page);
  const gold = page.getByTestId('by-class').getByRole('link').filter({ hasText: /^Gold/ });
  test.skip((await gold.count()) === 0, 'this household holds no gold');
  await gold.click();
  await expect(page).toHaveURL((url) => url.hash.includes('kind=gold'));
  await expect(page.locator('nav[aria-label="Holdings by class"] [aria-current="page"]')).toHaveText('Gold');
  // The one Add is named for the tab.
  await expect(page.getByRole('button', { name: 'Add gold', exact: true })).toBeVisible();
});

test('SL-I2 — a tab appears only for a class the household holds, one for each', async ({ page }) => {
  await onHoldings(page);
  const tabNames = (await tabs(page).allInnerTexts()).slice(1).sort();
  const rowNames = (await page.getByTestId('by-class').getByRole('link').allInnerTexts()).map((text) => (text.split('\n')[0] ?? '').trim()).sort();
  expect(tabNames, 'the tabs are the classes with a row on All').toEqual(rowNames);
  // A class nobody holds has no tab.
  for (const absent of ['Property', 'Cash']) expect(tabNames).not.toContain(absent);
});

test('SL-I2 — at 375px the active tab, even the last, is within the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'measured at the phone width');
  await onHoldings(page);
  const names = (await tabs(page).allInnerTexts()).slice(1);
  const last = names[names.length - 1];
  expect(last).toBeDefined();
  await tabs(page).filter({ hasText: last ?? '' }).click();
  await expect(page.locator('nav[aria-label="Holdings by class"] [aria-current="page"]')).toHaveText(last ?? '');
  // The strip scrolls itself to the active tab.
  await expect
    .poll(async () => {
      const box = await page.locator('nav[aria-label="Holdings by class"] [aria-current="page"]').boundingBox();
      const width = page.viewportSize()?.width ?? 375;
      return box !== null && box.x >= 0 && box.x + box.width <= width + 1;
    })
    .toBe(true);
});

test('SL-I8 — Overview and Holdings open on Mine, the label says whose it is, and Household changes both', async ({ page }) => {
  await page.goto('/#/overview');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  const switcher = page.getByRole('group', { name: 'Whose figures' });
  test.skip((await switcher.count()) === 0, 'a household of one member has no switch');

  // A fresh open: Mine is pressed, and the figure says it is the person's own.
  await expect(switcher.getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true');
  await expect(switcher.getByRole('button', { name: 'Household' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('heading', { name: 'Your net worth' })).toBeVisible();

  // Household: the label changes, and Holdings follows.
  await switcher.getByRole('button', { name: 'Household' }).click();
  await expect(page.getByRole('heading', { name: 'Household net worth' })).toBeVisible();
  await page.getByRole('button', { name: 'Holdings' }).click();
  await expect(page.getByRole('navigation', { name: 'Holdings by class' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('group', { name: 'Whose figures' }).getByRole('button', { name: 'Household' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Household holdings · current value')).toBeVisible();

  // Not remembered: a reload opens on Mine again.
  await page.goto('/#/overview');
  await page.reload();
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('group', { name: 'Whose figures' }).getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Your net worth' })).toBeVisible();
});

test('SL-I8 — the emergency fund and protection say Household, and do not change with the switch', async ({ page }) => {
  await page.goto('/#/overview');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  const switcher = page.getByRole('group', { name: 'Whose figures' });
  test.skip((await switcher.count()) === 0, 'a household of one member has no switch');

  const emergency = page.getByRole('region', { name: 'Household emergency fund' });
  await expect(emergency).toBeVisible({ timeout: 20_000 });
  const onMine = await emergency.innerText();
  await switcher.getByRole('button', { name: 'Household' }).click();
  await expect(page.getByRole('heading', { name: 'Household net worth' })).toBeVisible();
  expect(await page.getByRole('region', { name: 'Household emergency fund' }).innerText()).toBe(onMine);
});
