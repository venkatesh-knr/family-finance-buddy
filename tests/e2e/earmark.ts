import { expect, type Page } from '@playwright/test';

/**
 * Tagging a holding with an earmark through the screen, for the specs that need one earmarked.
 *
 * They write to the demo household, so each puts the holding back as it found it.
 */

export async function openHoldings(page: Page) {
  await page.goto('/#holdings');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(/^Holdings \(\d+\)$/)).toBeVisible({ timeout: 20_000 });
}

/** The holding card whose name contains the text: the nearest section around the name, not the list's own. */
export function card(page: Page, name: RegExp) {
  return page.getByText(name).first().locator('xpath=ancestor::section[1]');
}

export async function setEarmark(page: Page, name: RegExp, label: string) {
  await openHoldings(page);
  const holding = card(page, name);
  await holding.getByRole('button', { name: 'Edit this holding' }).click();
  await holding.locator('label', { hasText: /^Set aside for/ }).locator('select').selectOption({ label });
  await holding.getByRole('button', { name: /^Save$/ }).click();
  await expect(holding.getByRole('button', { name: /^Saving…$/ })).toHaveCount(0, { timeout: 20_000 });
  await expect(holding.locator('label', { hasText: /^Set aside for/ }).locator('select')).toHaveCount(0, { timeout: 20_000 });
}
