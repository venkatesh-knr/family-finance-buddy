import { expect, type Page } from '@playwright/test';
import { openList } from './holdings.ts';

/**
 * Tagging a holding with an earmark through its own screen, for the specs that need one earmarked.
 *
 * They write to the demo household, so each puts the holding back as it found it.
 */

/** Open the holding by name from the list, edit it and set what its money is for. */
export async function setEarmark(page: Page, name: RegExp, label: string) {
  await openList(page);
  await page.locator('.holding-row').filter({ hasText: name }).first().locator('a.holding-link').click();
  await expect(page.getByTestId('detail-value')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Edit / }).first().click();
  const select = page.locator('label', { hasText: /^Set aside for/ }).locator('select');
  await select.selectOption({ label });
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(select).toHaveCount(0, { timeout: 20_000 });
}

/** The holding's row on the list, where the earmark is a pill beside its member. */
export async function rowOf(page: Page, name: RegExp) {
  await openList(page);
  return page.locator('.holding-row').filter({ hasText: name }).first();
}
