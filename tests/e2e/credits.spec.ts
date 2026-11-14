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

/**
 * Entries of one day are listed spending first, then money in (spending carries no time of entry), and the list shows its first six: a
 * credit added today may be below them, and See all is how it is reached. Opened when it is there, so a short list works too.
 */
async function showAll(page: Page) {
  const seeAll = page.getByRole('button', { name: 'See all' });
  await expect(page.getByRole('region', { name: 'Recent expenses' })).toBeVisible({ timeout: 20_000 });
  if (await seeAll.isVisible()) await seeAll.click();
}

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

test('LI-I16 — a credit is listed on the Ledger beside the spending, with a sign and a word, and the filters sort it', async ({ page }) => {
  test.setTimeout(90_000);
  const payer = testName('credit-list');
  await onLedger(page);
  await openForm(page);
  await form(page).getByLabel('Amount').fill('1,42,000');
  await next(page);
  await form(page).getByLabel('From').fill(payer);
  await form(page).getByRole('button', { name: 'Add credit' }).click();
  await expect(form(page)).toHaveCount(0, { timeout: 20_000 });

  await showAll(page);
  const list = page.getByRole('region', { name: 'Recent expenses' });
  const row = list.locator('.recent-row').filter({ hasText: payer });
  await expect(row).toBeVisible({ timeout: 20_000 });
  // Direction is a sign and a word, as well as an arrow (LI-I16); a private credit says whose eyes it is for.
  await expect(row).toContainText('+₹1,42,000');
  await expect(row).toContainText('came in');
  await expect(row).toContainText('Salary');
  await expect(row).toContainText('only you see this row');
  // The line is named as one sentence, so a screen reader hears the direction and the word with the figure.
  await expect(list.getByRole('button', { name: new RegExp(`^Change ${payer}, .*\\+₹1,42,000, came in$`) })).toBeVisible();
  // Spending beside it is a minus and a word too, and a move would have no sign.
  const spendingRow = list.locator('.recent-row').filter({ hasText: /−₹/ }).first();
  await expect(spendingRow).toContainText('spent');

  const filters = list.getByRole('group', { name: 'Show' });
  await expect(filters.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await filters.getByRole('button', { name: 'Out', exact: true }).click();
  await expect(row).toHaveCount(0);
  await filters.getByRole('button', { name: 'In', exact: true }).click();
  await expect(row).toBeVisible();
  await filters.getByRole('button', { name: 'Moved', exact: true }).click();
  await expect(row).toHaveCount(0);
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(row).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the Ledger with money in listed has no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await onLedger(page);
    await openForm(page);
    await form(page).getByLabel('Amount').fill('1,42,000');
    await next(page);
    await form(page).getByLabel('From').fill(testName(`credit-axe-${scheme}`));
    await form(page).getByRole('button', { name: 'Add credit' }).click();
    await expect(form(page)).toHaveCount(0, { timeout: 20_000 });
    await showAll(page);
    await expect(page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row').filter({ hasText: 'came in' }).first()).toBeVisible({ timeout: 20_000 });
    const result = await new AxeBuilder({ page }).analyze();
    const found = result.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(found, found.join('\n')).toEqual([]);
  });
}

/** Add a private salary with a payer of its own, and wait for the list to have it. */
async function addSalary(page: Page, payer: string, amount: string) {
  await openForm(page);
  await form(page).getByLabel('Amount').fill(amount);
  await next(page);
  await form(page).getByLabel('From').fill(payer);
  await form(page).getByRole('button', { name: 'Add credit' }).click();
  await expect(form(page)).toHaveCount(0, { timeout: 20_000 });
  await showAll(page);
  const row = page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row').filter({ hasText: payer });
  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}

const changing = (page: Page) => page.getByRole('form', { name: 'Change a credit' });

test('a credit is corrected from the list: the form opens with its values, and the change is in the list', async ({ page }) => {
  test.setTimeout(90_000);
  const payer = testName('credit-change');
  await onLedger(page);
  const row = await addSalary(page, payer, '1,000');
  await row.click();
  await expect(changing(page)).toBeVisible();

  // Opened with what was entered; its currency is kept (the amount's label names it).
  await expect(changing(page).getByLabel(/^Amount/)).toHaveValue('1000.00');
  await expect(changing(page).getByRole('button', { name: 'Salary', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await changing(page).getByLabel(/^Amount/).fill('1,200');
  await next(page);
  await expect(changing(page).getByLabel('From')).toHaveValue(payer);
  // The owner may move it to another member, so the field is open and holds the member it was entered under.
  await expect(choiceField(page, 'Whose income')).toBeEnabled();
  await changing(page).getByRole('button', { name: 'Save changes' }).click();
  await expect(changing(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Credit changed.' })).toBeVisible();
  await showAll(page);
  await expect(page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row').filter({ hasText: payer })).toContainText('+₹1,200');
});

test('a credit is voided after asking: it stays in the list, marked, says it is not counted, and is not changed again', async ({ page }) => {
  test.setTimeout(90_000);
  const payer = testName('credit-void');
  await onLedger(page);
  const row = await addSalary(page, payer, '777');
  await row.click();
  await next(page);

  // Asked first, and Keep it leaves it as it was.
  await changing(page).getByRole('button', { name: 'Void this credit' }).click();
  await expect(changing(page).getByText('Void this credit? It stops counting and stays in the list, marked voided.')).toBeVisible();
  await changing(page).getByRole('button', { name: 'Keep it' }).click();
  await expect(changing(page).getByRole('button', { name: 'Void this credit' })).toBeVisible();

  await changing(page).getByRole('button', { name: 'Void this credit' }).click();
  await changing(page).getByRole('button', { name: 'Yes, void it' }).click();
  await expect(changing(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Credit voided.' })).toBeVisible();

  await showAll(page);
  const voided = page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row').filter({ hasText: payer });
  await expect(voided).toContainText('Voided');
  await expect(voided).toContainText('voided · not counted');
  // The end of a row's life: it is not a button any more.
  await expect(page.getByRole('button', { name: new RegExp(`^Change ${payer}`) })).toHaveCount(0);
});

test('leaving a credit being changed writes nothing', async ({ page }) => {
  test.setTimeout(90_000);
  const payer = testName('credit-keep');
  await onLedger(page);
  const row = await addSalary(page, payer, '500');
  await row.click();
  await changing(page).getByLabel(/^Amount/).fill('9,999');
  await changing(page).getByRole('button', { name: 'Close Change a credit' }).click();
  await expect(changing(page)).toHaveCount(0);
  await showAll(page);
  await expect(page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row').filter({ hasText: payer })).toContainText('+₹500');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the form that changes a credit has no accessibility violations on either step in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await onLedger(page);
    const row = await addSalary(page, testName(`credit-axe-change-${scheme}`), '1,000');
    await row.click();
    await expect(changing(page)).toBeVisible();
    const one = await new AxeBuilder({ page }).analyze();
    const foundOne = one.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(foundOne, foundOne.join('\n')).toEqual([]);

    await next(page);
    await changing(page).getByRole('button', { name: 'Void this credit' }).click();
    const two = await new AxeBuilder({ page }).analyze();
    const foundTwo = two.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(foundTwo, foundTwo.join('\n')).toEqual([]);
  });
}

test('a credit on an account that was archived since keeps that account when it is corrected', async ({ page }) => {
  test.setTimeout(120_000);
  const name = testName('credit-archived-acct');
  const payer = testName('credit-archived-payer');
  await onLedger(page);
  await openForm(page);
  await form(page).getByLabel('Amount').fill('2,000');
  await choose(page, 'Into which account', '+ Add an account');
  const adding = page.getByRole('form', { name: 'Add an account' });
  await adding.getByLabel('Name').fill(name);
  await adding.getByLabel('Last four digits').fill('3311');
  await adding.getByRole('button', { name: 'Add account' }).click();
  await expect(adding).toHaveCount(0, { timeout: 20_000 });
  await next(page);
  await form(page).getByLabel('From').fill(payer);
  await form(page).getByRole('button', { name: 'Add credit' }).click();
  await expect(form(page)).toHaveCount(0, { timeout: 20_000 });

  // The account is archived afterwards, on the Accounts tab.
  await page.getByRole('navigation', { name: 'Money' }).getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('list').getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await page.getByRole('form', { name: 'Change an account' }).getByRole('button', { name: 'Archive this account' }).click();
  await expect(page.getByRole('form', { name: 'Change an account' })).toHaveCount(0, { timeout: 20_000 });

  // Back on the Ledger the credit is changed: its account is shown, said to be archived, and is still its account afterwards.
  await page.getByRole('navigation', { name: 'Money' }).getByRole('link', { name: 'Ledger' }).click();
  await showAll(page);
  await page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row').filter({ hasText: payer }).click();
  await expect(choiceField(page, 'Into which account')).toContainText(`${name} ••3311 (archived)`);
  await changing(page).getByLabel(/^Amount/).fill('2,500');
  await next(page);
  await changing(page).getByRole('button', { name: 'Save changes' }).click();
  await expect(changing(page)).toHaveCount(0, { timeout: 20_000 });
  await showAll(page);
  const row = page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row').filter({ hasText: payer });
  await expect(row).toContainText('+₹2,500');
  await expect(row).toContainText(`${name} ••3311`);
  await expect(row).not.toContainText('no account');
});
