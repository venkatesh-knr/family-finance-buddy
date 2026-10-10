import { test, expect } from '@playwright/test';

/**
 * The FIRE read-out: the target, a projection against it, how far along, and what a year costs.
 *
 * Read-only on purpose. The assumptions it stands on are written to the household row by a migration
 * that is applied separately, and a spec that wrote them would fail against a database that has not had
 * it yet, which is the state a deploy goes out in. What can be said without writing: it is there, it
 * names what it assumes, and under privacy mode no figure from it is left in the document.
 */

async function onFire(page: import('@playwright/test').Page) {
  await page.goto('/#fire');
  await expect(page.getByRole('group', { name: 'Screen' }).first()).toBeVisible();
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Financial independence', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('the FIRE screen opens on the target, a projection, progress and the cost of a year', async ({ page }) => {
  await onFire(page);

  await expect(page.getByRole('heading', { name: 'Projection', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How far along' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What a year costs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What the projection assumes' })).toBeVisible();

  // The picture has a name that says what it shows, and the ring says what it is a share of.
  await expect(page.getByRole('img', { name: /against a target of/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /per cent of today's target/ })).toBeVisible();

  // It does not pass itself off as a forecast, and it says what it leaves out.
  await expect(page.getByText(/Not a forecast/)).toBeVisible();
  await expect(page.getByText(/Property and anything else not yet recorded is not in it/)).toBeVisible();
});

test('the projection and the Overview start from the same net worth', async ({ page }) => {
  await page.goto('/#overview');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  // Until the exchange rates have been read the Overview shows its refusal (the per-currency figures with a
  // mark on them) and then the total, so wait for the total: a single figure, not a sum of two.
  const heroText = async (): Promise<string> =>
    (await page.locator('.figure').first().innerText()).replace(/\s+/g, '');
  await expect.poll(heroText, { timeout: 20_000 }).toMatch(/^[₹$][\d.,]+[A-Za-z]*$/);
  const hero = await heroText();

  await onFire(page);
  const reached = page.locator('.fire-progress-rows dd').first();
  await expect(reached).toBeVisible();
  // Compact in both places, so the same text: two screens, one figure.
  expect((await reached.innerText()).replace(/\s+/g, '')).toBe(hero);
});

test('with amounts hidden, no figure from the read-out is left in the document', async ({ page }) => {
  await onFire(page);
  const visible = (await page.locator('.fire-progress-rows dd').first().innerText()).replace(/\s+/g, '');
  expect(visible, 'the figure is shown first, or the test proves nothing').toMatch(/\d/);

  await page.getByRole('button', { name: /Amounts shown/ }).click();

  // The digits of the corpus, the target and the cost of a year, gone from the markup: the rows, the
  // chart's name, its tick labels and the explanation behind the info mark.
  const markup = await page.evaluate(() => document.querySelector('main, #root')?.outerHTML ?? '');
  // With its currency sign, so a coordinate in a path that happens to share the digits is not a match.
  const figures = visible.match(/[₹$][\d.,]+/g) ?? [];
  expect(figures.length, 'a figure with a currency sign to look for').toBeGreaterThan(0);
  for (const figure of figures) {
    expect(markup, `${figure} is still in the page under privacy mode`).not.toContain(figure);
  }
  // Shapes, years and percentages stay: the screen is discreet and not blank.
  await expect(page.getByRole('img', { name: /per cent of today's target/ })).toBeVisible();
});
