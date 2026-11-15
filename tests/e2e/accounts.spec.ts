import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { testName } from './created.ts';

/**
 * Accounts (docs/design/ledger-income.md section 1a; LI-I24, LI-I25): behind More at `#/accounts`, an account added
 * with a name, a type and whose it is, changed, archived and restored, and the mark on the fields the form needs.
 *
 * The suite's household is reset after every run, which removes the accounts these tests make. Each test names its own account, so the two
 * projects, and a rerun, do not meet.
 */

test.use({ actionTimeout: 15_000 });

async function onAccounts(page: Page) {
  await page.goto('/#/accounts');
  await expect(page.getByRole('button', { name: '+ Add an account' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
}

/** Add an account through the form, and wait for the form to close. */
async function addAccount(page: Page, name: string, options: { type?: 'Current' | 'Card'; last4?: string; bank?: string } = {}) {
  await page.getByRole('button', { name: '+ Add an account' }).click();
  const form = page.getByRole('form', { name: 'Add an account' });
  await expect(form).toBeVisible();
  await form.getByLabel('Name').fill(name);
  if (options.type !== undefined) await form.getByRole('button', { name: options.type, exact: true }).click();
  if (options.bank !== undefined) await form.getByLabel('Bank').fill(options.bank);
  if (options.last4 !== undefined) await form.getByLabel('Last four digits').fill(options.last4);
  await form.getByRole('button', { name: 'Add account' }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });
}

test('an old Expenses address becomes the Money address, and replaces itself', async ({ page }) => {
  await page.goto('/#/expenses?x=1');
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).hash).toBe('#/money?x=1');
  await page.goto('/#/expenses');
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).hash).toBe('#/money');
});

test('LI-I25 — Money has no tabs, and Accounts is behind More, an address of its own', async ({ page }) => {
  await page.goto('/#/money');
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'Money' })).toHaveCount(0);

  // More has the row, and it opens the screen.
  await page.goto('/#/more');
  await page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: /^Accounts/ }).click();
  expect(new URL(page.url()).hash).toBe('#/accounts');
  await expect(page.getByRole('region', { name: 'What an account is' })).toBeVisible({ timeout: 20_000 });

  // Back undoes it.
  await page.goBack();
  await expect(page.getByRole('navigation', { name: 'More' })).toBeVisible();
});

test('the old Accounts tab address replaces itself with the Accounts screen', async ({ page }) => {
  await page.goto('/#/money?tab=accounts');
  await expect(page.getByRole('region', { name: 'What an account is' })).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).hash).toBe('#/accounts');
});

test('Money leads to Accounts: a quiet line to manage them, or a card that asks for the first one', async ({ page }) => {
  test.setTimeout(120_000);
  await onAccounts(page);
  await addAccount(page, testName('nudge-acct'));
  await page.goto('/#/money');
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
  const manage = page.getByRole('link', { name: /^Accounts · \d+ · Manage$/ });
  await expect(manage).toBeVisible({ timeout: 20_000 });
  await manage.click();
  expect(new URL(page.url()).hash).toBe('#/accounts');
  await expect(page.getByRole('region', { name: 'What an account is' })).toBeVisible({ timeout: 20_000 });
});

test('Money is quick add first, then the month card with + Money in, the close and the way to Accounts side by side inside it', async ({ page }) => {
  await page.goto('/#/money');
  const card = page.getByRole('region', { name: 'The month so far' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  const quickAdd = page.getByRole('region', { name: 'Add an expense' });
  await expect(quickAdd).toBeVisible();
  expect((await quickAdd.boundingBox())?.y ?? Number.NaN, 'quick add is above the month').toBeLessThan((await card.boundingBox())?.y ?? Number.NaN);

  // The three actions are inside the card, in a row: money in, then the way to Accounts (the close is offered between them while a month is due).
  const moneyIn = card.getByRole('button', { name: '+ Money in' });
  const accounts = card.getByRole('link', { name: /^Accounts · \d+ · Manage$|^Add accounts$/ });
  await expect(moneyIn).toBeVisible({ timeout: 20_000 });
  await expect(accounts).toBeVisible();
  const first = await moneyIn.boundingBox();
  const last = await accounts.boundingBox();
  expect(first, 'money in is drawn').not.toBeNull();
  expect(last, 'the way to Accounts is drawn').not.toBeNull();
  const cardBox = await card.boundingBox();
  expect((first?.y ?? 0) > (cardBox?.y ?? 0), 'inside the card').toBe(true);
  // Side by side where there is room for it: on a phone the row may wrap, so only the desktop is held to one line.
  if ((page.viewportSize()?.width ?? 0) >= 900) expect(Math.abs((first?.y ?? 0) - (last?.y ?? 99))).toBeLessThan(6);
});

test('the Accounts screen says what is kept, and what an account is not', async ({ page }) => {
  await onAccounts(page);
  const kept = page.getByRole('region', { name: 'What an account is' });
  await expect(kept).toContainText('No account number, no bank login, and no link to your bank');
  await expect(page.getByRole('button', { name: '+ Add an account' })).toBeVisible();
});

test('an account needs a name, and only that: the form marks what it needs and says why', async ({ page }) => {
  await onAccounts(page);
  await page.getByRole('button', { name: '+ Add an account' }).click();
  const form = page.getByRole('form', { name: 'Add an account' });
  await expect(form).toBeVisible();

  // The mark is an asterisk, announced as required, with one line of key (the 13 November decision on required fields).
  await expect(form.locator('.required-key')).toContainText('needed');
  await expect(form.getByLabel('Name')).toHaveAttribute('aria-required', 'true');
  // The Type always has a value (Savings is chosen), so its group needs no announcement; the asterisk is on its label all the same.
  await expect(form.getByRole('group', { name: /^Type/ })).toBeVisible();
  expect(await form.locator('.required-mark').count()).toBeGreaterThanOrEqual(3);

  const add = form.getByRole('button', { name: 'Add account' });
  await expect(add).toBeDisabled();
  await form.getByLabel('Name').fill(testName('acct-name'));
  await expect(add).toBeEnabled();

  // Last four digits are optional, and when given they are four characters, never the full number.
  await form.getByLabel('Last four digits').fill('12');
  await expect(form.getByText(/Four letters or digits/)).toBeVisible();
  await expect(add).toBeDisabled();
  await form.getByLabel('Last four digits').fill('');
  await expect(add).toBeEnabled();
});

test('LI-I24 — an account is added with a name alone, and its row shows the name and says there is no last four', async ({ page }) => {
  const name = testName('acct-bare');
  await onAccounts(page);
  await addAccount(page, name);

  const row = page.getByRole('listitem').filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('Savings');
  await expect(row).toContainText('no last four');
  await expect(row).toContainText('the household sees it');
  // A nickname is enough: nothing is drawn where the last four would be.
  await expect(row).not.toContainText('••');
  await expect(row).toContainText('no balance yet');
  await expect(row).toContainText('not in a close yet');
});

test('an account is changed, archived and restored, and archived is not deleted', async ({ page }) => {
  const name = testName('acct-cycle');
  const renamed = `${name}-b`;
  await onAccounts(page);
  await addAccount(page, name, { type: 'Card', last4: '1188', bank: 'E2E Bank' });

  const row = page.getByRole('listitem').filter({ hasText: name });
  await expect(row).toContainText(`${name} ••1188`, { timeout: 20_000 });
  await expect(row).toContainText('Card');

  // Change it: name and last four are open, and the type, with no entries yet, is too.
  await row.getByRole('button').click();
  const change = page.getByRole('form', { name: 'Change an account' });
  await expect(change).toBeVisible();
  await expect(change.getByRole('button', { name: 'Card', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await change.getByLabel('Name').fill(renamed);
  // A change of type is kept, not dropped: nothing has been recorded against the account, so it is still open.
  await change.getByRole('button', { name: 'Current', exact: true }).click();
  await change.getByRole('button', { name: 'Save changes' }).click();
  await expect(change).toHaveCount(0, { timeout: 20_000 });
  const renamedRow = page.getByRole('listitem').filter({ hasText: renamed });
  await expect(renamedRow).toBeVisible({ timeout: 20_000 });
  await expect(renamedRow).toContainText('Current');
  await expect(renamedRow).not.toContainText('Card');

  // Archive it: it leaves the list and is kept, folded, with its history.
  await page.getByRole('listitem').filter({ hasText: renamed }).getByRole('button').click();
  await page.getByRole('form', { name: 'Change an account' }).getByRole('button', { name: 'Archive this account' }).click();
  await expect(page.getByRole('form', { name: 'Change an account' })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'Accounts' }).getByText(renamed)).toHaveCount(0);
  const archived = page.getByRole('region', { name: 'Archived' });
  await expect(archived).toContainText('Archived');
  await archived.getByRole('button', { name: /^Archived/ }).click();
  await expect(archived.getByText(renamed)).toBeVisible();

  // Restore it: it comes back in the list.
  await archived.getByRole('button', { name: new RegExp(`${renamed}.*archived`) }).click();
  await page.getByRole('form', { name: 'Change an account' }).getByRole('button', { name: 'Restore this account' }).click();
  await expect(page.getByRole('form', { name: 'Change an account' })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'Accounts' }).getByText(renamed)).toBeVisible({ timeout: 20_000 });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the Accounts screen and its form have no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await onAccounts(page);
    await addAccount(page, testName(`acct-axe-${scheme}`), { last4: '9001' });
    const tab = await new AxeBuilder({ page }).analyze();
    const foundTab = tab.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(foundTab, foundTab.join('\n')).toEqual([]);

    await page.getByRole('button', { name: '+ Add an account' }).click();
    await expect(page.getByRole('form', { name: 'Add an account' })).toBeVisible();
    const form = await new AxeBuilder({ page }).analyze();
    const foundForm = form.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(foundForm, foundForm.join('\n')).toEqual([]);
  });
}
