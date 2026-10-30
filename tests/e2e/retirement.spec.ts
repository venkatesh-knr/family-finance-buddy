import { test, expect, type Page } from '@playwright/test';
import { archiveByName, openHolding, openList, rowFor } from './holdings.ts';

/**
 * Retirement: an EPF, an NPS and a PPF are added from the Holdings screen, take the shape of their type on their own screen, and
 * are counted in what the household owns (docs/decisions.md, Retirement).
 *
 * They write to the demo household like the other holdings specs and archive what they made. The PPF's opening balance is as at
 * the most recent 31 March, so the balance on any day it runs is the opening balance and what was paid in since, whatever the year:
 * a credit on 31 March would otherwise move the figures the day after one.
 */

test.use({ actionTimeout: 15_000 });

const detailValue = (page: Page) => page.getByTestId('detail-value');

async function addRetirement(page: Page, which: 'EPF' | 'NPS' | 'PPF') {
  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();
  await page.getByLabel('What are you adding').selectOption('retirement');
  const form = page.getByRole('form', { name: 'Add a retirement account' });
  await expect(form).toBeVisible();
  await form.getByLabel('Which').selectOption({ label: { EPF: 'EPF: a balance from the passbook', NPS: 'NPS: units and the NAV', PPF: 'PPF: worked out from what is paid in and the notified rate' }[which] });
  return form;
}

/** The most recent 31 March on or before today in India. */
function lastCreditDay(): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const year = Number(today.slice(0, 4));
  return today >= `${String(year)}-03-31` ? `${String(year)}-03-31` : `${String(year - 1)}-03-31`;
}

test('an EPF is added with its passbook balance, valued at once, and a new balance replaces it', async ({ page }) => {
  test.setTimeout(150_000);
  const name = `e2e-epf-${Date.now()}`;

  const form = await addRetirement(page, 'EPF');
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Balance from the passbook', { exact: true }).fill('1234567');
  await form.getByRole('button', { name: 'Add the EPF' }).click();

  try {
    // In the list at once, under Retirement, saying what it is and with its figure: not "not valued".
    const row = await rowFor(page, name);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('EPF');
    await expect(row).toContainText('12,34,567');
    await expect(row).not.toContainText('not valued');
    await expect(page.getByRole('heading', { name: /^Retirement/ }).or(page.getByText(/^Retirement\b/).first())).toBeVisible();

    // Its own screen: the value, and a passbook balance to record.
    await openHolding(page, name);
    await expect(detailValue(page)).toContainText('12,34,567');
    await page.getByRole('button', { name: 'Record the passbook balance' }).click();
    await page.getByLabel('Passbook balance (INR)').fill('1300000');
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(detailValue(page)).toContainText('13,00,000');
    // The readings are listed, newest first.
    await expect(page.getByRole('region', { name: 'Readings' })).toContainText('13,00,000');
  } finally {
    await archiveByName(page, name);
  }
});

test('an NPS is units and the NAV: the value is worked out, never typed', async ({ page }) => {
  test.setTimeout(150_000);
  const name = `e2e-nps-${Date.now()}`;

  const form = await addRetirement(page, 'NPS');
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Units', { exact: true }).fill('1000.5');
  await form.getByLabel('NAV', { exact: true }).fill('45.6789');
  // 1,000.5 x 45.6789 = 45,701.73945, which is 45,701.74: said before it is added.
  await expect(form).toContainText('45,701.74');
  await form.getByRole('button', { name: 'Add the NPS' }).click();

  try {
    const row = await rowFor(page, name);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('NPS · 1,000.5 units');
    await expect(row).toContainText('45,701');

    await openHolding(page, name);
    await page.getByRole('button', { name: 'Record the NAV' }).click();
    const nav = page.getByRole('form', { name: 'Record the NAV' });
    await nav.getByLabel('NAV', { exact: true }).fill('50');
    // 1,000.5 x 50 = 50,025.
    await expect(nav).toContainText('50,025');
    await nav.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(detailValue(page)).toContainText('50,025');
  } finally {
    await archiveByName(page, name);
  }
});

test('a PPF is worked out from its account and payments, offered as a reading, and a payment can be voided', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `e2e-ppf-${Date.now()}`;

  const form = await addRetirement(page, 'PPF');
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Bank or post office').fill('SBI');
  await form.getByLabel('Last four').fill('1234');
  await form.getByLabel('Opening balance', { exact: true }).fill('100000');
  await form.getByLabel('As at', { exact: true }).fill(lastCreditDay());
  // The value on the day, worked out from the opening balance, offered as its first reading and ticked.
  const offer = form.getByLabel(/Record today.s value/);
  await expect(offer).toBeChecked({ timeout: 20_000 });
  await form.getByRole('button', { name: 'Add the PPF' }).click();

  try {
    const row = await rowFor(page, name);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('PPF');
    await expect(row).not.toContainText('not valued');
    await expect(row).toContainText('1,00,000');

    await openHolding(page, name);
    await expect(detailValue(page)).toContainText('1,00,000');
    const account = page.getByRole('region', { name: 'Account' });
    await expect(account).toContainText('SBI');
    await expect(account).toContainText('1234');
    await expect(account).toContainText('7.1%');

    // The value is worked out and is the reading: nothing to record, and the interest not yet credited is said apart from it.
    const worked = page.getByTestId('ppf-worked-out');
    await expect(worked).toContainText('Worked out today');
    await expect(worked).toContainText('Recorded as today');
    await expect(worked).toContainText('accrued since the last credit');

    // A payment today moves the worked-out value and not the reading until it is recorded.
    const payment = page.getByRole('form', { name: 'Record a PPF payment' });
    await payment.getByLabel('Amount').fill('50000');
    await payment.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Payments' })).toContainText('50,000');
    await expect(worked).toContainText('1,50,000');
    await expect(worked).toContainText('not in net worth until recorded');
    await expect(detailValue(page)).toContainText('1,00,000');

    await worked.getByRole('button', { name: /Record as today/ }).click();
    await expect(detailValue(page)).toContainText('1,50,000');

    // Voided, a payment stays in the list, struck out, and out of the balance.
    await page.getByRole('button', { name: /^Void the payment/ }).click();
    await expect(page.getByRole('region', { name: 'Payments' }).getByText('Voided', { exact: true })).toBeVisible();
    await expect(worked).toContainText('1,00,000');
    await expect(worked).toContainText('not in net worth until recorded');
  } finally {
    await archiveByName(page, name);
  }
});

test('a retirement holding is a row of the allocation, under its own name', async ({ page }) => {
  test.setTimeout(150_000);
  const name = `e2e-epf-alloc-${Date.now()}`;

  const form = await addRetirement(page, 'EPF');
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Balance from the passbook', { exact: true }).fill('2500000');
  await form.getByRole('button', { name: 'Add the EPF' }).click();

  try {
    await expect(await rowFor(page, name)).toBeVisible({ timeout: 20_000 });
    await page.goto('/#overview');
    await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
    const row = page.locator('.alloc-row').filter({ hasText: /^Retirement/ });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await expect(row.locator('a')).toHaveAttribute('href', '#/holdings?kind=retirement');
  } finally {
    await archiveByName(page, name);
  }
});

test('Retirement is not a kind a fund can be given, and an EPF is not offered the fund kinds', async ({ page }) => {
  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();
  // The fund form has no Retirement among its kinds: it has its own form, which asks for the type.
  const fund = page.locator('form').filter({ hasText: 'Priced in' });
  await expect(fund.getByLabel('Kind').locator('option', { hasText: 'retirement' })).toHaveCount(0);
});
