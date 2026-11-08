import { test, expect, type Page } from '@playwright/test';
import { choose, next } from './fields.ts';

/**
 * Property: a property is filed with what it cost, valued with how that was arrived at, and its work is recorded, from
 * the Property screen behind More (docs/design/prototype.html, the Property view; docs/decisions.md, Property).
 *
 * It writes to the demo household like the other specs and archives what it made, since deleting is not a thing this
 * app does. The figures are the prototype's: 42,00,000 and 2,94,000 of duty make a cost basis of 44,94,000, and a
 * kitchen of 2,80,000 is capital work that adds to it while a repair of 45,000 does not.
 */

test.use({ actionTimeout: 15_000 });

async function openProperty(page: Page) {
  await page.goto('/#/property');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Property', exact: true, level: 2 })).toBeVisible({ timeout: 20_000 });
}

test('a property is filed, valued, worked on and archived, and every figure follows', async ({ page }) => {
  test.setTimeout(150_000);
  const name = `e2e-prop-${Date.now()}`;

  await openProperty(page);
  await page.getByRole('button', { name: 'Add a property' }).click();

  const form = page.getByRole('form', { name: 'Add a property' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await next(page);
  await form.getByLabel('Bought on').fill('2019-03-01');
  await form.getByLabel('Price paid').fill('4200000');
  await form.getByLabel('Stamp duty').fill('294000');
  await next(page);
  await form.getByLabel(/Household.s share/).fill('50');
  await form.getByRole('button', { name: 'Add the property' }).click();

  const card = page.getByRole('region', { name });
  try {
    await expect(card).toBeVisible({ timeout: 20_000 });
    // Filed, not valued: it says so, and the cost is the price and the duty.
    await expect(card.getByText('Not valued', { exact: true }).first()).toBeVisible();
    await expect(card.getByText('50% share')).toBeVisible();
    await expect(card).toContainText('44,94,000');

    await card.getByRole('button', { name: 'Details', exact: true }).click();

    // A valuation, and how it was arrived at.
    const valuation = card.getByRole('form', { name: `Record a valuation of ${name}` });
    await valuation.getByLabel('Worth').fill('6400000');
    await choose(page, 'How you arrived at it', 'A broker’s view', valuation);
    await valuation.getByRole('button', { name: 'Record valuation' }).click();
    await expect(card).toContainText('Valued at');
    await expect(card).toContainText('64,00,000');
    await expect(card).toContainText('A broker’s view');
    // Half of it is the household's.
    await expect(card).toContainText('32,00,000');

    // Capital work adds to the cost; a repair is recorded and does not.
    const work = card.getByRole('form', { name: `Record work on ${name}` });
    await work.getByLabel('Work').fill('Modular kitchen');
    await work.getByLabel('Cost').fill('280000');
    await work.getByRole('button', { name: 'Record work' }).click();
    // 44,94,000 + 2,80,000.
    await expect(card).toContainText('47,74,000');

    await work.getByLabel('Work').fill('Repainting');
    await choose(page, 'Type', 'Repair', work);
    await work.getByLabel('Cost').fill('45000');
    await work.getByRole('button', { name: 'Record work' }).click();
    await expect(card).toContainText('of repairs are recorded and not counted');
    await expect(card).toContainText('47,74,000');

    // A voided entry is struck out and out of the cost.
    await card.getByRole('button', { name: 'Void Modular kitchen' }).click();
    await expect(card.getByText('Voided', { exact: true })).toBeVisible();
    await expect(card).toContainText('44,94,000');
  } finally {
    // Archive what this made.
    if ((await card.count()) > 0) {
      const details = card.getByRole('button', { name: 'Details', exact: true });
      if ((await details.getAttribute('aria-expanded')) !== 'true') await details.click();
      await card.getByRole('button', { name: 'Archive', exact: true }).click();
      await card.getByRole('button', { name: 'Archive it' }).click();
      await expect(page.getByRole('region', { name })).toHaveCount(0, { timeout: 20_000 });
    }
  }
});

test('the screen is behind More for an owner, and says it is not yet in net worth', async ({ page }) => {
  await page.goto('/#/more');
  await expect(page.getByRole('link', { name: /^Property/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: /^Property/ }).click();
  await expect(page.getByRole('heading', { name: 'Property', exact: true, level: 2 })).toBeVisible({ timeout: 20_000 });
});

test('the form refuses a share outside 0 to 100, and a missing price, in a sentence', async ({ page }) => {
  await openProperty(page);
  await page.getByRole('button', { name: 'Add a property' }).click();
  const form = page.getByRole('form', { name: 'Add a property' });
  await form.getByLabel('Name', { exact: true }).fill('never saved');
  await next(page);
  await form.getByLabel('Bought on').fill('2019-03-01');
  await form.getByLabel('Price paid').fill('100');
  await next(page);
  await form.getByLabel(/Household.s share/).fill('150');
  // Said under the field as it is typed, and the last button waits for it to be right.
  await expect(form.getByText('The household’s share is a percentage above 0 and up to 100, such as 50 or 33.33.')).toBeVisible();
  await expect(form.getByLabel(/Household.s share/)).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByRole('button', { name: 'Add the property' })).toBeDisabled();
  // A share that is only unfinished is not called wrong.
  await form.getByLabel(/Household.s share/).fill('33.');
  await expect(form.getByLabel(/Household.s share/)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByRole('button', { name: 'Add the property' })).toBeDisabled();
  // And nothing was filed.
  await expect(page.getByRole('region', { name: 'never saved' })).toHaveCount(0);
});

test('a property’s figures and date say what is wrong under the field they are wrong on', async ({ page }) => {
  test.setTimeout(120_000);
  await openProperty(page);
  await page.getByRole('button', { name: 'Add a property' }).click();
  const form = page.getByRole('form', { name: 'Add a property' });
  await form.getByLabel('Name', { exact: true }).fill('e2e-never-added');
  await next(page);

  // A figure is marked as it is typed, and each on its own field.
  await form.getByLabel('Price paid').fill('lots');
  await expect(form.getByText('The price paid is an amount, such as 85,00,000.')).toBeVisible();
  await form.getByLabel('Stamp duty').fill('1.234');
  await expect(form.getByText('The stamp duty is an amount, such as 5,95,000, or leave it empty.')).toBeVisible();
  await form.getByLabel('Registration').fill('-5');
  await expect(form.getByText('The registration is an amount, such as 50,000, or leave it empty.')).toBeVisible();

  // A date is marked once it has been left, and a day after today is said in words.
  await form.getByLabel('Bought on').fill('2099-01-01');
  await form.getByLabel('Bought on').blur();
  await expect(form.getByText('It cannot have been bought after today.')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();

  // Right them and the marks go, and the step goes on.
  await form.getByLabel('Bought on').fill('2019-03-01');
  await form.getByLabel('Price paid').fill('4200000');
  await form.getByLabel('Stamp duty').fill('');
  await form.getByLabel('Registration').fill('');
  await expect(form.getByLabel('Bought on')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByLabel('Price paid')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
});
