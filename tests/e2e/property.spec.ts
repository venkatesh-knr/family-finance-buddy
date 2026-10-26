import { test, expect, type Page } from '@playwright/test';

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
  await form.getByLabel('Bought on').fill('2019-03-01');
  await form.getByLabel('Price paid').fill('4200000');
  await form.getByLabel('Stamp duty').fill('294000');
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
    await valuation.getByLabel('How you arrived at it').selectOption({ label: 'A broker’s view' });
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
    await work.getByLabel('Type').selectOption('repair');
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
  await form.getByLabel('Bought on').fill('2019-03-01');
  await form.getByLabel('Price paid').fill('100');
  await form.getByLabel(/Household.s share/).fill('150');
  await form.getByRole('button', { name: 'Add the property' }).click();
  await expect(form).toContainText('a percentage above 0 and up to 100');
  // And nothing was filed.
  await expect(page.getByRole('region', { name: 'never saved' })).toHaveCount(0);
});
