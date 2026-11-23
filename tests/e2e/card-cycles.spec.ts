import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { chooseHousehold, resetHousehold, testHouseholdName, testName } from './created.ts';

/**
 * A card that closes on its statement date (docs/design/card-cycles.md sections 8.1 to 8.3; CY-I3, CY-I11): the setting on the account form, the account's row, the close waiting for its
 * statement, and the month's footer saying so. The statement itself is a PDF the screen cannot be given here, so what a statement does is the unit tests'.
 *
 * It adds a card that would hold every later close open, so it leaves the household as it found it, as the loan payment spec does.
 */

test.use({ actionTimeout: 20_000 });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The month the close offers: the one before this, in India. */
function monthBefore(): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const index = Number(today.slice(0, 4)) * 12 + (Number(today.slice(5, 7)) - 1) - 1;
  return MONTHS[index % 12] as string;
}

async function onAccounts(page: Page) {
  await page.goto('/#/accounts');
  await expect(page.getByRole('button', { name: '+ Add an account' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
}

test('a card is set to close on its statement date, says so on its row, and the close waits for its statement', async ({ page }) => {
  test.setTimeout(300_000);
  const household = testHouseholdName();
  test.skip(household === null, 'a household the suite may reset is needed, since this leaves a card that holds the close open');
  const name = testName('cycle-card');

  try {
    await onAccounts(page);
    await page.getByRole('button', { name: '+ Add an account' }).click();
    const form = page.getByRole('form', { name: 'Add an account' });
    await expect(form).toBeVisible();

    // The choice is a card's: a savings account has none.
    await expect(form.getByText('When does this card’s bill close?')).toHaveCount(0);
    await form.getByLabel('Name').fill(name);
    await form.getByRole('button', { name: 'Card', exact: true }).click();
    await expect(form.getByText('When does this card’s bill close?')).toBeVisible();
    await expect(form.getByRole('button', { name: 'At month end' })).toHaveAttribute('aria-pressed', 'true');
    await form.getByLabel('Last four digits').fill('1188');
    await form.getByRole('button', { name: 'On its statement date' }).click();
    await expect(form.getByRole('button', { name: 'On its statement date' })).toHaveAttribute('aria-pressed', 'true');
    await form.getByRole('button', { name: 'Add account' }).click();
    await expect(form).toHaveCount(0, { timeout: 20_000 });

    // The account's row says its bill closes on its statement date.
    const row = page.getByRole('button', { name: new RegExp(`${name} ••1188`) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('bill closes on its statement date');

    // Changing it says what it does before it is saved.
    await row.click();
    const change = page.getByRole('form', { name: 'Change an account' });
    await expect(change).toBeVisible();
    await expect(change.getByTestId('account-cycle-change')).toHaveCount(0);
    await change.getByRole('button', { name: 'At month end' }).click();
    await expect(change.getByTestId('account-cycle-change')).toContainText('Every month will be worked out again');
    await change.getByRole('button', { name: 'On its statement date' }).click();
    await expect(change.getByTestId('account-cycle-change')).toHaveCount(0);
    await change.getByRole('button', { name: 'Close Change an account' }).click();

    // The month waits for the statement dated in it, and the footer says so.
    await page.goto('/#/money');
    await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`${monthBefore()} is waiting for 1 card statement`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`${name} ••1188, dated in ${monthBefore()}`)).toBeVisible();

    // An owner may close the month without the card, so the footer offers Close beside Import a statement.
    await expect(page.getByRole('button', { name: 'Import a statement' })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`^Close ${monthBefore()}$`) }).click();
    const close = page.getByRole('form', { name: `Close ${monthBefore()}` });
    await expect(close).toBeVisible();
    await expect(close.getByTestId('close-card-cycle')).toContainText(`Waiting for its statement dated in ${monthBefore()}`);
    await expect(close.getByTestId('close-card-cycle')).toContainText('Import it from Money → Import a statement.');
    await expect(close.getByRole('region', { name: new RegExp(name) }).getByLabel(/^Closing balance/)).toHaveCount(0);
    await expect(close.getByTestId('close-cycle-explained')).toContainText(`Each card on its statement date uses the cycle that ended in ${monthBefore()}`);
    await expect(close.getByTestId('close-cycle-explained')).toContainText('1 waiting for a statement');

    const found = (await new AxeBuilder({ page }).analyze()).violations.map((violation) => `${violation.id}: ${String(violation.nodes.length)}`);
    expect(found, found.join('\n')).toEqual([]);

    // At 200% text nothing in the row leaves the card.
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const box = await close.getByTestId('close-card-cycle').boundingBox();
    const view = page.viewportSize();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((view?.width ?? 0) + 1);
  } finally {
    if (household !== null) {
      await chooseHousehold(page, household);
      await resetHousehold(page);
    }
  }
});

/** The month the close offers, as `YYYY-MM`. */
function monthBeforeKey(): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const index = Number(today.slice(0, 4)) * 12 + (Number(today.slice(5, 7)) - 1) - 1;
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}`;
}

test('an owner closes the month without a waiting card and undoes it, or types the amount due, and the month closes', async ({ page }) => {
  test.setTimeout(300_000);
  const household = testHouseholdName();
  test.skip(household === null, 'a household the suite may reset is needed, since this leaves a card that holds the close open');
  const name = testName('close-without-card');
  const word = monthBefore();

  try {
    await onAccounts(page);
    await page.getByRole('button', { name: '+ Add an account' }).click();
    const add = page.getByRole('form', { name: 'Add an account' });
    await add.getByLabel('Name').fill(name);
    await add.getByRole('button', { name: 'Card', exact: true }).click();
    await add.getByLabel('Last four digits').fill('2244');
    await add.getByRole('button', { name: 'On its statement date' }).click();
    await add.getByRole('button', { name: 'Add account' }).click();
    await expect(add).toHaveCount(0, { timeout: 20_000 });

    // The month is waiting for the statement, and an owner may close it without the card.
    await page.goto('/#/money');
    await expect(page.getByText(`${word} is waiting for 1 card statement`)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: new RegExp(`^Close ${word}$`) }).click();
    const close = page.getByRole('form', { name: `Close ${word}` });
    await expect(close).toBeVisible();
    const row = close.getByRole('region', { name: new RegExp(name) });
    await expect(row.getByTestId('close-card-cycle')).toContainText('Waiting for its statement');

    // It asks once, and says what it does.
    await row.getByRole('button', { name: new RegExp(`^Close without ${name}`) }).click();
    await expect(row.getByTestId('close-without-confirm')).toContainText('will be left out until its statement is imported');
    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(row.getByTestId('close-without-confirm')).toHaveCount(0);
    await row.getByRole('button', { name: new RegExp(`^Close without ${name}`) }).click();
    await row.getByRole('button', { name: 'Close without it' }).click();
    await expect(row.getByTestId('close-card-cycle')).toContainText('Not in this close: its statement is not imported. Payments to it this month count as spent instead.', { timeout: 20_000 });

    // An owner may undo it, and the card is waiting again.
    await row.getByRole('button', { name: new RegExp(`^Undo: close ${word}`) }).click();
    await expect(row.getByTestId('close-card-cycle')).toContainText('Waiting for its statement', { timeout: 20_000 });

    // Closed without the card, the month closes; Last month says so, and an owner may still put the card back.
    await row.getByRole('button', { name: new RegExp(`^Close without ${name}`) }).click();
    await row.getByRole('button', { name: 'Close without it' }).click();
    await expect(row.getByTestId('close-card-cycle')).toContainText('Not in this close', { timeout: 20_000 });
    await close.getByRole('button', { name: `Close ${word}`, exact: true }).click();
    await expect(page.getByText(new RegExp(`^${word} closed`))).toBeVisible({ timeout: 30_000 });
    await page.getByRole('region', { name: 'The month so far' }).getByRole('button', { name: 'Last month' }).click();
    const last = page.getByRole('region', { name: word });
    await expect(last.getByTestId('month-card-cycles')).toContainText('not in this close');
    await last.getByRole('button', { name: new RegExp(`^Undo: close ${word}`) }).click();
    await expect(page.getByText(`${word} is waiting for 1 card statement`)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: new RegExp(`^Close ${word}$`) }).click();

    // Or type the amount due, with the statement's date, which must fall in the month.
    await row.getByRole('button', { name: 'Type the amount due instead' }).click();
    await row.getByLabel('Amount due').fill('28640');
    await row.getByLabel('Statement date').fill(`${monthBeforeKey()}-17`);
    await expect(row.getByTestId('close-card-cycle')).toContainText('First cycle left out', { timeout: 20_000 });
    // A day in the same month a year earlier: outside the month, whichever month it is.
    await row.getByLabel('Statement date').fill(`${String(Number(monthBeforeKey().slice(0, 4)) - 1)}-${monthBeforeKey().slice(5)}-02`);
    await expect(row.getByText(`The statement date must fall in ${word}.`)).toBeVisible();
    await row.getByLabel('Statement date').fill(`${monthBeforeKey()}-17`);

    // Closing saves the typed due, and the month is closed.
    await close.getByRole('button', { name: `Close ${word}`, exact: true }).click();
    await expect(page.getByText(new RegExp(`^${word} closed`))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`${word} is waiting for 1 card statement`)).toHaveCount(0);
  } finally {
    if (household !== null) {
      await chooseHousehold(page, household);
      await resetHousehold(page);
    }
  }
});

test('cancelling the close writes no choice to close without a card, and the month still waits', async ({ page }) => {
  test.setTimeout(300_000);
  const household = testHouseholdName();
  test.skip(household === null, 'a household the suite may reset is needed, since this leaves a card that holds the close open');
  const name = testName('cancel-card');
  const word = monthBefore();
  // Every write to the choices table, so that cancelling can be shown to have made none.
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('close_without_card')) writes.push(`${request.method()} ${request.url()}`);
  });

  try {
    await onAccounts(page);
    await page.getByRole('button', { name: '+ Add an account' }).click();
    const add = page.getByRole('form', { name: 'Add an account' });
    await add.getByLabel('Name').fill(name);
    await add.getByRole('button', { name: 'Card', exact: true }).click();
    await add.getByLabel('Last four digits').fill('3366');
    await add.getByRole('button', { name: 'On its statement date' }).click();
    await add.getByRole('button', { name: 'Add account' }).click();
    await expect(add).toHaveCount(0, { timeout: 20_000 });

    await page.goto('/#/money');
    await expect(page.getByText(`${word} is waiting for 1 card statement`)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: new RegExp(`^Close ${word}$`) }).click();
    const close = page.getByRole('form', { name: `Close ${word}` });
    const row = close.getByRole('region', { name: new RegExp(name) });
    await row.getByRole('button', { name: new RegExp(`^Close without ${name}`) }).click();
    await expect(row.getByTestId('close-without-confirm')).toContainText('cancelling the close saves nothing');
    await row.getByRole('button', { name: 'Close without it' }).click();
    await expect(row.getByTestId('close-card-cycle')).toContainText('Not in this close');

    // Cancelling the close writes nothing, and the month is still waiting.
    await close.getByRole('button', { name: `Close Close ${word}` }).click();
    await expect(close).toHaveCount(0);
    expect(writes, 'cancelling the close must not write a choice').toEqual([]);
    await expect(page.getByText(`${word} is waiting for 1 card statement`)).toBeVisible();
    await page.reload();
    await expect(page.getByText(`${word} is waiting for 1 card statement`)).toBeVisible({ timeout: 20_000 });

    // Closing saves it: only then is there a write, and the month is closed.
    await page.getByRole('button', { name: new RegExp(`^Close ${word}$`) }).click();
    await row.getByRole('button', { name: new RegExp(`^Close without ${name}`) }).click();
    await row.getByRole('button', { name: 'Close without it' }).click();
    await close.getByRole('button', { name: `Close ${word}`, exact: true }).click();
    await expect(page.getByText(new RegExp(`^${word} closed`))).toBeVisible({ timeout: 30_000 });
    expect(writes.length).toBeGreaterThan(0);
  } finally {
    if (household !== null) {
      await chooseHousehold(page, household);
      await resetHousehold(page);
    }
  }
});
