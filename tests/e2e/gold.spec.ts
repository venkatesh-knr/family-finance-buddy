import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { choose, next, optionsOf, stepper } from './fields.ts';
import { archiveByName, openHolding, openList, rowFor } from './holdings.ts';

/**
 * Gold: physical gold is added with its purity, its grams and its cost either way in, valued at the household's typed rate, and counted; a
 * gold ETF or fund is a fund under Gold (docs/design/gold.md; docs/decisions.md, Gold).
 *
 * A rate is appended and never removed, so the rates this spec types are for 18K, which the demo household's seed does not hold, and are
 * dated 1 January 2000 and the same every run: a second run adds a row that says what the first said, and the value is the same.
 *
 * Added gold is the spec's own and is archived after.
 */

test.use({ actionTimeout: 15_000 });

const detailValue = (page: Page) => page.getByTestId('detail-value');

const OLD_RATE_DAY = '2000-01-01';

async function openAddGold(page: Page) {
  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();
  await choose(page, 'Type', /^Gold/);
  const form = stepper(page);
  await expect(form).toBeVisible();
  return form;
}

/** Type the 18K rate on an open gold screen, if it is not already the rate in force. */
async function typeRate(page: Page, rupeesAGram: string) {
  await page.getByRole('button', { name: /^(Update rate|Add today's 18K rate)$/ }).click();
  const form = page.getByRole('form', { name: 'Update the 18K rate' });
  await form.getByLabel('18K rate per gram (INR)').fill(rupeesAGram);
  await form.getByLabel('For the day').fill(OLD_RATE_DAY);
  await form.getByRole('button', { name: 'Save rate' }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });
}

test('physical gold is added with a price paid, is valued at the typed rate for its purity, and says what was paid and how far it is up', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `e2e-chain-${Date.now()}`;

  const form = await openAddGold(page);
  await form.getByLabel('What it is').fill(name);
  await choose(page, 'Purity', '18K');
  await next(page);
  await form.getByLabel('Weight (g)').fill('10');
  await form.getByLabel('Bought on').fill('2024-03-01');
  await form.getByLabel('Price paid (INR)').fill('60000');
  // The other way of saying it is worked out and shown beside it: sixty thousand for ten grams is six thousand a gram.
  await expect(form.getByTestId('gold-other-way')).toContainText('6,000 a gram');
  await form.getByRole('button', { name: 'Add gold', exact: true }).click();

  try {
    await openHolding(page, name);
    await typeRate(page, '8000');

    // Ten grams at eight thousand a gram.
    await expect(detailValue(page)).toContainText('80,000');
    await expect(page.getByTestId('gold-sum')).toContainText('10.000 g × ₹8,000 a gram');
    await expect(page.getByTestId('gold-paid')).toContainText('60,000');
    await expect(page.getByTestId('gold-up-since')).toContainText('20,000');
    await expect(page.getByTestId('gold-rate-card')).toContainText('18K rate');
    await expect(page.getByTestId('gold-rate-date')).toContainText('2000');
    await expect(page.getByTestId('gold-rate-date')).toContainText('over 30 days ago');
    await expect(page.getByTestId('gold-caveat')).toContainText('Not counted in your emergency fund or liquid money');
    // The identity line says what it is, its purity and its weight.
    await expect(page.getByTestId('gold-identity')).toContainText('Physical gold · 18K · 10.000 g');

    // The row says what it is.
    await openList(page);
    await expect(await rowFor(page, name)).toContainText('Physical gold · 18K · 10.000 g');
  } finally {
    await archiveByName(page, name);
  }
});

test('a rate per gram typed instead of a price stores the same cost, and a purchase of more grams adds to what is held', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `e2e-coin-${Date.now()}`;

  const form = await openAddGold(page);
  await form.getByLabel('What it is').fill(name);
  await choose(page, 'Purity', '18K');
  await next(page);
  await form.getByLabel('Weight (g)').fill('10');
  await form.getByLabel('Bought on').fill('2024-03-01');
  await form.getByRole('button', { name: 'Rate per gram' }).click();
  await form.getByLabel('Rate per gram (INR)').fill('6000');
  await expect(form.getByTestId('gold-other-way')).toContainText('60,000 in all');
  await form.getByRole('button', { name: 'Add gold', exact: true }).click();

  try {
    await openHolding(page, name);
    await typeRate(page, '8000');
    // Ten grams at six thousand a gram cost sixty thousand, the same as a price of sixty thousand.
    await expect(page.getByTestId('gold-paid')).toContainText('60,000');
    await expect(detailValue(page)).toContainText('80,000');

    // A second purchase: five grams for thirty-five thousand, and the value follows the grams.
    await page.getByRole('button', { name: 'Add a purchase' }).click();
    const purchase = page.getByRole('form', { name: 'Add a purchase' });
    await purchase.getByLabel('Weight (g)').fill('5');
    await purchase.getByLabel('Price paid (INR)').fill('35000');
    await purchase.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(detailValue(page)).toContainText('1,20,000');
    await expect(page.getByTestId('gold-purchases').locator('li')).toHaveCount(2);

    // A sale of five grams takes them out of what is held.
    await page.getByRole('button', { name: 'Record a sale' }).click();
    const sale = page.getByRole('form', { name: 'Record a sale' });
    await sale.getByLabel('Weight sold (g)').fill('5');
    await sale.getByLabel('Sold for (INR)').fill('38000');
    await sale.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(detailValue(page)).toContainText('80,000');
  } finally {
    await archiveByName(page, name);
  }
});

test('a gift is added with no cost, and the screen says its cost is not known rather than showing a gain', async ({ page }) => {
  test.setTimeout(150_000);
  const name = `e2e-gift-${Date.now()}`;

  const form = await openAddGold(page);
  await form.getByLabel('What it is').fill(name);
  await choose(page, 'Purity', '18K');
  await next(page);
  await form.getByLabel('Weight (g)').fill('4');
  await form.getByLabel('Bought on').fill('2023-11-12');
  await form.getByLabel('A gift or inherited, cost not known').check();
  await form.getByRole('button', { name: 'Add gold', exact: true }).click();

  try {
    await openHolding(page, name);
    await typeRate(page, '8000');
    await expect(detailValue(page)).toContainText('32,000');
    await expect(page.getByTestId('gold-paid')).toContainText('a gift, cost not known');
    await expect(page.getByTestId('gold-up-since')).toHaveCount(0);
  } finally {
    await archiveByName(page, name);
  }
});

test('the IBJA link is a plain link to the site, in a new tab, and carries nothing of the household’s', async ({ page }) => {
  test.setTimeout(150_000);
  const name = `e2e-link-${Date.now()}`;
  const form = await openAddGold(page);
  await form.getByLabel('What it is').fill(name);
  await choose(page, 'Purity', '18K');
  await next(page);
  await form.getByLabel('Weight (g)').fill('1');
  await form.getByLabel('Price paid (INR)').fill('6000');
  await form.getByRole('button', { name: 'Add gold', exact: true }).click();
  try {
    await openHolding(page, name);
    const link = page.getByRole('link', { name: /Today.s rate on IBJA/ });
    await expect(link).toHaveAttribute('href', 'https://ibjarates.com');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('rel', /noreferrer/);
  } finally {
    await archiveByName(page, name);
  }
});

test('physical gold is not offered the emergency fund, a fund is, and a gold ETF is a fund listed under Gold', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `e2e-gold-etf-${Date.now()}`;
  const form = await openAddGold(page);
  await form.getByLabel('What it is').fill(name);
  await next(page);
  // Physical gold is never the emergency fund (GD-I10): its sheet of options does not offer it.
  expect(await optionsOf(page, 'Set aside for')).not.toContain('Emergency fund');

  // A gold ETF is a fund, and a fund may be.
  await page.getByRole('button', { name: 'Back' }).click();
  await choose(page, 'Form', 'A gold ETF');
  await next(page);
  await form.getByLabel('Units').fill('50');
  await form.getByLabel('Bought on').fill('2024-06-03');
  await form.getByLabel('Total cost (INR)').fill('5200');
  await next(page);
  expect(await optionsOf(page, 'Set aside for')).toContain('Emergency fund');
  // The ISIN is needed: it is what prices a fund, and the form does not go on without it.
  await expect(form.getByRole('button', { name: 'Add the gold ETF' })).toBeDisabled();
  await form.getByLabel('ISIN').fill('INF000000001');
  await form.getByLabel('Worth today (INR)').fill('5931.31');
  await form.getByRole('button', { name: 'Add the gold ETF' }).click();

  try {
    await openList(page);
    const row = await rowFor(page, name);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('50 units');
    await openHolding(page, name);
    await expect(detailValue(page)).toContainText('5,931.31');
  } finally {
    await archiveByName(page, name);
  }

  // Gold is not a kind a fund can be given on the generic form.
  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();
  expect(await optionsOf(page, 'Kind')).not.toContain('gold');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the gold screens have no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme });
    const found: string[] = [];
    const scan = async (where: string) => {
      const result = await new AxeBuilder({ page }).analyze();
      for (const v of result.violations) found.push(`${where} · ${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    };

    const name = `e2e-a11y-gold-${Date.now()}`;
    const form = await openAddGold(page);
    await scan('add gold, step one');
    await form.getByLabel('What it is').fill(name);
    await choose(page, 'Purity', '18K');
    await next(page);
    await form.getByLabel('Weight (g)').fill('2');
    await form.getByLabel('Price paid (INR)').fill('12000');
    await scan('add gold, step two');
    await form.getByRole('button', { name: 'Add gold', exact: true }).click();

    try {
      await openHolding(page, name);
      await typeRate(page, '8000');
      await page.getByRole('button', { name: 'Add a purchase' }).click();
      await expect(page.getByRole('form', { name: 'Add a purchase' })).toBeVisible();
      await scan('the physical gold screen');
    } finally {
      await archiveByName(page, name);
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}

test('a gift cannot be added to gold that has a tax class, and a purchase says how its cost was typed', async ({ page }) => {
  test.setTimeout(150_000);
  const name = `e2e-mixed-${Date.now()}`;
  const form = await openAddGold(page);
  await form.getByLabel('What it is').fill(name);
  await choose(page, 'Purity', '18K');
  await next(page);
  await form.getByLabel('Weight (g)').fill('2');
  await form.getByLabel('Price paid (INR)').fill('12000');
  await form.getByRole('button', { name: 'Add gold', exact: true }).click();
  try {
    await openHolding(page, name);
    await page.getByRole('button', { name: 'Add a purchase' }).click();
    const purchase = page.getByRole('form', { name: 'Add a purchase' });
    await purchase.getByLabel('Weight (g)').fill('1');
    await purchase.getByLabel('A gift or inherited, cost not known').check();
    await purchase.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByText(/A gift’s cost is not known/)).toBeVisible();
    await expect(page.getByTestId('gold-purchases').locator('li')).toHaveCount(1);
  } finally {
    await archiveByName(page, name);
  }
});

test('a purchase’s date, weight and rate, and a sale, can be corrected, and the value follows', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `e2e-edit-${Date.now()}`;
  const form = await openAddGold(page);
  await form.getByLabel('What it is').fill(name);
  await choose(page, 'Purity', '18K');
  await next(page);
  await form.getByLabel('Weight (g)').fill('10');
  await form.getByLabel('Bought on').fill('2024-03-01');
  await form.getByLabel('Price paid (INR)').fill('60000');
  await form.getByRole('button', { name: 'Add gold', exact: true }).click();
  try {
    await openHolding(page, name);
    await typeRate(page, '8000');
    await expect(detailValue(page)).toContainText('80,000');

    // Correct the purchase: its date, its weight (twelve grams) and its rate per gram (six thousand five hundred).
    await page.getByRole('button', { name: /^Edit the .* purchase$/ }).click();
    const edit = page.getByRole('form', { name: /^Edit the .* purchase$/ });
    await edit.getByLabel('Bought on').fill('2024-04-02');
    await edit.getByLabel('Weight (g)').fill('12');
    await edit.getByRole('button', { name: 'Rate per gram' }).click();
    await edit.getByLabel('Rate per gram (INR)').fill('6500');
    await expect(edit.getByTestId('gold-other-way')).toContainText('78,000 in all');
    await edit.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(edit).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('gold-purchases')).toContainText('2 Apr 2024');
    await expect(page.getByTestId('gold-purchases')).toContainText('12.000 g');
    await expect(page.getByTestId('gold-paid')).toContainText('78,000');
    // Twelve grams at eight thousand a gram.
    await expect(detailValue(page)).toContainText('96,000');

    // A sale, then its correction.
    await page.getByRole('button', { name: 'Record a sale' }).click();
    const sale = page.getByRole('form', { name: 'Record a sale' });
    await sale.getByLabel('Weight sold (g)').fill('2');
    await sale.getByLabel('Sold for (INR)').fill('15000');
    await sale.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(detailValue(page)).toContainText('80,000');
    await page.getByRole('button', { name: /^Edit the .* sale$/ }).click();
    const fix = page.getByRole('form', { name: /^Edit the .* sale$/ });
    await fix.getByLabel('Weight sold (g)').fill('4');
    await fix.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(fix).toHaveCount(0, { timeout: 20_000 });
    await expect(detailValue(page)).toContainText('64,000');
  } finally {
    await archiveByName(page, name);
  }
});

test('a field that is wrong says so under itself, and the step does not go on until it is right', async ({ page }) => {
  test.setTimeout(120_000);
  const form = await openAddGold(page);
  await form.getByLabel('What it is').fill('e2e-never-added');
  await next(page);

  // A weight that is not a weight: the reason is under the field, the field is marked, and the form does not go on.
  await form.getByLabel('Weight (g)').fill('abc');
  await expect(form.getByText('The weight is in grams, above nothing, to three decimals at most.')).toBeVisible();
  await expect(form.getByLabel('Weight (g)')).toHaveAttribute('aria-invalid', 'true');
  await form.getByLabel('Price paid (INR)').fill('1000');
  await expect(form.getByRole('button', { name: 'Add gold', exact: true })).toBeDisabled();

  // Right it, and the mark goes and the form can go on.
  await form.getByLabel('Weight (g)').fill('2');
  await expect(form.getByLabel('Weight (g)')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByRole('button', { name: 'Add gold', exact: true })).toBeEnabled();

  // A date after today, and a year that cannot be: each said on the date.
  await form.getByLabel('Bought on').fill('2999-01-01');
  await expect(form.getByText('It cannot be bought after today.')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Add gold', exact: true })).toBeDisabled();
  await form.getByLabel('Bought on').fill('0001-01-01');
  await expect(form.getByText('That is not a date this can be: check the year.')).toBeVisible();
  await expect(form.getByLabel('Bought on')).toHaveAttribute('aria-invalid', 'true');
});

test('an ETF or fund: units that are not units, and an ISIN that is not one, are marked on their own fields', async ({ page }) => {
  test.setTimeout(120_000);
  const form = await openAddGold(page);
  await form.getByLabel('What it is').fill('e2e-never-added');
  await choose(page, 'Form', 'A gold ETF');
  await next(page);
  await form.getByLabel('Units').fill('0');
  await expect(form.getByText('The units are a number above nothing, such as 50 or 12.5.')).toBeVisible();
  await form.getByLabel('Total cost (INR)').fill('5200');
  await expect(form.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await form.getByLabel('Units').fill('50');
  await next(page);
  await form.getByLabel('ISIN').fill('not-an-isin');
  await expect(form.getByText('An ISIN is twelve letters and digits, such as INF846K01W80.')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Add the gold ETF' })).toBeDisabled();
});
