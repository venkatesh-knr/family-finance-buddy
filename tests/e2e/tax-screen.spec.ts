import { test, expect, type Page } from '@playwright/test';
import { testName } from './created.ts';
import { archiveByName, openHolding, openList } from './holdings.ts';

/**
 * Tax as its artboard draws it (docs/design/vibrant-canvas.html, Tax): whose return and which year on one line, the
 * estimate in the one lifted card with its working behind a fold, the gains with the allowance as one bar, the
 * sales as stacked rows, and one quiet line with two buttons for the rest.
 *
 * The figures come from the seed's rules. What is typed in the estimate is never saved, and a spec checks that.
 * One test records a sale through Holdings to see a row on the sales list, and archives the holding after.
 */

async function onTax(page: Page) {
  await page.goto('/#tax');
  await expect(page.getByRole('region', { name: 'Estimated tax' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
}

test('whose return and which year are one line, with the days that are left', async ({ page }) => {
  await onTax(page);
  await expect(page.getByLabel('Whose return').first()).toBeAttached();
  // One year to choose between and there is no choosing: it is said, not offered.
  await expect(page.getByLabel('Tax year').first()).toBeVisible();
  await expect(page.locator('.tax-head')).toContainText(/\d+ days? left|ended/);
  // The old card of prose about a working paper is one line, further down.
  await expect(page.getByRole('heading', { name: 'Tax year' })).toHaveCount(0);
});

test('the estimate is the figure first, then the two amounts, and the working is behind a fold', async ({ page }) => {
  await onTax(page);
  const estimate = page.getByRole('region', { name: 'Estimated tax' });
  await expect(estimate.locator('.tax-figure')).toContainText('₹');
  await expect(estimate).toContainText('Typed here, never saved');

  // The working is not drawn until it is asked for.
  const fold = estimate.getByRole('button', { name: 'How it adds up' });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(estimate.getByText('Taxable income')).toHaveCount(0);

  // A known answer, new regime: 18,00,000 less the ₹75,000 standard deduction is 17,25,000, whose slab tax is
  // ₹1,45,000, and 4% cess on it is ₹5,800.
  await estimate.getByLabel('Salary for the year').fill('1800000');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(estimate.getByText('Taxable income')).toBeVisible();
  await expect(estimate.locator('dl')).toContainText('₹17,25,000');
  await expect(estimate.locator('dl')).toContainText('₹1,45,000');
  await expect(estimate.locator('.tax-figure')).toContainText('₹1,50,800');

  // The regime is one press away, and changes the figure.
  await estimate.getByRole('button', { name: 'Old', exact: true }).click();
  await expect(estimate.getByRole('button', { name: 'Old', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(estimate.locator('.tax-figure')).not.toContainText('₹1,50,800');
});

test('what is typed is held on the page and gone on a reload, as the card says', async ({ page }) => {
  await onTax(page);
  const salary = page.getByRole('region', { name: 'Estimated tax' }).getByLabel('Salary for the year');
  await salary.fill('1200000');
  await expect(salary).toHaveValue('1200000');
  await onTax(page);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Estimated tax' }).getByLabel('Salary for the year')).toHaveValue('', {
    timeout: 20_000,
  });
});

test('an amount that is not an amount is said so beside the field, and is not treated as nothing', async ({ page }) => {
  await onTax(page);
  const estimate = page.getByRole('region', { name: 'Estimated tax' });
  await estimate.getByLabel('Other income at slab rates').fill('about a lakh');
  await expect(estimate.getByRole('alert')).toBeVisible();
  await expect(estimate.getByLabel('Other income at slab rates')).toHaveAttribute('aria-invalid', 'true');

  // Not counted as nothing: the tax on the other amount alone is not given as the answer.
  await estimate.getByLabel('Salary for the year').fill('1800000');
  await expect(estimate.locator('.tax-figure')).not.toContainText('₹');
  await expect(estimate.locator('.tax-figure').getByRole('img', { name: 'not shown' })).toBeVisible();
  await estimate.getByLabel('Other income at slab rates').fill('');
  await expect(estimate.locator('.tax-figure')).toContainText('₹1,50,800');
});

test('the gains and the allowance are one card: four figures and one bar with what is left of it', async ({ page }) => {
  await onTax(page);
  const gains = page.getByRole('region', { name: 'Capital gains' });
  for (const label of ['Long term, net', 'Short term, net', 'Taxable, long term', 'Taxable, short term']) {
    await expect(gains.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(gains.getByRole('img', { name: /Long-term equity allowance used/ })).toBeVisible();
  await expect(gains).toContainText(/unused · lapses on 31 Mar|went unused/);
  // The allowance is not a card of its own any more.
  await expect(page.getByRole('region', { name: 'Expiring this year' })).toHaveCount(0);
});

test('one muted line says what the page is, and two buttons hold the rest', async ({ page }) => {
  await onTax(page);
  await expect(page.getByTestId('tax-caveat')).toContainText('A working paper, not a filing');

  const assumes = page.getByRole('button', { name: 'What this assumes' });
  const rates = page.getByRole('button', { name: 'Rates applied' });
  await expect(assumes).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('region', { name: 'What this assumes' })).toHaveCount(0);

  await assumes.click();
  const panel = page.getByRole('region', { name: 'What this assumes' });
  await expect(panel).toContainText('One person at a time');
  await expect(panel).toContainText('Still to come');

  // One at a time: the rates replace the assumptions, and say which year and which regime they are for.
  await rates.click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Rates applied' })).toContainText(/Rates applied for \d{4}–\d{2}, new regime/);
  await expect(rates).toHaveAttribute('aria-expanded', 'true');
});

test('with amounts hidden, no amount of the gains, the sales or the estimate is in the document', async ({ page }) => {
  await onTax(page);
  await page.getByRole('button', { name: /Amounts shown/ }).click();
  for (const name of ['Estimated tax', 'Capital gains', 'Sales this year']) {
    const text = (await page.getByRole('region', { name }).textContent()) ?? '';
    expect(text, `${name} carries an amount`).not.toMatch(/₹\s*\d/);
  }
});

test('a sale appears as a row: its tile, its name, its gain with a sign, when, how long, and which term', async ({ page }) => {
  const name = testName('tax');
  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('combobox', { name: 'Kind' }).selectOption('mutual_fund');
  await page.getByRole('combobox', { name: 'Priced in' }).selectOption('INR');
  await page.getByRole('combobox', { name: 'Tracks', exact: true }).selectOption('INR');
  await page.getByRole('checkbox').uncheck();
  await page.getByLabel('Quantity').fill('10');
  await page.locator('form').getByRole('button', { name: 'Add', exact: true }).click();

  try {
    await openHolding(page, name);
    await page.getByRole('button', { name: 'Add a purchase or sale' }).first().click();
    const forms = page.locator('.inset-form');
    await forms.getByLabel('Units').first().fill('10');
    await forms.getByLabel(/^Cost/).fill('1000');
    await forms.getByLabel('Bought on').fill('2024-01-15');
    await forms.getByRole('button', { name: 'Add purchase' }).click();
    // The form empties once the purchase is in.
    await expect(forms.getByLabel('Units').first()).toHaveValue('', { timeout: 20_000 });
    await forms.getByLabel('Units').nth(1).fill('10');
    await forms.getByLabel(/^Proceeds/).fill('1500');
    await forms.getByRole('button', { name: 'Add sale' }).click();
    await expect(forms.getByLabel('Units').nth(1)).toHaveValue('', { timeout: 20_000 });

    // Not classified yet, so it is listed and left out, with the reason, and never guessed at.
    await onTax(page);
    const sales = page.getByRole('region', { name: 'Sales this year' });
    const row = sales.getByRole('listitem').filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('+₹500');
    await expect(row).toContainText(/sold \d{1,2} \w+ · held \d+ yr/);
    await expect(row).toContainText('Class not set');
    await expect(page.getByText(/1 sale is listed below but not in the figures above/)).toBeVisible();

    // Classified, it is in the figures and says its term.
    await openHolding(page, name);
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await page
      .locator('select')
      .filter({ has: page.locator('option[value="equity_fund"]') })
      .selectOption('equity_fund');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: `Edit ${name}` })).toBeVisible({ timeout: 20_000 });

    await onTax(page);
    const placed = page.getByRole('region', { name: 'Sales this year' }).getByRole('listitem').filter({ hasText: name });
    await expect(placed).toContainText('long term', { timeout: 20_000 });
    await expect(placed).not.toContainText('Class not set');
    await expect(page.getByText(/sales? (is|are) listed below but not in the figures above/)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Capital gains' })).toContainText('+₹500');
  } finally {
    await archiveByName(page, name);
  }
});
