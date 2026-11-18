import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * A stated spend (docs/design/spending-capture.md section 11; SC-I14 to SC-I19; the StateSpend and MoneyMonthStated boards): a person's figure for a month that
 * has ended, on the card of Last month, for an owner or a partner.
 *
 * A month that was closed from balances earlier in the run shows the balances' figure and has no form, so the tests that need the form skip then, as the
 * close's do. The run's teardown resets the household, which clears what is stated here.
 */

test.use({ actionTimeout: 15_000 });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The month before this one, in India. */
function monthBefore(): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const index = Number(today.slice(0, 4)) * 12 + (Number(today.slice(5, 7)) - 1) - 1;
  return MONTHS[index % 12] as string;
}

async function onLastMonth(page: Page) {
  await page.goto('/#/money');
  const card = page.getByRole('region', { name: 'The month so far' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await page.getByRole('group', { name: 'Month' }).getByRole('button', { name: 'Last month' }).click();
  return page.getByRole('region', { name: monthBefore() });
}

/** Whether the month offers the form: it is read from the database, so it is waited for, and a month closed from balances never offers it. */
async function offered(card: Locator): Promise<boolean> {
  try {
    await expect(card.getByTestId('month-state-action')).toBeVisible({ timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

test('an ended month that is only itemised offers to state it, and says what the figure is for', async ({ page }) => {
  test.setTimeout(120_000);
  const card = await onLastMonth(page);
  await expect(card).toBeVisible();
  const action = card.getByTestId('month-state-action');
  test.skip(!(await offered(card)), 'the month was closed from balances earlier in this run');
  // The other project may have stated the month already in this run: the line is for a month that is only itemised.
  test.skip((await action.getByRole('button', { name: 'Change' }).count()) > 0, 'the month was stated earlier in this run');
  await expect(action).toContainText(`If you know what ${monthBefore()} cost, you can say it.`);
  await action.getByRole('button', { name: new RegExp(`^State ${monthBefore()}’s spend`) }).click();

  const form = page.getByRole('form', { name: `State ${monthBefore()}’s spend` });
  await expect(form).toBeVisible();
  await expect(form).toContainText('not what you put into investments, not loan EMIs, not moves between your own accounts');
  // Nothing is saved until the button, and a figure that is not an amount is said so beside the field.
  await form.getByLabel('Spent in total').fill('lots');
  await expect(form.getByText(/Type an amount more than/)).toBeVisible();
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByRole('button', { name: `Close State ${monthBefore()}’s spend` }).click();
  await expect(page.getByRole('form', { name: `State ${monthBefore()}’s spend` })).toHaveCount(0);
  await expect(card.getByTestId('month-stated-said')).toHaveCount(0);
});

test('stating a month shows it as stated, rough in saved, and with what is not yet itemised; changing it states it again', async ({ page }) => {
  test.setTimeout(180_000);
  const card = await onLastMonth(page);
  const action = card.getByTestId('month-state-action');
  test.skip(!(await offered(card)), 'the month was closed from balances earlier in this run');

  await action.getByRole('button', { name: new RegExp(`^(State ${monthBefore()}’s spend|Change)$`) }).click();
  const form = page.getByRole('form', { name: new RegExp(`^(State|Change) ${monthBefore()}’s spend$`) });
  await expect(form).toBeVisible();

  // A very large total, so it is above whatever was itemised: the rest is filled from it, and typing the rest fills the total.
  await form.getByLabel('Spent in total').fill('9,00,00,000');
  const rest = form.getByLabel('or just the rest');
  if ((await rest.count()) > 0) {
    await expect(rest).not.toHaveValue('');
    await expect(form.getByText(/itemised \+ .* more/)).toBeVisible();
  }
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('form', { name: /State|Change/ })).toHaveCount(0, { timeout: 20_000 });

  await expect(card.getByTestId('month-stated-said')).toContainText('spend stated');
  await expect(card.getByTestId('month-spent')).toContainText('9,00,00,000');
  await expect(card.getByText('stated', { exact: true })).toBeVisible();
  await expect(card.getByText('rough', { exact: true })).toBeVisible();
  // No split of saved is claimed for it: it is not from balances.
  await expect(card.locator('dl')).not.toContainText('from balances');

  // It is changed by stating again, and one figure is live for the month.
  await card.getByTestId('month-state-action').getByRole('button', { name: 'Change' }).click();
  const change = page.getByRole('form', { name: `Change ${monthBefore()}’s spend` });
  await expect(change.getByLabel('Spent in total')).toHaveValue('90000000');
  await change.getByLabel('Spent in total').fill('9,50,00,000');
  await change.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('form', { name: /Change/ })).toHaveCount(0, { timeout: 20_000 });
  await expect(card.getByTestId('month-spent')).toContainText('9,50,00,000');
  await expect(card.getByTestId('month-spent')).not.toContainText('9,00,00,000');
});

test('a total below what is itemised is not an error: both figures are shown and neither is changed', async ({ page }) => {
  test.setTimeout(180_000);
  const card = await onLastMonth(page);
  const action = card.getByTestId('month-state-action');
  test.skip(!(await offered(card)), 'the month was closed from balances earlier in this run');

  await action.getByRole('button', { name: new RegExp(`^(State ${monthBefore()}’s spend|Change)$`) }).click();
  const form = page.getByRole('form', { name: new RegExp(`^(State|Change) ${monthBefore()}’s spend$`) });
  test.skip((await form.getByLabel('or just the rest').count()) === 0, 'nothing is itemised in the month, so no total is below it');

  await form.getByLabel('Spent in total').fill('1');
  await expect(form.getByText('Nothing to add: this total is less than what is itemised.')).toBeVisible();
  await expect(form.getByText(/You have itemised more than this/)).toBeVisible();
  await expect(form.getByLabel('or just the rest')).toHaveValue('');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('form', { name: /State|Change/ })).toHaveCount(0, { timeout: 20_000 });
  await expect(card.getByTestId('month-stated-sentence')).toContainText('more than the');
  await expect(card.getByTestId('month-stated-sentence')).toContainText('Both are shown; neither is changed.');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the form and the card have no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    const card = await onLastMonth(page);
    test.skip(!(await offered(card)), 'the month was closed from balances earlier in this run');
    const found: string[] = [];
    const scan = async (where: string) => {
      const result = await new AxeBuilder({ page }).analyze();
      for (const v of result.violations) found.push(`${where} · ${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    };
    await scan('the card');
    await card.getByTestId('month-state-action').getByRole('button', { name: /^(State .* spend|Change)$/ }).click();
    const form = page.getByRole('form', { name: new RegExp(`^(State|Change) ${monthBefore()}’s spend$`) });
    await expect(form).toBeVisible();
    await form.getByLabel('Spent in total').fill('1');
    await scan('the form, a total below what is itemised');
    await form.getByLabel('Spent in total').fill('lots');
    await scan('the form, not an amount');
    expect(found, found.join('\n')).toEqual([]);
  });
}

test('months of cover counts a stated month as stated, under its figure', async ({ page }) => {
  test.setTimeout(180_000);
  const card = await onLastMonth(page);
  test.skip(!(await offered(card)), 'the month was closed from balances earlier in this run');
  const action = card.getByTestId('month-state-action');
  // The month is stated here if no earlier test has stated it.
  if ((await action.getByRole('button', { name: 'Change' }).count()) === 0) {
    await action.getByRole('button', { name: new RegExp(`^State ${monthBefore()}’s spend`) }).click();
    const form = page.getByRole('form', { name: `State ${monthBefore()}’s spend` });
    await form.getByLabel('Spent in total').fill('1,20,000');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByTestId('month-stated-said')).toBeVisible({ timeout: 20_000 });
  }

  await page.goto('/#/overview');
  const cover = page.getByTestId('months-of-cover');
  await expect(cover).toBeVisible({ timeout: 20_000 });
  const sources = cover.getByTestId('cover-sources');
  test.skip((await sources.count()) === 0, 'the demo household has too little history for a months-of-cover figure');
  await expect(sources).toContainText(/Of the \d+ months?: .*\d+ stated/);
  await expect(sources).toContainText('Itemised months read low, which makes the cover read high.');
});
