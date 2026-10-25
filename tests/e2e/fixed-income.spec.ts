import { test, expect, type Page } from '@playwright/test';
import { archiveByName, openFixedForm, openHolding, openList } from './holdings.ts';

/**
 * A deposit is entered as its terms and valued from them.
 *
 * `docs/blueprint.md`: "the app asks for the terms, not the current value. Maturity value
 * and accrued interest are computed, not typed." So this types a principal, a rate and
 * two dates, and checks the screen has worked out what the deposit paid.
 *
 * The dates are in the past on purpose, so the deposit has matured and its value is its
 * maturity value for ever: 1,00,000 at 7.5%, credited yearly for one year, is 1,07,500.
 * A deposit still running would give a different figure every day, and a test that
 * depended on the day it ran would be testing the clock.
 *
 * Since the Holdings redesign (docs/design/holdings.md) a deposit is a row in the list and its terms and
 * actions are on its own screen, so these add one through the list's Add, open it by name, and act there.
 * It writes to the demo household like the others, and archives what it made, since deleting is not a thing
 * this app does.
 */

const main = (page: Page) => page.locator('main');

test('a deposit is valued from its terms, and a matured one says so', async ({ page }) => {
  const name = `e2e-fd-${Date.now()}`;

  const form = await openFixedForm(page);
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Principal').fill('100000');
  await form.getByLabel('Rate %', { exact: true }).fill('7.5');
  await form.getByLabel('Starts').fill('2024-01-01');
  await form.getByLabel('Matures').fill('2025-01-01');
  await form.getByRole('button', { name: 'Add the deposit' }).click();

  // A deposit that has paid out is an ended holding: it is in the folded group, and opens like any other.
  await openHolding(page, name);
  await expect(main(page)).toContainText('Matured');
  // Principal 1,00,000 plus a year at 7.5%, which is what the bank pays.
  await expect(main(page)).toContainText('1,07,500');
  // Said to be worked out, not recorded: nothing here was typed as a value.
  await expect(page.getByText(/worked out from the terms/i).first()).toBeVisible();

  await archiveByName(page, name);
});

test('a bond is asked for a coupon and not for a compounding', async ({ page }) => {
  await openFixedForm(page);
  await page.getByRole('button', { name: 'Bond', exact: true }).click();

  // A bond pays coupons and does not compound, so the form offers the one and not the other.
  await expect(page.getByLabel('Coupon paid')).toBeVisible();
  await expect(page.getByLabel(/Compounds/)).toHaveCount(0);
});

test('a deposit held without terms is given them, not entered a second time', async ({ page }) => {
  const name = `e2e-held-${Date.now()}`;

  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();

  // The way deposits were entered before there were terms: a holding of kind deposit.
  const add = page.locator('form').filter({ hasText: 'Priced in' });
  await add.getByLabel('Name', { exact: true }).fill(name);
  await add.locator('select').nth(0).selectOption('deposit');
  await add.locator('select').nth(1).selectOption('INR');
  await add.locator('select').nth(2).selectOption('INR');
  await page.getByLabel(/Foreign asset for disclosure/).uncheck();
  await add.getByLabel('Quantity').fill('1');
  await add.getByRole('button', { name: 'Add', exact: true }).click();

  await openHolding(page, name);
  await expect(main(page)).toContainText('terms of this deposit are not recorded');
  await page.getByRole('button', { name: 'Give the terms' }).click();

  const terms = page.locator('form').filter({ hasText: `Terms for ${name}` });
  await terms.getByLabel('Principal').fill('50000');
  await terms.getByLabel('Rate %', { exact: true }).fill('7');
  await terms.getByLabel('Starts').fill('2024-01-01');
  await terms.getByLabel('Matures').fill('2025-01-01');
  await terms.getByRole('button', { name: 'Save the terms' }).click();

  // It is valued from them, as the same holding: it is no longer offered terms.
  await expect(main(page)).toContainText('Paid out');
  await expect(main(page)).toContainText('53,500');
  await expect(page.getByRole('button', { name: 'Give the terms' })).toHaveCount(0);

  await archiveByName(page, name);
});

test('the terms of a deposit can be corrected in place, and every figure follows', async ({ page }) => {
  const name = `e2e-edit-${Date.now()}`;

  const form = await openFixedForm(page);
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Principal').fill('100000');
  await form.getByLabel('Rate %', { exact: true }).fill('7.5');
  await form.getByLabel('Starts').fill('2024-01-01');
  await form.getByLabel('Matures').fill('2025-01-01');
  await form.getByRole('button', { name: 'Add the deposit' }).click();

  await openHolding(page, name);
  await expect(main(page)).toContainText('1,07,500');

  // The typo is in the principal: the deposit was 2,00,000.
  await page.getByRole('button', { name: `Correct the terms of ${name}` }).click();
  const edit = page.locator('form').filter({ hasText: `Correct the terms of ${name}` });
  await expect(edit.getByLabel('Principal')).toHaveValue('100000');
  await edit.getByLabel('Principal').fill('200000');
  await edit.getByRole('button', { name: 'Save the corrections' }).click();

  await expect(main(page)).toContainText('2,15,000');
  await expect(main(page)).not.toContainText('1,07,500');

  await archiveByName(page, name);
});

test('a deposit maturing within a month is called out, with the decision named', async ({ page }) => {
  const name = `e2e-soon-${Date.now()}`;
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const form = await openFixedForm(page);
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Principal').fill('100000');
  await form.getByLabel('Rate %', { exact: true }).fill('7');
  await form.getByLabel('Starts').fill(day(-300));
  await form.getByLabel('Matures').fill(day(10));
  await form.getByRole('button', { name: 'Add the deposit' }).click();

  await openHolding(page, name);
  await expect(main(page)).toContainText(/Matures in \d+ days/);
  await expect(main(page)).toContainText('Decide where the money goes');

  await archiveByName(page, name);
});

test('a cumulative bond pays everything at maturity, with no coupon along the way', async ({ page }) => {
  const name = `e2e-cumulative-${Date.now()}`;

  const form = await openFixedForm(page);
  await form.getByRole('button', { name: 'Bond', exact: true }).click();
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Face value').fill('100000');
  await form.getByLabel('Coupon %').fill('8');
  await form.getByLabel('Starts').fill('2024-01-01');
  await form.getByLabel('Matures').fill('2026-01-01');
  await form.getByRole('combobox', { name: 'Repay mode' }).selectOption('cumulative');
  await form.getByRole('button', { name: 'Add the bond' }).click();

  await openHolding(page, name);
  // 1,00,000 at 8% credited yearly for two years: 1,00,000 x 1.08 x 1.08.
  await expect(main(page)).toContainText('1,16,640');
  await expect(main(page)).toContainText('Interest earned');
  await expect(main(page)).toContainText('16,640');
  await expect(main(page)).toContainText('cumulative');
  await expect(main(page)).not.toContainText('Next coupon');

  await archiveByName(page, name);
});

test('a downgrade is logged, shown on the bond, and called out on the Overview', async ({ page }) => {
  const name = `e2e-rated-${Date.now()}`;

  const form = await openFixedForm(page);
  await form.getByRole('button', { name: 'Bond', exact: true }).click();
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Face value').fill('100000');
  await form.getByLabel('Coupon %').fill('10');
  await form.getByLabel('Starts').fill('2026-01-01');
  await form.getByLabel('Matures').fill('2030-01-01');
  await form.getByLabel('Rating').fill('CRISIL AA');
  await form.getByRole('button', { name: 'Add the bond' }).click();

  await openHolding(page, name);
  await expect(main(page)).toContainText('CRISIL AA');
  // The rating as first recorded is the first row of its log, and is not a downgrade.
  await expect(main(page)).not.toContainText('Downgraded');

  // The rating falls, and is corrected on the terms: the only way a row of the log is written.
  await page.getByRole('button', { name: `Correct the terms of ${name}` }).click();
  const edit = page.locator('form').filter({ hasText: `Correct the terms of ${name}` });
  await edit.getByLabel('Rating').fill('CRISIL A');
  await edit.getByRole('button', { name: 'Save the corrections' }).click();

  await expect(main(page)).toContainText('Downgraded from CRISIL AA to CRISIL A');
  await main(page).getByText(/Rating history/).click();
  await expect(main(page)).toContainText('downgrade');

  // A downgrade does not wait to be found on the Holdings screen.
  await page.goto('/#overview');
  await expect(page.getByText(/bonds? ha(s|ve) been downgraded recently/)).toBeVisible();

  await archiveByName(page, name);
  await page.goto('/#overview');
  await expect(page.getByText(/downgraded recently/)).toHaveCount(0);
});

/** The last day of last month, in IST: what the Close button on the Overview closes. */
function lastMonthEndIst(): string {
  const [year, month] = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    .split('-')
    .map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
}

test('closing the month writes a deposit its month-end reading from the terms', async ({ page }) => {
  const name = `e2e-close-${Date.now()}`;
  const monthEnd = lastMonthEndIst();
  const day = (offsetDays: number, from = monthEnd) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };
  const start = day(-100);
  const maturity = `${String(Number(start.slice(0, 4)) + 2)}${start.slice(4)}`;

  const form = await openFixedForm(page);
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Principal').fill('100000');
  await form.getByLabel('Rate %', { exact: true }).fill('7.5');
  await form.getByLabel('Starts').fill(start);
  await form.getByLabel('Matures').fill(maturity);
  // This is the path with no reading, which the close is for, so the offer to record one when it is added is declined.
  await form.getByLabel(/Record today.s value/).uncheck();
  await form.getByRole('button', { name: 'Add the deposit' }).click();

  // Nobody has recorded a reading: it is worked out on its own screen and nowhere else.
  await page.goto('/#overview');
  await page.getByRole('button', { name: /^Close / }).click();
  // 100 days of 7.5% on 1,00,000, which is 2,054.79: a year has not passed, so no credit yet.
  await expect(page.getByText(/Worked out \d+ deposits? (and bonds?|or bond)? ?from/)).toBeVisible();

  // It is a reading now, dated the month end and marked as reconstructed.
  await openHolding(page, name);
  // The value card is the latest reading, compact, with the exact figure behind it for anybody who wants the digits.
  await expect(page.getByTestId('detail-value')).toHaveAttribute('title', /1,02,054\.79/);

  await archiveByName(page, name);
});
