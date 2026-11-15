import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { testName } from './created.ts';

/**
 * The month close (docs/design/spending-capture.md sections 2 and 6; LI-I6, LI-I7; the MonthClose board): from the 1st, *Close October · about 2
 * minutes*; the balances at the two ends of the month in, and what was spent out, derived and never stored; nothing written until the last button.
 *
 * Closing a month writes balances that last for the run, and a closed month no longer offers the prompt, so the tests that need it are in the
 * order that works and skip when it is gone: the first project to run closes it, and the other finds it closed.
 */

test.use({ actionTimeout: 15_000 });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The month the prompt offers: the one before this, in India. */
function monthBefore(): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const index = Number(today.slice(0, 4)) * 12 + (Number(today.slice(5, 7)) - 1) - 1;
  return MONTHS[index % 12] as string;
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

async function onLedger(page: Page) {
  await page.goto('/#/money');
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
}

const prompt = (page: Page) => page.getByRole('button', { name: new RegExp(`^Close ${monthBefore()} · about 2 minutes$`) });
const form = (page: Page) => page.getByRole('form', { name: `Close ${monthBefore()}` });

/** Open the close, or skip the test when the month has already been closed in this run. */
async function openClose(page: Page) {
  await onLedger(page);
  test.skip((await prompt(page).count()) === 0, 'the month was closed earlier in this run');
  await prompt(page).click();
  await expect(form(page)).toBeVisible();
}

/** Type a balance into every closing and opening field there is. */
async function fillAll(page: Page, closing: string, opening: string) {
  const closings = form(page).getByLabel(/^Closing balance/);
  for (let i = 0; i < (await closings.count()); i += 1) await closings.nth(i).fill(closing);
  const openings = form(page).getByLabel(/^Opening balance/);
  for (let i = 0; i < (await openings.count()); i += 1) await openings.nth(i).fill(opening);
}

test('the prompt is there from the 1st once there is an account, and the close asks for balances and says it is not counted as nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await addAccount(page, testName('close-a'));
  await openClose(page);
  const result = form(page).getByTestId('close-result');
  await expect(result).toContainText(`Spent in ${monthBefore()}`);
  // With the balances not typed yet there is no figure, said in words and not as nothing.
  await expect(result).toContainText('Type each account’s balance below to see what was spent');
  await expect(form(page)).toContainText('A payment in that isn’t listed makes this read low');
  await expect(form(page).getByLabel(/^Closing balance/).first()).toHaveAttribute('aria-required', 'true');
  await expect(form(page).getByRole('button', { name: `Close ${monthBefore()}`, exact: true })).toBeDisabled();
});

test('an amount that is not an amount is said so beside the field, and the month cannot be closed until it is', async ({ page }) => {
  test.setTimeout(120_000);
  await openClose(page);
  await fillAll(page, '1000', '1000');
  await form(page).getByLabel(/^Closing balance/).first().fill('a lot');
  await expect(form(page).getByText(/The balance is a number, such as 2,20,380, with no minus sign/)).toBeVisible();
  await expect(form(page).getByRole('button', { name: `Close ${monthBefore()}`, exact: true })).toBeDisabled();
  // Leaving it writes nothing: the prompt is still there.
  await form(page).getByRole('button', { name: `Close Close ${monthBefore()}` }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(prompt(page)).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the close has no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await openClose(page);
    await fillAll(page, '1000', '1000');
    await expect(form(page).getByTestId('close-spent').first()).toBeVisible({ timeout: 20_000 });
    const result = await new AxeBuilder({ page }).analyze();
    const found = result.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(found, found.join('\n')).toEqual([]);
  });
}

test('with amounts hidden a balance can still be typed, and what is typed is not taken from the person', async ({ page }) => {
  test.setTimeout(120_000);
  await onLedger(page);
  test.skip((await prompt(page).count()) === 0, 'the month was closed earlier in this run');
  await page.getByRole('button', { name: /Amounts shown/ }).click();
  await prompt(page).click();
  await expect(form(page)).toBeVisible();
  // An account whose balance was saved in an earlier close is hidden and read-only, as it should be; the one being typed is the first that is empty.
  const field = form(page).getByLabel(/^Closing balance/).and(page.locator('input:not([readonly])')).first();
  await field.fill('5000');
  await expect(field).toHaveValue('5000');
  await expect(field).not.toHaveAttribute('readonly', /.*/);
  // What the figures come to is hidden, not the typing.
  await expect(form(page).getByTestId('close-result')).not.toContainText('5,000');
});

test('LI-I6 — with balances typed the result is derived, the month is closed, and the prompt goes', async ({ page }) => {
  test.setTimeout(150_000);
  const name = testName('close-final');
  await addAccount(page, name);
  await openClose(page);
  await fillAll(page, '5000', '5000');

  // Derived from the balances, with what was itemised beside it.
  const spent = form(page).getByTestId('close-spent').first();
  await expect(spent).toContainText('₹', { timeout: 20_000 });
  await expect(form(page).getByTestId('close-result')).toContainText('from balances');
  await expect(form(page).getByTestId('close-result')).toContainText('itemised');

  await form(page).getByRole('button', { name: `Close ${monthBefore()}`, exact: true }).click();
  await expect(form(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('status').filter({ hasText: `${monthBefore()} closed.` })).toBeVisible({ timeout: 20_000 });

  // Closed: every account in use has a closing balance on the last day, so the prompt is gone, and a reload keeps it gone.
  await expect(prompt(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
  await expect(prompt(page)).toHaveCount(0);

  // The balance is kept on the account: the Accounts screen shows it, as at the last day of the month.
  await page.goto('/#/accounts');
  const row = page.getByRole('region', { name: 'Accounts' }).getByRole('listitem').filter({ hasText: name });
  await expect(row).toContainText('₹5,000', { timeout: 20_000 });
});
