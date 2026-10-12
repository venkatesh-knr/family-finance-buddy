import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Getting around the Holdings list and a holding's own screen, for the specs that write to the demo household
 * and put it back (docs/design/holdings.md).
 *
 * A row is a link to the holding, so a spec opens the holding it made by name and acts on its own screen. A
 * deposit that has paid out is in the Ended group, folded away, so finding one opens that group first.
 */

export async function openList(page: Page, hash = '#/holdings') {
  await page.goto(`/${hash}`);
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  // The summary card is there once the screen has its data.
  await expect(page.getByText('latest readings')).toBeVisible({ timeout: 20_000 });
}

/** The row of the holding with this name, opening the Ended group if that is where it is. */
export async function rowFor(page: Page, name: string): Promise<Locator> {
  const row = page.locator('.holding-row').filter({ hasText: name });
  if ((await row.count()) === 0) {
    const ended = page.getByRole('button', { name: /^Ended/ });
    if ((await ended.count()) > 0 && (await ended.getAttribute('aria-expanded')) === 'false') await ended.click();
  }
  return page.locator('.holding-row').filter({ hasText: name }).first();
}

/** Open a holding's own screen from the list. */
export async function openHolding(page: Page, name: string) {
  await openList(page);
  const row = await rowFor(page, name);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.locator('a.holding-link').click();
  await expect(page.getByTestId('detail-value')).toBeVisible({ timeout: 20_000 });
}

/** The panel for adding a deposit or a bond, open, with its form. */
export async function openFixedForm(page: Page): Promise<Locator> {
  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();
  await page.getByLabel('What are you adding').selectOption('fixed');
  return page.locator('form').filter({ hasText: 'Fixed deposit' });
}

/** Archive the holding whose screen is open, and land back on the list without it. */
export async function archiveOpenHolding(page: Page, name: string) {
  await page.getByRole('button', { name: `Archive ${name}` }).click();
  await page.getByRole('button', { name: 'Yes, archive it' }).click();
  await expect(page.getByTestId('detail-value')).toHaveCount(0, { timeout: 20_000 });
  await openList(page);
  await expect(page.locator('.holding-row').filter({ hasText: name })).toHaveCount(0);
}

export async function archiveByName(page: Page, name: string) {
  await openHolding(page, name);
  await archiveOpenHolding(page, name);
}

/**
 * Go to a screen by name, for the suites that walk every screen (screens, text size). A holding's own screen has
 * no hash of its own to type, since it is a holding's id, so it is reached the way a person reaches it: from a
 * row of the list. A deposit, because its screen is the one with the most on it.
 */
export async function goTo(page: Page, screen: string) {
  if (screen !== 'holding') {
    await page.goto(`/#${screen}`);
    return;
  }
  await openList(page, '#/holdings?kind=deposit');
  await page.locator('.holding-row').first().locator('a.holding-link').click();
  await expect(page.getByTestId('detail-value')).toBeVisible({ timeout: 20_000 });
}
