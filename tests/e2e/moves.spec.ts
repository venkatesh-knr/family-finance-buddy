import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { testName } from './created.ts';
import { choiceField, choose, next } from './fields.ts';

/**
 * A move between the household's own accounts (docs/design/ledger-income.md sections 1 and 12; LI-I2): the eighth chip on Add money in, a
 * line of the ledger with no sign that says *moved · not spent*, and a move that is voided and not edited.
 *
 * A move needs two accounts in one currency, so each test makes its own two. The suite's household is reset after every run.
 */

test.use({ actionTimeout: 15_000 });

async function addAccount(page: Page, name: string, type?: 'Card') {
  await page.goto('/#/money?tab=accounts');
  await expect(page.getByRole('navigation', { name: 'Money' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '+ Add an account' }).click();
  const form = page.getByRole('form', { name: 'Add an account' });
  await form.getByLabel('Name').fill(name);
  if (type !== undefined) await form.getByRole('button', { name: type, exact: true }).click();
  await form.getByLabel('Last four digits').fill('4455');
  await form.getByRole('button', { name: 'Add account' }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });
}

async function onLedger(page: Page) {
  await page.goto('/#/money');
  await expect(page.getByRole('navigation', { name: 'Money' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
}

const form = (page: Page) => page.getByRole('form', { name: 'Add money in' });

async function showAll(page: Page) {
  const seeAll = page.getByRole('button', { name: 'See all' });
  await expect(page.getByRole('region', { name: 'Recent expenses' })).toBeVisible({ timeout: 20_000 });
  if (await seeAll.isVisible()) await seeAll.click();
}

/** The rupees in the first figure of a cell: "₹1,42,000" is 142000. */
function rupees(text: string): number {
  const first = /₹\s*([\d,]+(?:\.\d+)?)/.exec(text);
  return first === null ? Number.NaN : Number((first[1] as string).replace(/,/g, ''));
}

/** Make a move of `amount` from `from` into `into`, and wait for the form to close. */
async function makeMove(page: Page, into: string, from: string, amount: string, note: string) {
  await page.getByRole('button', { name: '+ Money in' }).click();
  await expect(form(page)).toBeVisible();
  await form(page).getByLabel(/^Amount/).fill(amount);
  await form(page).getByRole('button', { name: 'From my own account', exact: true }).click();
  await choose(page, 'Into which account', new RegExp(`^${into}`));
  await next(page);
  await choose(page, 'From which account', new RegExp(`^${from}`));
  await form(page).getByLabel('Note').fill(note);
  await form(page).getByRole('button', { name: 'Add move' }).click();
  await expect(form(page)).toHaveCount(0, { timeout: 20_000 });
}

test('LI-I2 — a move is one line with no sign, moved · not spent, and it is in neither came in nor spent', async ({ page }) => {
  test.setTimeout(150_000);
  const savings = testName('move-savings');
  const card = testName('move-card');
  await addAccount(page, savings);
  await addAccount(page, card, 'Card');
  await onLedger(page);

  const surface = page.getByRole('region', { name: 'The month so far' });
  await expect(surface.getByTestId('month-came-in')).not.toContainText('Reading…', { timeout: 20_000 });
  const cameInBefore = rupees(await surface.getByTestId('month-came-in').innerText());
  const spentBefore = rupees(await surface.getByTestId('month-spent').innerText());

  const note = testName('move-note');
  await makeMove(page, card, savings, '18,240', note);
  await expect(page.getByRole('status').filter({ hasText: 'Moved ₹18,240' })).toContainText('neither came in nor spent');

  await showAll(page);
  const list = page.getByRole('region', { name: 'Recent expenses' });
  const row = list.locator('.recent-row').filter({ hasText: `${card} payment` });
  await expect(row).toBeVisible({ timeout: 20_000 });
  // A card payment: named for the card, from one account to the other, with no sign, and the word that says what it does to the month.
  await expect(row).toContainText(`${savings} ••4455 → ${card} ••4455`);
  // The note it was given is read back on the line.
  await expect(row).toContainText(note);
  await expect(row).toContainText('₹18,240');
  await expect(row).toContainText('moved · not spent');
  await expect(row).not.toContainText('+₹18,240');
  await expect(row).not.toContainText('−₹18,240');

  // The filters: a move is under Moved, and under neither In nor Out.
  const filters = list.getByRole('group', { name: 'Show' });
  await filters.getByRole('button', { name: 'Moved', exact: true }).click();
  await expect(row).toBeVisible();
  await filters.getByRole('button', { name: 'In', exact: true }).click();
  await expect(row).toHaveCount(0);
  await filters.getByRole('button', { name: 'Out', exact: true }).click();
  await expect(row).toHaveCount(0);
  await filters.getByRole('button', { name: 'All', exact: true }).click();

  // In neither came in nor spent.
  await expect.poll(async () => rupees(await surface.getByTestId('month-came-in').innerText()), { timeout: 20_000 }).toBe(cameInBefore);
  expect(rupees(await surface.getByTestId('month-spent').innerText())).toBe(spentBefore);
});

test('a move is voided after the form says which it is: it stays in the list, marked, and is not opened again', async ({ page }) => {
  test.setTimeout(150_000);
  const savings = testName('void-savings');
  const other = testName('void-other');
  await addAccount(page, savings);
  await addAccount(page, other);
  await onLedger(page);
  await makeMove(page, other, savings, '7,000', testName('void-note'));
  await showAll(page);

  const row = page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row').filter({ hasText: 'Moved between accounts' }).filter({ hasText: other });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  const voiding = page.getByRole('form', { name: 'A move between accounts' });
  await expect(voiding).toBeVisible();
  await expect(voiding).toContainText(`${savings} ••4455 → ${other} ••4455`);
  await expect(voiding).toContainText('₹7,000');

  // Leaving it writes nothing.
  await voiding.getByRole('button', { name: 'Close A move between accounts' }).click();
  await expect(voiding).toHaveCount(0);
  await expect(row).not.toContainText('Voided');

  await row.click();
  await voiding.getByRole('button', { name: 'Void this move' }).click();
  await expect(voiding).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Move voided.' })).toBeVisible();
  await showAll(page);
  await expect(row).toContainText('Voided');
  await expect(row).toContainText('voided · not counted');
  // The end of a row's life: it is not a button any more.
  await expect(page.getByRole('button', { name: /^Open Moved between accounts.*\bvoided/ })).toHaveCount(0);
});

test('From which account offers the others in the same currency, and not the one it goes into', async ({ page }) => {
  test.setTimeout(150_000);
  const a = testName('from-a');
  const b = testName('from-b');
  await addAccount(page, a);
  await addAccount(page, b);
  await onLedger(page);
  await page.getByRole('button', { name: '+ Money in' }).click();
  await form(page).getByLabel(/^Amount/).fill('100');
  await form(page).getByRole('button', { name: 'From my own account', exact: true }).click();
  await choose(page, 'Into which account', new RegExp(`^${a}`));
  await next(page);
  await choiceField(page, 'From which account').click();
  const names = (await page.getByRole('listbox').getByRole('option').allInnerTexts()).map((text) => text.replace(/\s*✓$/, '').trim());
  await page.keyboard.press('Escape');
  expect(names.some((label) => label.startsWith(b))).toBe(true);
  expect(names.some((label) => label.startsWith(a))).toBe(false);
  // Nothing is written until the last button: the form can be left.
  await form(page).getByRole('button', { name: 'Back' }).click();
  await form(page).getByRole('button', { name: 'Close Add money in' }).click();
  await expect(form(page)).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the move form has no accessibility violations on either step in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ colorScheme: scheme });
    const a = testName(`axe-a-${scheme}`);
    const b = testName(`axe-b-${scheme}`);
    await addAccount(page, a);
    await addAccount(page, b);
    await onLedger(page);
    await page.getByRole('button', { name: '+ Money in' }).click();
    await form(page).getByLabel(/^Amount/).fill('500');
    await form(page).getByRole('button', { name: 'From my own account', exact: true }).click();
    await choose(page, 'Into which account', new RegExp(`^${a}`));
    const one = await new AxeBuilder({ page }).analyze();
    const foundOne = one.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(foundOne, foundOne.join('\n')).toEqual([]);
    await next(page);
    const two = await new AxeBuilder({ page }).analyze();
    const foundTwo = two.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(foundTwo, foundTwo.join('\n')).toEqual([]);
  });
}
