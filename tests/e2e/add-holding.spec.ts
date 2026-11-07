import { test, expect } from '@playwright/test';
import { choiceField, choose, next, stepper } from './fields.ts';
import { archiveByName, openFixedForm, openHolding, openList, rowFor } from './holdings.ts';

/**
 * A holding is valued, and says what it is for, when it is added, not only after a second visit to its own screen.
 *
 * It was added with a quantity alone and listed as "not valued" until somebody opened it and recorded a reading, and
 * its earmark could be set only by editing it afterwards. Both are said on the Add form now. It writes to the demo
 * household like the other holdings specs and archives what it made.
 *
 * Add a holding is a form in steps (docs/design/simple-layout.md section 4): what it is, then what it is priced in, then how much.
 */

test.use({ actionTimeout: 15_000 });

/** A fund, through its first two steps, left on the third: priced in rupees and not a foreign asset. */
async function fillFundToHowMuch(page: import('@playwright/test').Page, name: string) {
  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();
  const add = stepper(page);
  await add.getByLabel('What it is').fill(name);
  await next(page);
  await choose(page, 'Priced in', 'INR');
  await choose(page, 'Tracks', 'INR');
  await page.getByLabel(/Foreign asset for disclosure/).uncheck();
  await next(page);
  return add;
}

test('a fund added with what it is worth today is valued at once, and carries its earmark', async ({ page }) => {
  test.setTimeout(90_000);
  const name = `e2e-add-${Date.now()}`;

  const add = await fillFundToHowMuch(page, name);
  await add.getByLabel('Quantity').fill('10');
  await add.getByLabel('Worth today').fill('12345.5');
  await choose(page, 'Set aside for', "Child's savings");
  await add.getByRole('button', { name: 'Add', exact: true }).click();

  try {
    // On the list as soon as it is added: a figure, not "not valued", and the earmark beside the name.
    const row = await rowFor(page, name);
    await expect(row).toContainText('12,345');
    await expect(row).not.toContainText('not valued');
    await expect(row.getByText('Child’s', { exact: true })).toBeVisible();
  } finally {
    await archiveByName(page, name);
  }
});

test('a fund added without a value is still listed as not valued, and nothing is invented', async ({ page }) => {
  test.setTimeout(90_000);
  const name = `e2e-add-bare-${Date.now()}`;

  const add = await fillFundToHowMuch(page, name);
  await add.getByLabel('Quantity').fill('3');
  await add.getByRole('button', { name: 'Add', exact: true }).click();

  try {
    await expect(await rowFor(page, name)).toContainText('not valued');
  } finally {
    await archiveByName(page, name);
  }
});

/** A deposit, through its first three steps, left on the fourth: where it is held and what it is for. */
async function fillDepositToWhere(page: import('@playwright/test').Page, fields: { name: string; principal: string; rate: string; starts: string; matures: string }) {
  const form = await openFixedForm(page);
  await form.getByLabel('Name', { exact: true }).fill(fields.name);
  await next(page);
  await form.getByLabel('Principal').fill(fields.principal);
  await form.getByLabel('Rate %', { exact: true }).fill(fields.rate);
  await form.getByLabel('Starts').fill(fields.starts);
  await form.getByLabel('Matures').fill(fields.matures);
  await next(page);
  await next(page);
  return form;
}

test('a running deposit offers its worked-out value as its first reading, and is valued once added', async ({ page }) => {
  test.setTimeout(90_000);
  const name = `e2e-add-fd-${Date.now()}`;

  const form = await fillDepositToWhere(page, { name, principal: '100000', rate: '7.5', starts: '2026-01-01', matures: '2031-01-01' });

  // Said before it is added, with the figure, and on unless somebody turns it off.
  const offer = form.getByLabel(/Record today.s value/);
  await expect(offer).toBeChecked();
  await choose(page, 'Set aside for', 'Emergency fund');
  await form.getByRole('button', { name: 'Add the deposit' }).click();

  try {
    const row = await rowFor(page, name);
    await expect(row).not.toContainText('not valued');
    await expect(row).toContainText('₹');
    await expect(row.getByText('Emergency', { exact: true })).toBeVisible();
  } finally {
    await archiveByName(page, name);
  }
});

test('a deposit that has already paid out is not offered a first reading', async ({ page }) => {
  // The form is not finished, so nothing is added: it is only read.
  const form = await fillDepositToWhere(page, { name: 'e2e-never-added', principal: '100000', rate: '7.5', starts: '2024-01-01', matures: '2025-01-01' });

  // What it would be worth is a payout, money in an account and not a holding, so it is not recorded as one.
  await expect(form.getByLabel(/Record today.s value/)).toHaveCount(0);
});

test('a deposit is given its scheme when it is added, and a bond is not offered one', async ({ page }) => {
  test.setTimeout(90_000);
  const name = `e2e-add-ssy-${Date.now()}`;

  const form = await fillDepositToWhere(page, { name, principal: '100000', rate: '7.1', starts: '2026-01-01', matures: '2041-01-01' });
  await choose(page, 'Scheme', 'Sukanya Samriddhi');
  await form.getByRole('button', { name: 'Add the deposit' }).click();

  try {
    // It is the holding's own, so editing it shows what was said when it was added.
    await openHolding(page, name);
    await page.getByRole('button', { name: /^Edit / }).first().click();
    await expect(choiceField(page, 'Scheme')).toContainText('Sukanya Samriddhi');
  } finally {
    await archiveByName(page, name);
  }

  // A scheme says what a deposit is, so a bond's form has none. A PPF is not among them: it is added as a retirement account.
  await openFixedForm(page);
  await page.getByRole('button', { name: 'Bond', exact: true }).click();
  await expect(page.getByLabel('Scheme')).toHaveCount(0);
});
