import { test, expect, type Page } from '@playwright/test';
import { ledgerEntry } from './ledger.ts';
import { testName } from './created.ts';

/**
 * The Expenses screen as its artboard draws it (docs/design/vibrant-canvas.html, Expenses): the month's spending
 * and its pace, a quick add folded to an amount, the plan, and recent entries by day.
 *
 * These are the claims about the arrangement. The entry flow itself (typed amount stored exactly, correction,
 * privacy) is `expense-round-trip.spec.ts` and `privacy-mode.spec.ts`.
 */

async function onExpenses(page: Page) {
  await page.goto('/#expenses');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'Recent expenses' })).toBeVisible({ timeout: 20_000 });
}

test('the screen runs in the artboard\'s order: the month, quick add, the plan, then recent entries', async ({ page }) => {
  await onExpenses(page);
  const tops: number[] = [];
  for (const name of ['This month', 'Add an expense', 'Plan', 'Recent expenses']) {
    const box = await page.getByRole('region', { name }).boundingBox();
    expect(box, `a region named "${name}"`).not.toBeNull();
    tops.push(box?.y ?? -1);
  }
  expect([...tops].sort((a, b) => a - b), 'the regions are in the order the board draws them').toEqual(tops);
});

test('the month says how much was spent, of how much, and whether that is early', async ({ page }) => {
  await onExpenses(page);
  const hero = page.getByRole('region', { name: 'This month' });
  await expect(hero.getByTestId('period-spent')).toContainText(/\d/);
  await expect(hero).toContainText(/planned · day \d+ of \d+/);
  await expect(hero).toContainText(/(ahead of|under|on) the month's pace|over the plan/);

  await hero.getByRole('button', { name: 'This year' }).click();
  await expect(page.getByRole('region', { name: 'This year' })).toContainText(/of \d+/);
  await expect(page.getByRole('region', { name: 'This year' })).toContainText(/(ahead of|under|on) the year's pace|over the plan/);
});

test('with amounts hidden the month\'s figure has no digits in it', async ({ page }) => {
  await onExpenses(page);
  await page.getByRole('button', { name: /Amounts shown/ }).click();
  await expect(page.getByTestId('period-spent')).not.toContainText(/\d/);
});

test('quick add is an amount and a payee side by side, and the rest is one line further', async ({ page }) => {
  await onExpenses(page);
  const amount = await page.getByLabel(/^Amount \(/).boundingBox();
  const payee = await page.getByLabel('Payee').boundingBox();
  expect(Math.abs((amount?.y ?? 0) - (payee?.y ?? 99))).toBeLessThan(6);

  // Folded: no date, no member, no private tick.
  await expect(page.getByLabel('Date', { exact: true })).toHaveCount(0);
  const fold = page.getByRole('button', { name: /^Today · you · shared$/ });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Date', { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Keep this private/)).toBeVisible();

  // Ticking private changes what the line says, so it is never a secret from the person filing.
  await page.getByLabel(/Keep this private/).check();
  await expect(page.getByRole('button', { name: /^Today · you · private$/ })).toBeVisible();
});

test('a category chip files the entry under that category, and the entry is under Today', async ({ page }) => {
  await onExpenses(page);
  const chips = page.getByRole('group', { name: 'Category' }).getByRole('button').filter({ hasNotText: 'More' });
  const chip = chips.first();
  const category = (await chip.innerText()).trim();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  const payee = testName('chip');
  await page.getByLabel(/^Amount \(/).fill('37.50');
  await page.getByLabel('Payee').fill(payee);
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const row = ledgerEntry(page, payee);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(category);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
});

test('"File them" leads to the entries that have no category, and Show all comes back', async ({ page }) => {
  await onExpenses(page);
  const file = page.getByRole('button', { name: 'File them' });
  test.skip((await file.count()) === 0, 'every entry in this household has a category');

  await file.click();
  await expect(page.getByRole('heading', { name: 'Not filed yet' })).toBeVisible();
  const rows = page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row');
  expect(await rows.count()).toBeGreaterThan(0);
  for (let i = 0; i < (await rows.count()); i += 1) {
    await expect(rows.nth(i)).toContainText('Uncategorised');
  }

  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();
});

test('"See all" shows more than the first few, and "Show fewer" puts them back', async ({ page }) => {
  await onExpenses(page);
  const seeAll = page.getByRole('button', { name: 'See all' });
  test.skip((await seeAll.count()) === 0, 'six entries or fewer');

  const rows = page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row');
  const first = await rows.count();
  await seeAll.click();
  expect(await rows.count()).toBeGreaterThan(first);
  await page.getByRole('button', { name: 'Show fewer' }).click();
  expect(await rows.count()).toBe(first);
});

test('moving an entry to another member takes the private tick off it', async ({ page }) => {
  await onExpenses(page);
  await page.getByRole('button', { name: /^Today · you · shared$/ }).click();
  const member = page.getByRole('combobox', { name: /^Member/ });
  test.skip((await member.count()) === 0, 'this account can only file under its own name');

  await page.getByLabel(/Keep this private/).check();
  await expect(page.getByRole('button', { name: /^Today · you · private$/ })).toBeVisible();

  // Somebody else: the tick goes, and the line says shared again. Private is the filer's own choice on their own
  // entry; left on, the form filed it private under a member who never chose that.
  const others = await member.locator('option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value),
  );
  const current = await member.inputValue();
  await member.selectOption(others.find((value) => value !== current) ?? current);
  await expect(page.getByLabel(/Keep this private/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /· shared$/ })).toBeVisible();
});

test('"File them" brings the list it filtered into view and moves focus to it', async ({ page }) => {
  await onExpenses(page);
  const file = page.getByRole('button', { name: 'File them' });
  test.skip((await file.count()) === 0, 'every entry in this household has a category');

  await file.click();
  const heading = page.getByRole('heading', { name: 'Not filed yet' });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
});
