import { expect, type Page } from '@playwright/test';
import { choiceField, choose } from './fields.ts';
import { openList, rowFor } from './holdings.ts';

/**
 * Tagging a holding with an earmark through its own screen, for the specs that need one earmarked.
 *
 * They write to the demo household, so each puts the holding back as it found it.
 */

/** Open the holding by name from the list, edit it and set what its money is for. */
export async function setEarmark(page: Page, name: RegExp, label: string) {
  await openList(page);
  await (await rowFor(page, name)).locator('a.holding-link').click();
  await expect(page.getByTestId('detail-value')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Edit / }).first().click();
  await choose(page, 'Set aside for', label);
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(choiceField(page, 'Set aside for')).toHaveCount(0, { timeout: 20_000 });
  // The form closes only once the screen has what was saved, so this is read at once and not retried: a form that
  // closed first would show the old earmark here for as long as the read took.
  if (label !== 'No earmark') expect(await page.locator('.purpose-value').innerText()).toBe(label);
}

/** The holding's row on the list, where the earmark is a pill beside its member. */
export async function rowOf(page: Page, name: RegExp) {
  await openList(page);
  return rowFor(page, name);
}
