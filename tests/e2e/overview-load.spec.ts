import { test, expect } from '@playwright/test';

/**
 * The Overview does not say a rate is missing when it has only not been read yet.
 *
 * `useOverviewData` read the holdings and put them on screen, then fetched the exchange rates, the loans
 * and the rest. Until the rates arrived the net worth was worked out with none, so it was refused for
 * want of a rate: the per-currency figures with a mark on them, for a moment, before the total. That is
 * the one figure the screen exists for, saying something false.
 *
 * Deterministic and not a race: the rates request is held open, and for as long as it is nothing that
 * is a figure may be on the page. Then it is released, and the total, a single figure, appears.
 *
 * Read-only. The request is delayed, not changed.
 */

test('no figure is drawn while the exchange rates are still being read', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/rest/v1/fx_rate*', async (route) => {
    await gate;
    await route.continue();
  });

  await page.goto('/#overview');
  await expect(page.getByRole('group', { name: 'Screen' }).first()).toBeVisible();

  // Held open for long enough that a figure drawn from the holdings alone would have been painted.
  await page.waitForTimeout(1500);
  await expect(page.locator('.figure'), 'a figure was drawn before the rates were read').toHaveCount(0);

  release();

  // Then the total: one figure, not the per-currency figures standing in for one.
  const hero = async (): Promise<string> => (await page.locator('.figure').first().innerText()).replace(/\s+/g, '');
  await expect.poll(hero, { timeout: 20_000 }).toMatch(/^[₹$][\d.,]+[A-Za-z]*$/);
});
