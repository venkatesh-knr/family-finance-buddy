import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { archiveByName, openHolding, openList, rowFor } from './holdings.ts';

/**
 * Gold: a jeweller's savings scheme is added, listed with how far through it is, recorded against, and counted (docs/design/gold.md;
 * docs/decisions.md, Gold). The demo household has one scheme, an amount scheme with five of eleven instalments paid.
 *
 * Added schemes are the spec's own and are archived after.
 */

test.use({ actionTimeout: 15_000 });

const detailValue = (page: Page) => page.getByTestId('detail-value');

/** The first day of the current month in India: a day from 1 to 28, so a scheme may fall due on it. */
function firstOfMonth(): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return `${today.slice(0, 8)}01`;
}

test('the demo scheme is a row saying who it is with and how far through it is, and its own screen works it out', async ({ page }) => {
  test.setTimeout(120_000);
  await openList(page);
  const row = await rowFor(page, 'Gold savings');
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('Demo Jewellers · 5 of 11 paid');

  await openHolding(page, 'Gold savings');
  // The value is the instalments paid, and the bonus is not in it: five of five thousand.
  await expect(detailValue(page)).toContainText('25,000');
  const worked = page.getByTestId('gold-worked');
  await expect(worked).toContainText('paid so far · 5 of 11 instalments');
  await expect(page.getByTestId('gold-next')).toContainText('Next');
  // What is redeemable at maturity if every instalment is paid, with the one-instalment bonus: eleven and one of five thousand.
  await expect(page.getByTestId('gold-at-maturity')).toContainText('60,000');
  // The caveat is always on the screen.
  await expect(page.getByTestId('gold-caveat')).toContainText('Held by a jeweller, not a bank, and redeemable only as jewellery');
  await expect(page.getByTestId('gold-caveat')).toContainText('Not counted in your emergency fund or liquid money');

  // The terms, and the instalments recorded.
  const terms = page.getByRole('region', { name: 'Terms' });
  await expect(terms).toContainText('Demo Jewellers');
  await expect(terms).toContainText('2093');
  await expect(terms).toContainText('jewellery only');
  await expect(page.getByRole('region', { name: 'Instalments' })).toContainText('5,000');
});

test('a scheme is added with its terms, has paid nothing, and an instalment recorded is counted at once', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `e2e-gold-${Date.now()}`;

  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();
  await page.getByLabel('What are you adding').selectOption('gold');
  const form = page.getByRole('form', { name: 'Add a gold savings scheme' });
  await expect(form).toBeVisible();
  await form.getByLabel('Jeweller', { exact: true }).fill('E2E Jewellers');
  await form.getByLabel('Name in the list (optional)').fill(name);
  await form.getByLabel('Instalment (INR)').fill('2000');
  await form.getByLabel('Instalments', { exact: true }).fill('6');
  await form.getByLabel('First falls due').fill(firstOfMonth());
  await form.getByLabel('Bonus, as the jeweller says it').fill('one instalment');
  await form.getByLabel('Bonus worth (INR)').fill('2000');
  await form.getByLabel('Scheme number, last four').fill('7788');
  await form.getByRole('button', { name: 'Add the scheme' }).click();

  try {
    const row = await rowFor(page, name);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('E2E Jewellers · 0 of 6 paid');

    await openHolding(page, name);
    await expect(page.getByTestId('gold-worked')).toContainText('paid so far · 0 of 6 instalments');
    // At maturity: six of two thousand and the bonus of two thousand.
    await expect(page.getByTestId('gold-at-maturity')).toContainText('14,000');

    // An instalment recorded makes the value, which is what is paid.
    await page.getByRole('button', { name: 'Record an instalment' }).click();
    const instalment = page.getByRole('form', { name: 'Record an instalment' });
    await expect(instalment.getByLabel('Amount (INR)')).toHaveValue('2000');
    await instalment.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(detailValue(page)).toContainText('2,000');
    await expect(page.getByTestId('gold-worked')).toContainText('paid so far · 1 of 6 instalments');
    await expect(page.getByRole('region', { name: 'Instalments' })).toContainText('2,000');
  } finally {
    await archiveByName(page, name);
  }
});

test('a scheme is not offered the emergency fund, and a fund’s form does not offer gold as a kind', async ({ page }) => {
  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();
  await page.getByLabel('What are you adding').selectOption('gold');
  const form = page.getByRole('form', { name: 'Add a gold savings scheme' });
  await expect(form.getByLabel('Set aside for').locator('option', { hasText: /emergency/i })).toHaveCount(0);

  await page.getByLabel('What are you adding').selectOption('holding');
  const fund = page.locator('form').filter({ hasText: 'Priced in' });
  await expect(fund.getByLabel('Kind').locator('option', { hasText: 'gold' })).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the gold screens have no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ colorScheme: scheme });
    const found: string[] = [];
    const scan = async (where: string) => {
      const result = await new AxeBuilder({ page }).analyze();
      for (const v of result.violations) found.push(`${where} · ${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    };

    await openList(page);
    await page.getByRole('button', { name: /^Add\b/ }).click();
    await page.getByLabel('What are you adding').selectOption('gold');
    await expect(page.getByRole('form', { name: 'Add a gold savings scheme' })).toBeVisible();
    await page.getByLabel(/^Kind/).selectOption('weight');
    await scan('add form, by weight');

    await openHolding(page, 'Gold savings');
    await page.getByRole('button', { name: 'Record an instalment' }).click();
    await expect(page.getByRole('form', { name: 'Record an instalment' })).toBeVisible();
    await scan('the scheme’s screen');
    expect(found, found.join('\n')).toEqual([]);
  });
}
