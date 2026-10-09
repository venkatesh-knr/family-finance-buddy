import { test, expect } from '@playwright/test';

/**
 * A deposit is entered as its terms and valued from them.
 *
 * `docs/blueprint.md`: "the app asks for the terms, not the current value. Maturity value
 * and accrued interest are computed, not typed." So this types a principal, a rate and
 * two dates, and checks the screen has worked out what the deposit paid.
 *
 * The dates are in the past on purpose, so the deposit has matured and its value is its
 * maturity value for ever: 1,00,000 at 7.5%, credited yearly for one year, is 1,07,500.
 * A deposit still running would give a different figure every day, and a test that
 * depended on the day it ran would be testing the clock.
 *
 * It writes to the demo household like the others, and archives what it made, since
 * deleting is not a thing this app does.
 */

test('a deposit is valued from its terms, and a matured one says so', async ({ page }) => {
  const name = `e2e-fd-${Date.now()}`;

  await page.goto('/#holdings');
  await page.getByRole('button', { name: 'Add a deposit or bond' }).click();

  const form = page.locator('form').filter({ hasText: 'Fixed deposit' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Principal').fill('100000');
  await form.getByLabel('Rate %', { exact: true }).fill('7.5');
  await form.getByLabel('Starts').fill('2024-01-01');
  await form.getByLabel('Matures').fill('2025-01-01');
  await form.getByRole('button', { name: 'Add the deposit' }).click();

  const entry = page.getByRole('listitem').filter({ hasText: name });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('Matured');
  // Principal 1,00,000 plus a year at 7.5%, which is what the bank pays.
  await expect(entry).toContainText('1,07,500');
  // Said to be worked out, not recorded: nothing here was typed as a value.
  await expect(page.getByText(/worked out from the terms/i).first()).toBeVisible();

  // Tidy up. The holding is archived, which takes it off every screen.
  const holding = page
    .locator('section', { hasText: name })
    .filter({ has: page.getByRole('button', { name: 'Archive this holding' }) })
    .last();
  await holding.getByRole('button', { name: 'Archive this holding' }).click();
  await holding.getByRole('button', { name: 'Yes, archive it' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
});

test('a bond is asked for a coupon and not for a compounding', async ({ page }) => {
  await page.goto('/#holdings');
  await page.getByRole('button', { name: 'Add a deposit or bond' }).click();
  await page.getByRole('button', { name: 'Bond', exact: true }).click();

  // A bond pays coupons and does not compound, so the form offers the one and not the other.
  await expect(page.getByLabel('Coupon paid')).toBeVisible();
  await expect(page.getByLabel(/Compounds/)).toHaveCount(0);
});

test('a deposit held without terms is given them, not entered a second time', async ({ page }) => {
  const name = `e2e-held-${Date.now()}`;

  await page.goto('/#holdings');
  await page.getByRole('button', { name: 'Add a holding' }).click();

  // The way deposits were entered before there were terms: a holding of kind deposit.
  const add = page.locator('form').filter({ hasText: 'Priced in' });
  await add.getByLabel('Name', { exact: true }).fill(name);
  await add.locator('select').nth(0).selectOption('deposit');
  await add.locator('select').nth(1).selectOption('INR');
  await add.locator('select').nth(2).selectOption('INR');
  await page.getByLabel(/Foreign asset for disclosure/).uncheck();
  await add.getByLabel('Quantity').fill('1');
  await add.getByRole('button', { name: 'Add', exact: true }).click();

  const without = page.getByRole('listitem').filter({ hasText: name }).filter({ hasText: 'Give its terms' });
  await expect(without).toBeVisible();
  await without.getByRole('button', { name: 'Give its terms' }).click();

  const terms = page.locator('form').filter({ hasText: `Terms for ${name}` });
  await terms.getByLabel('Principal').fill('50000');
  await terms.getByLabel('Rate %', { exact: true }).fill('7');
  await terms.getByLabel('Starts').fill('2024-01-01');
  await terms.getByLabel('Matures').fill('2025-01-01');
  await terms.getByRole('button', { name: 'Save the terms' }).click();

  // It is valued from them, as the same holding: it is no longer offered terms.
  const entry = page.getByRole('listitem').filter({ hasText: name }).filter({ hasText: 'Paid out' });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('53,500');
  await expect(without).toHaveCount(0);

  const holding = page
    .locator('section', { hasText: name })
    .filter({ has: page.getByRole('button', { name: 'Archive this holding' }) })
    .last();
  await holding.getByRole('button', { name: 'Archive this holding' }).click();
  await holding.getByRole('button', { name: 'Yes, archive it' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
});
