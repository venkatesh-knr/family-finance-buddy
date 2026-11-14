import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { testName } from './created.ts';
import { choose, choiceField, next } from './fields.ts';

/**
 * Add money in (docs/design/ledger-income.md section 2, LI-I4, LI-I25; the AddCredit and AddCredit2 boards): a credit written in two steps,
 * with an account or with none, and an account added from the picker without losing what was typed.
 *
 * The suite's household is reset after every run, which removes what these tests make.
 */

test.use({ actionTimeout: 15_000 });

async function onLedger(page: Page) {
  await page.goto('/#/money');
  await expect(page.getByRole('navigation', { name: 'Money' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
}

const form = (page: Page) => page.getByRole('form', { name: 'Add money in' });

async function openForm(page: Page) {
  await page.getByRole('button', { name: '+ Money in' }).click();
  await expect(form(page)).toBeVisible();
}

test('Money in is two steps, and nothing can be added without an amount', async ({ page }) => {
  await onLedger(page);
  await openForm(page);

  await expect(form(page).locator('.required-key:visible')).toContainText('needed');
  await expect(form(page).getByLabel('Amount')).toHaveAttribute('aria-required', 'true');
  await expect(form(page).getByRole('button', { name: 'Next', exact: true })).toBeDisabled();

  await form(page).getByLabel('Amount').fill('1,42,000');
  await expect(form(page).getByRole('button', { name: 'Next', exact: true })).toBeEnabled();

  // Words are said under the field, not by a disabled button alone.
  await form(page).getByLabel('Amount').fill('a lot');
  await form(page).getByLabel('Amount').blur();
  await expect(form(page).getByText('The amount is a number, such as 1,42,000.')).toBeVisible();
  await expect(form(page).getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
});

test('a salary with no account is added, private to the person who adds it, and Back keeps what was typed', async ({ page }) => {
  await onLedger(page);
  await openForm(page);
  await form(page).getByLabel('Amount').fill('1,42,000');
  // Seven kinds, and Salary is the one chosen to begin with.
  await expect(form(page).getByRole('button', { name: 'Salary', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(form(page).getByRole('button', { name: 'Refund or money back', exact: true })).toBeVisible();
  await expect(choiceField(page, 'Into which account')).toContainText('No account');
  await next(page);

  await expect(form(page).getByRole('button', { name: 'Only me', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await form(page).getByRole('button', { name: 'Back' }).click();
  await expect(form(page).getByLabel('Amount')).toHaveValue('1,42,000');
  await next(page);

  await form(page).getByLabel('From').fill(testName('credit-payer'));
  await form(page).getByRole('button', { name: 'Add credit' }).click();
  await expect(form(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Added Salary' })).toContainText('₹1,42,000');
});

test('a refund starts as the household’s, and income as private', async ({ page }) => {
  await onLedger(page);
  await openForm(page);
  await form(page).getByLabel('Amount').fill('500');
  await form(page).getByRole('button', { name: 'Refund or money back', exact: true }).click();
  await next(page);
  await expect(form(page).getByRole('button', { name: 'The household', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(form(page).getByRole('button', { name: 'Only me', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('an account added from the picker comes back chosen, with the amount still there, and a private credit on it is flagged', async ({ page }) => {
  test.setTimeout(90_000);
  const name = testName('credit-acct');
  await onLedger(page);
  await openForm(page);
  await form(page).getByLabel('Amount').fill('25,000');
  await form(page).getByRole('button', { name: 'Interest', exact: true }).click();

  await choose(page, 'Into which account', '+ Add an account');
  const adding = page.getByRole('form', { name: 'Add an account' });
  await expect(adding).toBeVisible();
  await adding.getByLabel('Name').fill(name);
  await adding.getByLabel('Last four digits').fill('7710');
  await adding.getByRole('button', { name: 'Add account' }).click();
  await expect(adding).toHaveCount(0, { timeout: 20_000 });

  // Back on the form: the account is chosen and nothing typed was lost.
  await expect(form(page)).toBeVisible();
  await expect(choiceField(page, 'Into which account')).toContainText(`${name} ••7710`);
  await expect(form(page).getByLabel('Amount')).toHaveValue('25,000');
  await expect(form(page).getByRole('button', { name: 'Interest', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // The account is the household's (the form's default), so a private credit there is private in the list only.
  await next(page);
  await expect(form(page).getByText('is shared with the household. Its balance is seen by the household')).toBeVisible();
  await form(page).getByRole('button', { name: 'The household', exact: true }).click();
  await expect(form(page).getByText('is shared with the household. Its balance is seen by the household')).toHaveCount(0);

  await form(page).getByRole('button', { name: 'Add credit' }).click();
  await expect(form(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Added Interest' })).toContainText('₹25,000');
});

test('leaving the form half-way writes nothing', async ({ page }) => {
  await onLedger(page);
  await openForm(page);
  await form(page).getByLabel('Amount').fill('900');
  await form(page).getByRole('button', { name: 'Close Add money in' }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Added' })).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Add money in has no accessibility violations on either step in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await onLedger(page);
    await openForm(page);
    await form(page).getByLabel('Amount').fill('1,42,000');
    const one = await new AxeBuilder({ page }).analyze();
    const foundOne = one.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(foundOne, foundOne.join('\n')).toEqual([]);

    await next(page);
    const two = await new AxeBuilder({ page }).analyze();
    const foundTwo = two.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(foundTwo, foundTwo.join('\n')).toEqual([]);
  });
}
