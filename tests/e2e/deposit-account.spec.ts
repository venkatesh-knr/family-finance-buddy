import { test, expect, type Page } from '@playwright/test';
import { choose } from './fields.ts';
import { archiveByName, openFixedForm, typeTerms } from './holdings.ts';
import { testName } from './created.ts';

/**
 * A deposit, a bond and an opening cost name the account they were paid from or into (docs/design/ledger-income.md section 4b; LI-I32 to LI-I35).
 *
 * The deposit form offers *Paid from* and *Maturity paid into* once there is an account, both optional; and the month close reads a deposit paid
 * from an account as money into a holding rather than as spent. Closing a month writes balances that last for the run, so the close is only opened when
 * the month is still open, as month-close.spec does. Needs migration 20261115200000.
 */

test.use({ actionTimeout: 15_000 });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function previousMonth(): { word: string; day: string; nextYear: string } {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const total = Number(today.slice(0, 4)) * 12 + (Number(today.slice(5, 7)) - 1) - 1;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const stamp = `${String(month + 1).padStart(2, '0')}-10`;
  return { word: MONTHS[month] as string, day: `${String(year)}-${stamp}`, nextYear: `${String(year + 1)}-${stamp}` };
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

test('a deposit offers where its principal came from and where its maturity goes, both optional', async ({ page }) => {
  test.setTimeout(120_000);
  await addAccount(page, testName('fd-paid'));
  const form = await openFixedForm(page);
  await typeTerms(page, form, { name: testName('fd-offer'), amount: '100000', rate: '7.5', starts: '2026-01-01', matures: '2027-01-01', declineFirstReading: true });
  const paidFrom = form.getByRole('combobox', { name: /Paid from/ });
  const maturity = form.getByRole('combobox', { name: /Maturity paid into/ });
  await expect(paidFrom).toBeVisible({ timeout: 20_000 });
  await expect(maturity).toBeVisible();
  // Not said is the first and the default: nothing is asked of a person who does not want to say.
  await expect(paidFrom).toContainText('Not said');
  await expect(maturity).toContainText('Not said');
  // Nothing is written until the last step's button, so leaving the form here adds nothing.
});

test('a deposit paid from an account is read by the close as into holdings and not as spent', async ({ page }) => {
  test.setTimeout(240_000);
  const { word, day, nextYear } = previousMonth();
  const account = testName('fd-close');
  const deposit = testName('fd-close-deposit');
  await addAccount(page, account);
  await page.goto('/#/money');
  const prompt = page.getByRole('button', { name: new RegExp(`^Close ${word} · about 2 minutes$`) });
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
  test.skip((await prompt.count()) === 0, 'the month was closed earlier in this run');

  const form = await openFixedForm(page);
  await typeTerms(page, form, { name: deposit, amount: '100000', rate: '7.5', starts: day, matures: nextYear, declineFirstReading: true });
  await choose(page, 'Paid from', account);
  await form.getByRole('button', { name: 'Add the deposit' }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });

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
  // Earlier runs' entries are in the same month, so the figure is at least this deposit's ₹1,00,000.
  await expect(close).toContainText(/Into holdings · ₹[\d,]+/);
  const into = Number(/Into holdings · ₹([\d,]+)/.exec((await close.textContent()) ?? '')?.[1]?.replace(/,/g, ''));
  expect(into).toBeGreaterThanOrEqual(100_000);
  // Leaving it writes nothing.
  await close.getByRole('button', { name: `Close Close ${word}` }).click();
  await expect(close).toHaveCount(0);

  await archiveByName(page, deposit);
});
