import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
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
  await page.getByLabel('What are you adding').selectOption('gold');
  const form = page.getByRole('form', { name: 'Add gold' });
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
  await form.getByRole('button', { name: '18K', exact: true }).click();
  await form.getByLabel('Weight (g)').fill('10');
  await form.getByLabel('Bought on').fill('2024-03-01');
  await form.getByLabel('Price paid (INR)').fill('60000');
  // The other way of saying it is worked out and shown beside it: sixty thousand for ten grams is six thousand a gram.
  await expect(form.getByTestId('gold-other-way')).toContainText('6,000 a gram');
  await form.getByRole('button', { name: 'Add', exact: true }).click();

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
  await form.getByRole('button', { name: '18K', exact: true }).click();
  await form.getByLabel('Weight (g)').fill('10');
  await form.getByLabel('Bought on').fill('2024-03-01');
  await form.getByRole('button', { name: 'Rate per gram' }).click();
  await form.getByLabel('Rate per gram (INR)').fill('6000');
  await expect(form.getByTestId('gold-other-way')).toContainText('60,000 in all');
  await form.getByRole('button', { name: 'Add', exact: true }).click();

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
  await form.getByRole('button', { name: '18K', exact: true }).click();
  await form.getByLabel('Weight (g)').fill('4');
  await form.getByLabel('Bought on').fill('2023-11-12');
  await form.getByLabel('A gift or inherited, cost not known').check();
  await form.getByRole('button', { name: 'Add', exact: true }).click();

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
  await form.getByRole('button', { name: '18K', exact: true }).click();
  await form.getByLabel('Weight (g)').fill('1');
  await form.getByLabel('Price paid (INR)').fill('6000');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
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
  await expect(form.getByLabel('Set aside for').locator('option', { hasText: /emergency/i })).toHaveCount(0);

  await form.getByRole('button', { name: 'ETF or fund' }).click();
  await expect(form.getByLabel('Set aside for').locator('option', { hasText: /emergency/i })).toHaveCount(1);
  await form.getByLabel('Fund or ETF').fill(name);
  await form.getByLabel('Units').fill('50');
  await form.getByLabel('Bought on').fill('2024-06-03');
  await form.getByLabel('Total cost (INR)').fill('5200');
  await form.getByLabel('Worth today (INR)').fill('5931.31');
  await form.getByRole('button', { name: 'Add', exact: true }).click();

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
  await page.getByLabel('What are you adding').selectOption('holding');
  const fund = page.locator('form').filter({ hasText: 'Priced in' });
  await expect(fund.getByLabel('Kind').locator('option', { hasText: 'gold' })).toHaveCount(0);
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
    await scan('add physical gold');
    await form.getByRole('button', { name: 'ETF or fund' }).click();
    await scan('add an ETF or fund');
    await form.getByRole('button', { name: 'Physical gold' }).click();
    await form.getByLabel('What it is').fill(name);
    await form.getByRole('button', { name: '18K', exact: true }).click();
    await form.getByLabel('Weight (g)').fill('2');
    await form.getByLabel('Price paid (INR)').fill('12000');
    await form.getByRole('button', { name: 'Add', exact: true }).click();

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
