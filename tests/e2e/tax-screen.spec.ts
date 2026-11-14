import { test, expect, type Page } from '@playwright/test';
import { testName } from './created.ts';
import { choose, next, stepper } from './fields.ts';
import { archiveByName, openHolding, openList } from './holdings.ts';

/**
 * Tax as its artboard draws it (docs/design/vibrant-canvas.html, Tax): whose return and which year on one line, the
 * estimate in the one lifted card with its working behind a fold, the gains with the allowance as one bar, the
 * sales as stacked rows, and one quiet line with two buttons for the rest.
 *
 * The figures come from the seed's rules. What is typed in the estimate is held on the page until Save, and a spec checks that; saving is
 * its own spec at the end, since what is saved lasts for the run.
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
  await expect(estimate).toContainText(/Kept for .*, once saved: only they and whoever typed it can read these figures\./);

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

test('what is typed is held on the page until it is saved, and gone on a reload', async ({ page }) => {
  await onTax(page);
  const salary = page.getByRole('region', { name: 'Estimated tax' }).getByLabel('Salary for the year');
  await salary.fill('1200000');
  await expect(salary).toHaveValue('1200000');
  await onTax(page);
  await page.reload();
  // A figure that was saved earlier in the run may be there; what was typed and not saved is not.
  await expect(page.getByRole('region', { name: 'Estimated tax' }).getByLabel('Salary for the year')).not.toHaveValue('1200000', {
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
  const add = stepper(page);
  await choose(page, 'Kind', 'mutual fund');
  await add.getByLabel('What it is').fill(name);
  await next(page);
  await choose(page, 'Priced in', 'INR');
  await choose(page, 'Tracks', 'INR');
  await add.getByRole('checkbox').uncheck();
  await next(page);
  await add.getByLabel('Quantity').fill('10');
  await add.getByRole('button', { name: 'Add', exact: true }).click();

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
    await choose(page, 'Taxed as', 'Equity mutual fund');
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

/** The rupees in a figure such as "₹1,50,800": 150800. */
function rupees(text: string): number {
  const first = /₹\s*([\d,]+(?:\.\d+)?)/.exec(text);
  return first === null ? Number.NaN : Number((first[1] as string).replace(/,/g, ''));
}

test('LI-I11 — saved figures are kept for the member, the tax already deducted is taken off, and a Form 16 figure is used from then on', async ({ page, isMobile }) => {
  test.skip(isMobile, 'it writes figures that last for the run, and a Form 16 correction cannot be undone within it');
  test.setTimeout(120_000);
  await onTax(page);
  const estimate = page.getByRole('region', { name: 'Estimated tax' });

  // A salary of ₹22,80,000 with ₹2,50,000 deducted so far, and a business profit of ₹3,00,000.
  await estimate.getByLabel(/^Gross salary for the year/).fill('2280000');
  await estimate.getByLabel('TDS so far').fill('250000');
  await estimate.getByLabel('Business or professional income').fill('300000');
  await estimate.getByRole('button', { name: 'Save these figures' }).click();
  await expect(estimate.getByRole('status')).toContainText('Saved.', { timeout: 20_000 });

  // Kept: a reload reads them back. The business profit is taxed with no standard deduction, so it is in the working beside the salary's.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Estimated tax' })).toBeVisible({ timeout: 20_000 });
  await expect(estimate.getByLabel(/^Gross salary for the year/)).toHaveValue('2280000.00', { timeout: 20_000 });
  await expect(estimate.getByLabel('TDS so far')).toHaveValue('250000.00');
  await expect(estimate.getByLabel('Business or professional income')).toHaveValue('300000.00');
  // The source pill says where the salary came from, and when.
  await expect(estimate).toContainText(/From payslip · \d{1,2} \w{3} \d{4}/);

  // Privacy mode removes the figures from the boxes, as it does from every other amount: the digits are not in the page.
  await page.getByRole('button', { name: /Amounts shown/ }).click();
  await expect(estimate.getByLabel(/^Gross salary for the year/)).toHaveValue('••••••');
  await expect(estimate.getByLabel('TDS so far')).toHaveValue('••••••');
  await expect(estimate.getByRole('button', { name: 'Save these figures' })).toBeDisabled();
  await page.getByRole('button', { name: /Amounts hidden/ }).click();
  await expect(estimate.getByLabel(/^Gross salary for the year/)).toHaveValue('2280000.00');

  await estimate.getByRole('button', { name: 'How it adds up' }).click();
  await expect(estimate.locator('dl')).toContainText('Business or professional income');
  await expect(estimate.locator('dl')).toContainText('₹3,00,000');

  // The tax already deducted is taken off the estimate.
  const total = rupees(await estimate.locator('.tax-figure').innerText());
  const still = estimate.getByTestId('still-to-pay');
  await expect(still).toBeVisible();
  const left = rupees(await still.innerText());
  // Taken off exactly, when the estimate is more than what was deducted.
  if (total > 250_000) expect(left).toBe(total - 250_000);

  // A loss is refused by name, and nothing is written.
  await estimate.getByLabel('Business or professional income').fill('-5000');
  await expect(estimate.getByText(/A business loss is not entered here/)).toBeVisible();
  await estimate.getByRole('button', { name: 'Save these figures' }).click();
  await expect(estimate.getByRole('alert').filter({ hasText: 'business loss' }).first()).toBeVisible();
  await estimate.getByLabel('Business or professional income').fill('300000');

  // Corrected from Form 16: its own figure, used from then on, with the payslip's beside it.
  await estimate.getByLabel(/^Gross salary for the year/).fill('2300000');
  await estimate.getByRole('button', { name: 'Correct from Form 16' }).click();
  await expect(estimate.getByRole('status')).toContainText('The Form 16 figure is used from now on', { timeout: 20_000 });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Estimated tax' })).toBeVisible({ timeout: 20_000 });
  await expect(estimate.getByLabel(/^Gross salary for the year \(Form 16\)/)).toHaveValue('2300000.00', { timeout: 20_000 });
  await expect(estimate).toContainText('was ₹22,80,000 from payslip');
  await expect(estimate).toContainText(/Form 16 · corrected \d{1,2} \w{3} \d{4}/);

  // Once there is a Form 16 figure, Save writes to it: an edit after the correction takes effect, and is not saved under a figure never used.
  await estimate.getByLabel(/^Gross salary for the year/).fill('2400000');
  await estimate.getByRole('button', { name: 'Save these figures' }).click();
  await expect(estimate.getByRole('status')).toContainText('Saved.', { timeout: 20_000 });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Estimated tax' })).toBeVisible({ timeout: 20_000 });
  await expect(estimate.getByLabel(/^Gross salary for the year \(Form 16\)/)).toHaveValue('2400000.00', { timeout: 20_000 });
  await expect(estimate).toContainText('was ₹22,80,000 from payslip');

  // Put back what other specs in the run expect to find: nothing of consequence.
  await estimate.getByLabel(/^Gross salary for the year/).fill('0');
  await estimate.getByLabel('Business or professional income').fill('0');
  await estimate.getByLabel('TDS so far').fill('0');
  await estimate.getByRole('button', { name: 'Correct from Form 16' }).click();
  await expect(estimate.getByRole('status')).toContainText('Saved', { timeout: 20_000 });
});
