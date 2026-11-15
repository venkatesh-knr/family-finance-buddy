import { test, expect, type Page } from '@playwright/test';
import { testName } from './created.ts';

/**
 * A holding's entries name the account they were paid from or into (docs/design/ledger-income.md section 4a; LI-I28, LI-I30).
 *
 * The form offers *Paid from* once there is an account, and optional; and the month close reads the purchase as money into a holding rather than as
 * spent. Closing a month writes balances that last for the run, so the close is only opened when the month is still open, as month-close.spec does.
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

async function openPurchaseForm(page: Page) {
  await page.goto('/#/holdings?kind=mutual_fund');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.holding-row').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.holding-row').first().locator('a.holding-link').click();
  await expect(page.getByTestId('detail-value')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add a purchase or sale' }).first().click();
}

test('a purchase offers the account it was paid from, optional, and a sale the account it was paid into', async ({ page }) => {
  test.setTimeout(120_000);
  await addAccount(page, testName('paid-from'));
  await openPurchaseForm(page);
  const purchase = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add purchase' }) });
  const sale = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add sale' }) });
  await expect(purchase.getByRole('combobox', { name: /Paid from/ })).toBeVisible({ timeout: 20_000 });
  await expect(sale.getByRole('combobox', { name: /Paid into/ })).toBeVisible();
  // Not said is the first and the default: nothing is asked of a person who does not want to say.
  await expect(purchase.getByRole('combobox', { name: /Paid from/ })).toContainText('Not said');
  // An entry made before this says it named no account, and its edit form can name one.
  await page.getByRole('button', { name: /^Transactions/ }).first().click();
  const earlier = page.getByText('no account said').first();
  await expect(earlier).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Edit the .* entry$/ }).first().click();
  await expect(page.getByRole('combobox', { name: /Paid (from|into)/ }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).first().click();
});

test('a purchase paid from an account is recorded, and the close reads it as into holdings and not as spent', async ({ page }) => {
  test.setTimeout(180_000);
  const { word, day } = previousMonth();
  const name = testName('paid-close');
  await addAccount(page, name);
  await page.goto('/#/money');
  const prompt = page.getByRole('button', { name: new RegExp(`^Close ${word} · about 2 minutes$`) });
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
  test.skip((await prompt.count()) === 0, 'the month was closed earlier in this run');

  await openPurchaseForm(page);
  const purchase = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add purchase' }) });
  await purchase.getByLabel('Units').fill('1');
  await purchase.getByLabel(/^Cost/).fill('5000');
  await purchase.getByLabel('Bought on').fill(day);
  await purchase.getByRole('combobox', { name: /Paid from/ }).click();
  await page.getByRole('option', { name }).click();
  await purchase.getByRole('button', { name: 'Add purchase' }).click();
  // Recorded: the form is emptied, and nothing is said to be wrong.
  await expect(purchase.getByLabel('Units')).toHaveValue('', { timeout: 20_000 });
  await expect(purchase.getByRole('alert')).toHaveCount(0);

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
  // The purchase named an account, so it is money into a holding, and the close says so; nothing is said to be left unnamed on its account.
  await expect(close).toContainText('Into holdings · ₹5,000');
  // Leaving it writes nothing.
  await close.getByRole('button', { name: `Close Close ${word}` }).click();
  await expect(close).toHaveCount(0);
});
