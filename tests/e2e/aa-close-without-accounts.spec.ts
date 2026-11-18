import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

/**
 * The close of a household with no accounts (docs/design/spending-capture.md section 11.3; the MonthCloseNoAccounts boards): with no account there is no balance to
 * close from, so the close asks what the month cost, with the same linked fields as State the spend, and the month can be left itemised only.
 *
 * This file is named to run before the specs that add an account: once the household has one, the month closes from balances and these tests skip. The run's
 * teardown resets the household, which clears what is stated here.
 */

test.use({ actionTimeout: 15_000 });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthBefore(): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const index = Number(today.slice(0, 4)) * 12 + (Number(today.slice(5, 7)) - 1) - 1;
  return MONTHS[index % 12] as string;
}

/** Whether the footer offers the close by saying what the month cost: it is read from the database, so it is waited for. */
async function offered(page: Page): Promise<boolean> {
  await page.goto('/#/money');
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
  try {
    await expect(page.getByText('say what it cost · about a minute')).toBeVisible({ timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

test('with no account the footer offers to close by saying what the month cost, and the form can be left itemised only', async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!(await offered(page)), 'the household has an account, or the month is stated or closed already');
  await expect(page.getByText(`${monthBefore()} is ready to close`)).toBeVisible();
  await page.getByRole('button', { name: `Close ${monthBefore()}`, exact: true }).click();

  const form = page.getByRole('form', { name: `Close ${monthBefore()}` });
  await expect(form).toBeVisible();
  await expect(form).toContainText(`Close ${monthBefore()}: what did the month cost?`);
  await expect(form).toContainText('No accounts are added, so a close cannot work from balances.');

  // A way out that is a choice: nothing is written, and the month is offered again.
  await page.getByRole('button', { name: 'Keep it itemised only' }).click();
  await expect(page.getByRole('form', { name: `Close ${monthBefore()}` })).toHaveCount(0);
  await expect(page.getByText('say what it cost · about a minute')).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the close without accounts has no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    test.skip(!(await offered(page)), 'the household has an account, or the month is stated or closed already');
    await page.getByRole('button', { name: `Close ${monthBefore()}`, exact: true }).click();
    const form = page.getByRole('form', { name: `Close ${monthBefore()}` });
    await expect(form).toBeVisible();
    await form.getByLabel('Spent in total').fill('1');
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 110) ?? ''}`)).toEqual([]);
  });
}

test('saying what the month cost closes it: Last month shows it as stated, and the footer stops offering the close', async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!(await offered(page)), 'the household has an account, or the month is stated or closed already');
  // Last month is showing when the close is made, so the card has to change under it and not offer to state a month that is stated.
  await page.getByRole('group', { name: 'Month' }).getByRole('button', { name: 'Last month' }).click();
  const card = page.getByRole('region', { name: monthBefore() });
  await expect(card.getByTestId('month-state-action')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: `Close ${monthBefore()}`, exact: true }).click();
  const form = page.getByRole('form', { name: `Close ${monthBefore()}` });
  await form.getByLabel('Spent in total').fill('9,00,00,000');
  await form.getByRole('button', { name: `Close ${monthBefore()}`, exact: true }).click();

  await expect(page.getByRole('form', { name: `Close ${monthBefore()}` })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(`${monthBefore()} closed. Spent`)).toBeVisible();
  await expect(page.getByText('say what it cost · about a minute')).toHaveCount(0);
  await expect(page.getByText(`${monthBefore()} is closed`)).toBeVisible();
  await expect(page.getByText('from what you stated')).toBeVisible();

  await expect(card.getByTestId('month-spent')).toContainText('9,00,00,000', { timeout: 15_000 });
  await expect(card.getByText('stated', { exact: true })).toBeVisible();
  // It is stated now, so the card offers to change it and not to state it again.
  await expect(card.getByTestId('month-state-action').getByRole('button', { name: 'Change' })).toBeVisible();
});
