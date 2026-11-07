import { expect, type Locator, type Page } from '@playwright/test';
import { choose, next, stepper } from './fields.ts';

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

const strip = (page: Page) => page.locator('nav[aria-label="Holdings by class"]');

/** The hash of every tab, All first. */
async function tabHashes(page: Page): Promise<string[]> {
  return strip(page).locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
}

/** Go to a tab of the Holdings screen without reloading it, and wait for it to be the current one. */
async function goToTab(page: Page, hash: string) {
  await page.evaluate((to) => {
    window.location.hash = to;
  }, hash);
  await expect(strip(page).locator(`a[href="${hash}"]`)).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
}

/** The rows with this name on the tab that is open, the Ended group opened first if it is folded. */
async function namedHere(page: Page, name: string | RegExp): Promise<Locator> {
  const rows = page.locator('.holding-row').filter({ hasText: name });
  if ((await rows.count()) === 0) {
    const ended = page.getByRole('button', { name: /^Ended/ });
    if ((await ended.count()) > 0 && (await ended.getAttribute('aria-expanded')) === 'false') await ended.click();
  }
  return page.locator('.holding-row').filter({ hasText: name });
}

/**
 * The row of the holding with this name. All has a row for each class and no holdings, so the holding is looked for on the tab that is
 * open and then on each class tab in turn (a holding is on the tab of its kind), the Ended group opened where it is folded.
 */
export async function rowFor(page: Page, name: string | RegExp): Promise<Locator> {
  // A holding that has only just been added is not on the list until the list has read again, which it does after the add and not before the
  // spec has looked, so the tabs are looked through again until it is there or the time is up.
  const deadline = Date.now() + 25_000;
  for (;;) {
    const here = await namedHere(page, name);
    if ((await here.count()) > 0) return here.first();
    for (const hash of (await tabHashes(page)).slice(1)) {
      await goToTab(page, hash);
      await page.locator('.holding-row').first().waitFor({ timeout: 2000 }).catch(() => undefined);
      const found = await namedHere(page, name);
      if ((await found.count()) > 0) return found.first();
    }
    if (Date.now() > deadline) return page.locator('.holding-row').filter({ hasText: name }).first();
  }
}

/** How many rows carry this name across every tab, which is what "it is gone from the list" means now that All has no rows. */
export async function rowsNamed(page: Page, name: string | RegExp): Promise<number> {
  let total = (await (await namedHere(page, name)).count());
  for (const hash of (await tabHashes(page)).slice(1)) {
    await goToTab(page, hash);
    await page.locator('.holding-row').first().waitFor({ timeout: 2000 }).catch(() => undefined);
    total += await (await namedHere(page, name)).count();
  }
  return total;
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
  await choose(page, 'Type', /^A deposit or a bond/);
  return stepper(page);
}

/**
 * Fill the stepped form for a new deposit or bond through its steps, and leave it on the last one with its button to press: what it is, its
 * amount and dates, how it earns or pays (a bond's repay mode and rating), and where it is held and what it is for.
 */
export async function typeTerms(
  page: Page,
  form: Locator,
  terms: {
    name: string;
    bond?: boolean;
    amount: string;
    rate: string;
    starts: string;
    matures: string;
    repay?: string;
    rating?: string;
    declineFirstReading?: boolean;
  },
): Promise<void> {
  if (terms.bond === true) await form.getByRole('button', { name: 'Bond', exact: true }).click();
  await form.getByLabel('Name', { exact: true }).fill(terms.name);
  await next(page);
  await form.getByLabel(terms.bond === true ? 'Face value' : 'Principal').fill(terms.amount);
  await form.getByLabel(terms.bond === true ? 'Coupon %' : 'Rate %', { exact: true }).fill(terms.rate);
  await form.getByLabel('Starts').fill(terms.starts);
  await form.getByLabel('Matures').fill(terms.matures);
  await next(page);
  if (terms.repay !== undefined) await choose(page, 'Repay mode', terms.repay);
  if (terms.rating !== undefined) await form.getByLabel('Rating').fill(terms.rating);
  await next(page);
  if (terms.declineFirstReading === true) await form.getByLabel(/Record today.s value/).uncheck();
}

/** Archive the holding whose screen is open, and land back on the list without it. */
export async function archiveOpenHolding(page: Page, name: string) {
  await page.getByRole('button', { name: `Archive ${name}` }).click();
  await page.getByRole('button', { name: 'Yes, archive it' }).click();
  await expect(page.getByTestId('detail-value')).toHaveCount(0, { timeout: 20_000 });
  await openList(page);
  expect(await rowsNamed(page, name), `${name} is still on a tab of the list`).toBe(0);
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
