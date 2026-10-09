import { test, expect } from '@playwright/test';

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
 * It writes to the demo household like the others, and archives what it made, since
 * deleting is not a thing this app does.
 */

test('a deposit is valued from its terms, and a matured one says so', async ({ page }) => {
  const name = `e2e-fd-${Date.now()}`;

  await page.goto('/#holdings');
  await page.getByRole('button', { name: 'Add a deposit or bond' }).click();

  const form = page.locator('form').filter({ hasText: 'Fixed deposit' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Principal').fill('100000');
  await form.getByLabel('Rate %', { exact: true }).fill('7.5');
  await form.getByLabel('Starts').fill('2024-01-01');
  await form.getByLabel('Matures').fill('2025-01-01');
  await form.getByRole('button', { name: 'Add the deposit' }).click();

  const entry = page.getByRole('listitem').filter({ hasText: name });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('Matured');
  // Principal 1,00,000 plus a year at 7.5%, which is what the bank pays.
  await expect(entry).toContainText('1,07,500');
  // Said to be worked out, not recorded: nothing here was typed as a value.
  await expect(page.getByText(/worked out from the terms/i).first()).toBeVisible();

  // Tidy up. The holding is archived, which takes it off every screen.
  const holding = page
    .locator('section', { hasText: name })
    .filter({ has: page.getByRole('button', { name: 'Archive this holding' }) })
    .last();
  await holding.getByRole('button', { name: 'Archive this holding' }).click();
  await holding.getByRole('button', { name: 'Yes, archive it' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
});

test('a bond is asked for a coupon and not for a compounding', async ({ page }) => {
  await page.goto('/#holdings');
  await page.getByRole('button', { name: 'Add a deposit or bond' }).click();
  await page.getByRole('button', { name: 'Bond', exact: true }).click();

  // A bond pays coupons and does not compound, so the form offers the one and not the other.
  await expect(page.getByLabel('Coupon paid')).toBeVisible();
  await expect(page.getByLabel(/Compounds/)).toHaveCount(0);
});

test('a deposit held without terms is given them, not entered a second time', async ({ page }) => {
  const name = `e2e-held-${Date.now()}`;

  await page.goto('/#holdings');
  await page.getByRole('button', { name: 'Add a holding' }).click();

  // The way deposits were entered before there were terms: a holding of kind deposit.
  const add = page.locator('form').filter({ hasText: 'Priced in' });
  await add.getByLabel('Name', { exact: true }).fill(name);
  await add.locator('select').nth(0).selectOption('deposit');
  await add.locator('select').nth(1).selectOption('INR');
  await add.locator('select').nth(2).selectOption('INR');
  await page.getByLabel(/Foreign asset for disclosure/).uncheck();
  await add.getByLabel('Quantity').fill('1');
  await add.getByRole('button', { name: 'Add', exact: true }).click();

  const without = page.getByRole('listitem').filter({ hasText: name }).filter({ hasText: 'Give its terms' });
  await expect(without).toBeVisible();
  await without.getByRole('button', { name: 'Give its terms' }).click();

  const terms = page.locator('form').filter({ hasText: `Terms for ${name}` });
  await terms.getByLabel('Principal').fill('50000');
  await terms.getByLabel('Rate %', { exact: true }).fill('7');
  await terms.getByLabel('Starts').fill('2024-01-01');
  await terms.getByLabel('Matures').fill('2025-01-01');
  await terms.getByRole('button', { name: 'Save the terms' }).click();

  // It is valued from them, as the same holding: it is no longer offered terms.
  const entry = page.getByRole('listitem').filter({ hasText: name }).filter({ hasText: 'Paid out' });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('53,500');
  await expect(without).toHaveCount(0);

  const holding = page
    .locator('section', { hasText: name })
    .filter({ has: page.getByRole('button', { name: 'Archive this holding' }) })
    .last();
  await holding.getByRole('button', { name: 'Archive this holding' }).click();
  await holding.getByRole('button', { name: 'Yes, archive it' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
});

test('the terms of a deposit can be corrected in place, and every figure follows', async ({ page }) => {
  const name = `e2e-edit-${Date.now()}`;

  await page.goto('/#holdings');
  await page.getByRole('button', { name: 'Add a deposit or bond' }).click();
  const form = page.locator('form').filter({ hasText: 'Fixed deposit' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Principal').fill('100000');
  await form.getByLabel('Rate %', { exact: true }).fill('7.5');
  await form.getByLabel('Starts').fill('2024-01-01');
  await form.getByLabel('Matures').fill('2025-01-01');
  await form.getByRole('button', { name: 'Add the deposit' }).click();

  const entry = page.getByRole('listitem').filter({ hasText: name });
  await expect(entry).toContainText('1,07,500');

  // The typo is in the principal: the deposit was 2,00,000.
  await entry.getByRole('button', { name: `Correct the terms of ${name}` }).click();
  const edit = page.locator('form').filter({ hasText: `Correct the terms of ${name}` });
  await expect(edit.getByLabel('Principal')).toHaveValue('100000');
  await edit.getByLabel('Principal').fill('200000');
  await edit.getByRole('button', { name: 'Save the corrections' }).click();

  await expect(entry).toContainText('2,15,000');
  await expect(entry).not.toContainText('1,07,500');

  const holding = page
    .locator('section', { hasText: name })
    .filter({ has: page.getByRole('button', { name: 'Archive this holding' }) })
    .last();
  await holding.getByRole('button', { name: 'Archive this holding' }).click();
  await holding.getByRole('button', { name: 'Yes, archive it' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
});

test('a deposit maturing within a month is called out, with the decision named', async ({ page }) => {
  const name = `e2e-soon-${Date.now()}`;
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  await page.goto('/#holdings');
  await page.getByRole('button', { name: 'Add a deposit or bond' }).click();
  const form = page.locator('form').filter({ hasText: 'Fixed deposit' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Principal').fill('100000');
  await form.getByLabel('Rate %', { exact: true }).fill('7');
  await form.getByLabel('Starts').fill(day(-300));
  await form.getByLabel('Matures').fill(day(10));
  await form.getByRole('button', { name: 'Add the deposit' }).click();

  const entry = page.getByRole('listitem').filter({ hasText: name });
  await expect(entry).toContainText(/Matures in \d+ days/);
  await expect(entry).toContainText('Decide where the money goes');

  const holding = page
    .locator('section', { hasText: name })
    .filter({ has: page.getByRole('button', { name: 'Archive this holding' }) })
    .last();
  await holding.getByRole('button', { name: 'Archive this holding' }).click();
  await holding.getByRole('button', { name: 'Yes, archive it' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
});

async function archive(page: import('@playwright/test').Page, name: string) {
  await page.goto('/#holdings');
  const holding = page
    .locator('section', { hasText: name })
    .filter({ has: page.getByRole('button', { name: 'Archive this holding' }) })
    .last();
  await holding.getByRole('button', { name: 'Archive this holding' }).click();
  await holding.getByRole('button', { name: 'Yes, archive it' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
}

test('a cumulative bond pays everything at maturity, with no coupon along the way', async ({ page }) => {
  const name = `e2e-cumulative-${Date.now()}`;

  await page.goto('/#holdings');
  await page.getByRole('button', { name: 'Add a deposit or bond' }).click();
  const form = page.locator('form').filter({ hasText: 'Fixed deposit' });
  await form.getByRole('button', { name: 'Bond', exact: true }).click();
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Face value').fill('100000');
  await form.getByLabel('Coupon %').fill('8');
  await form.getByLabel('Starts').fill('2024-01-01');
  await form.getByLabel('Matures').fill('2026-01-01');
  await form.getByRole('combobox', { name: 'Repay mode' }).selectOption('cumulative');
  await form.getByRole('button', { name: 'Add the bond' }).click();

  const entry = page.getByRole('listitem').filter({ hasText: name });
  // 1,00,000 at 8% credited yearly for two years: 1,00,000 x 1.08 x 1.08.
  await expect(entry).toContainText('1,16,640');
  await expect(entry).toContainText('Interest earned');
  await expect(entry).toContainText('16,640');
  await expect(entry).toContainText('cumulative');
  await expect(entry).not.toContainText('Next coupon');

  await archive(page, name);
});

test('a downgrade is logged, shown on the bond, and called out on the Overview', async ({ page }) => {
  const name = `e2e-rated-${Date.now()}`;

  await page.goto('/#holdings');
  await page.getByRole('button', { name: 'Add a deposit or bond' }).click();
  const form = page.locator('form').filter({ hasText: 'Fixed deposit' });
  await form.getByRole('button', { name: 'Bond', exact: true }).click();
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Face value').fill('100000');
  await form.getByLabel('Coupon %').fill('10');
  await form.getByLabel('Starts').fill('2026-01-01');
  await form.getByLabel('Matures').fill('2030-01-01');
  await form.getByLabel('Rating').fill('CRISIL AA');
  await form.getByRole('button', { name: 'Add the bond' }).click();

  const entry = page.getByRole('listitem').filter({ hasText: name });
  await expect(entry).toContainText('CRISIL AA');
  // The rating as first recorded is the first row of its log, and is not a downgrade.
  await expect(entry).not.toContainText('Downgraded');

  // The rating falls, and is corrected on the terms: the only way a row of the log is written.
  await entry.getByRole('button', { name: `Correct the terms of ${name}` }).click();
  const edit = page.locator('form').filter({ hasText: `Correct the terms of ${name}` });
  await edit.getByLabel('Rating').fill('CRISIL A');
  await edit.getByRole('button', { name: 'Save the corrections' }).click();

  await expect(entry).toContainText('Downgraded from CRISIL AA to CRISIL A');
  await entry.getByText(/Rating history/).click();
  await expect(entry).toContainText('downgrade');

  // A downgrade does not wait to be found on the Holdings screen.
  await page.goto('/#overview');
  await expect(page.getByText(/bonds? ha(s|ve) been downgraded recently/)).toBeVisible();

  await archive(page, name);
  await page.goto('/#overview');
  await expect(page.getByText(/downgraded recently/)).toHaveCount(0);
});
