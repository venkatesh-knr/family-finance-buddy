import { test, expect, type Page } from '@playwright/test';

/**
 * Overview as its artboard draws it (docs/design/vibrant-canvas.html, Overview), with the owner's calls on the
 * mock-vs-build review: the emergency fund as a card in the currency cards' style (item 1) and one allocation card
 * per currency (item 2). Close the month sitting in Needs attention, drawn as an action, is proposed and not yet
 * decided (conformance.md).
 *
 * Read-only: nothing here writes, and Close is not pressed.
 */

async function onOverview(page: Page) {
  await page.goto('/#overview');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.alloc-row').first()).toBeVisible({ timeout: 20_000 });
}

test('the currency cards fill their row, and the emergency fund is a card of the same kind under them', async ({ page }) => {
  await onOverview(page);
  const grid = page.locator('.stat-cards').first();
  const currencies = grid.locator('section.stat-card[aria-label^="Assets in"]');
  const count = await currencies.count();
  expect(count).toBeGreaterThan(0);

  // Side by side across the whole grid, not two thirds of it: the cards' widths add up to the grid's.
  const gridBox = await grid.boundingBox();
  let across = 0;
  for (let i = 0; i < count; i += 1) across += (await currencies.nth(i).boundingBox())?.width ?? 0;
  if (count > 1 && (gridBox?.width ?? 0) > 400) {
    expect(across, 'the currency cards leave part of their row empty').toBeGreaterThan((gridBox?.width ?? 0) * 0.9 - 12 * count);
  }

  // The emergency fund is a card of the same kind, when something is earmarked for it.
  const emergency = page.getByTestId('months-of-cover');
  if ((await emergency.count()) > 0) {
    await expect(emergency).toHaveClass(/stat-card/);
    await expect(emergency.locator('h3')).toHaveText('Emergency fund');
    expect(await grid.getByTestId('months-of-cover').count(), 'outside the currency cards\' grid, so they keep their row').toBe(0);
  }
});

test('allocation is one card per currency, headed "Allocation" with the currency and its total', async ({ page }) => {
  await onOverview(page);
  const cards = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Allocation', exact: true }) });
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  // As many cards as currencies held, each with its ring and its rows.
  expect(count).toBe(await page.locator('.stat-cards').first().locator('section.stat-card[aria-label^="Assets in"]').count());
  for (let i = 0; i < count; i += 1) {
    await expect(cards.nth(i)).toContainText(/India|Abroad/);
    await expect(cards.nth(i).locator('.alloc-row').first()).toBeVisible();
    await expect(cards.nth(i).locator('svg[role="img"]').first()).toBeVisible();
  }
});

test('Needs attention has no year in its header, and closing the month is an action among its rows and not a disclosure', async ({ page }) => {
  await onOverview(page);
  const card = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Needs attention', exact: true }) });
  await expect(card).toBeVisible();
  await expect(card.locator('header')).not.toContainText(/20\d\d/);

  const close = card.getByRole('button', { name: /^Close / });
  test.skip((await close.count()) === 0, 'last month is already closed in this household');
  // It acts and does not open, so it has no chevron; and closing a month is routine, so no brass "!".
  await expect(close).toHaveClass(/attention-action/);
  await expect(close.locator('.attention-chevron')).toHaveCount(0);
  await expect(close.locator('.notice-mark')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'What closing a month does' })).toBeVisible();
});
