import { test, expect, type Page } from '@playwright/test';
import { choose } from './fields.ts';
import { chooseHousehold, resetHousehold, testHouseholdName, testName } from './created.ts';

/**
 * A payment on a loan (docs/design/ledger-income.md section 4c; LI-I36 to LI-I39).
 *
 * The loans card of the plan offers *Payments* on each loan: the amount starts from the instalment, *Paid from* is optional with *Not said* first, a payment
 * is listed on its loan with the account it left, and a void asks first and leaves it listed, marked. The month close reads a payment that names an
 * account as *Paid to loans* and not as spent. Closing a month writes balances that last for the run, so the close is only opened when the month is still
 * open, as month-close.spec does. Needs migration 20261116120000.
 */

test.use({ actionTimeout: 15_000 });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function previousMonth(): { word: string; day: string } {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const total = Number(today.slice(0, 4)) * 12 + (Number(today.slice(5, 7)) - 1) - 1;
  const year = Math.floor(total / 12);
  const month = total % 12;
  return { word: MONTHS[month] as string, day: `${String(year)}-${String(month + 1).padStart(2, '0')}-10` };
}

async function addAccount(page: Page, name: string) {
  await page.goto('/#/accounts');
  await expect(page.getByRole('button', { name: '+ Add an account' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '+ Add an account' }).click();
  const form = page.getByRole('form', { name: 'Add an account' });
  await form.getByLabel('Name').fill(name);
  await form.getByRole('button', { name: 'Add account' }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });
}

/** Open the plan's loans card and add a loan with a ₹32,000 instalment; returns the row it is listed in. */
async function addLoan(page: Page, name: string) {
  await page.goto('/#fire');
  await expect(page.getByText('Financial independence', { exact: true })).toBeVisible({ timeout: 20_000 });
  const toggle = page.getByRole('button', { name: /^Loans and policies/ }).first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByLabel('Name', { exact: true }).last().fill(name);
  await page.getByLabel('Amount', { exact: true }).last().fill('32000');
  await page.getByRole('button', { name: 'Add a loan' }).click();
  const row = page.locator('li', { hasText: name });
  await expect(row.getByRole('button', { name: /^Payments · 0$/ })).toBeVisible({ timeout: 20_000 });
  return row;
}

test('a payment on a loan starts from the instalment, names an account, is listed, and is voided after asking', async ({ page }) => {
  test.setTimeout(180_000);
  const account = testName('loan-acct');
  const loan = testName('loan');
  await addAccount(page, account);
  const row = await addLoan(page, loan);

  await row.getByRole('button', { name: /^Payments · 0$/ }).click();
  const form = row.getByRole('form', { name: `Record a payment on ${loan}` });
  await expect(form.getByLabel('Amount paid')).toHaveValue('32000');
  // Not said is the first and the default: nothing is asked of a person who does not want to say.
  await expect(form.getByRole('combobox', { name: /Paid from/ })).toContainText('Not said');
  await choose(page, 'Paid from', account, form);
  await form.getByRole('button', { name: 'Record payment' }).click();

  await expect(row.getByRole('button', { name: /^Payments · 1$/ })).toBeVisible({ timeout: 20_000 });
  const payment = row.locator('li', { hasText: account });
  await expect(payment).toContainText('₹32,000');

  // A void asks first, and Keep it leaves the payment as it was.
  await payment.getByRole('button', { name: /^Void the payment/ }).click();
  await expect(payment).toContainText('Void this payment?');
  await payment.getByRole('button', { name: 'Keep it' }).click();
  await expect(row.getByRole('button', { name: /^Payments · 1$/ })).toBeVisible();
  await payment.getByRole('button', { name: /^Void the payment/ }).click();
  await payment.getByRole('button', { name: 'Yes, void it' }).click();
  await expect(row.getByRole('button', { name: /^Payments · 0$/ })).toBeVisible({ timeout: 20_000 });
  await expect(row.locator('li', { hasText: 'voided' })).toBeVisible();
});

test('a payment that names an account is read by the close as paid to loans and not as spent', async ({ page }) => {
  test.setTimeout(240_000);
  const { word, day } = previousMonth();
  const account = testName('loan-close');
  const loan = testName('loan-close-loan');
  await addAccount(page, account);
  await page.goto('/#/money');
  const prompt = page.getByRole('button', { name: new RegExp(`^Close ${word} · about 2 minutes$`) });
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
  test.skip((await prompt.count()) === 0, 'the month was closed earlier in this run');

  const row = await addLoan(page, loan);
  await row.getByRole('button', { name: /^Payments · 0$/ }).click();
  const form = row.getByRole('form', { name: `Record a payment on ${loan}` });
  await form.getByLabel('Paid on').fill(day);
  await choose(page, 'Paid from', account, form);
  await form.getByRole('button', { name: 'Record payment' }).click();
  await expect(row.getByRole('button', { name: /^Payments · 1$/ })).toBeVisible({ timeout: 20_000 });

  await page.goto('/#/money');
  await expect(prompt).toBeVisible({ timeout: 20_000 });
  await prompt.click();
  const close = page.getByRole('form', { name: `Close ${word}` });
  await expect(close).toBeVisible();
  const closings = close.getByLabel(/^Closing balance/);
  for (let i = 0; i < (await closings.count()); i += 1) await closings.nth(i).fill('1000');
  const openings = close.getByLabel(/^Opening balance/);
  for (let i = 0; i < (await openings.count()); i += 1) await openings.nth(i).fill('1000');
  await expect(close.getByTestId('close-spent').first()).toContainText('₹', { timeout: 20_000 });
  // Earlier runs' payments are in the same month, so the figure is at least this payment's ₹32,000.
  await expect(close).toContainText(/Paid to loans · ₹[\d,]+/);
  const paid = Number(/Paid to loans · ₹([\d,]+)/.exec((await close.textContent()) ?? '')?.[1]?.replace(/,/g, ''));
  expect(paid).toBeGreaterThanOrEqual(32_000);
  // Leaving it writes nothing.
  await close.getByRole('button', { name: `Close Close ${word}` }).click();
  await expect(close).toHaveCount(0);
});

// A loan cannot be deleted, and one with no balance recorded marks the Overview's net worth, which the specs that read it after this one would find.
// So the household goes back to the seed, as the teardown does at the end of the run. Without a household of its own there is nothing it may reset.
test('the loans it made are cleared, so what the other specs read is the seed’s', async ({ page }) => {
  test.setTimeout(180_000);
  const dedicated = testHouseholdName();
  test.skip(dedicated === null, 'there is no household of its own to reset');
  if (dedicated === null) return;
  await chooseHousehold(page, dedicated);
  await resetHousehold(page);
});
