import { test, expect } from '@playwright/test';
import { archiveByName, openFixedForm, openList, rowFor } from './holdings.ts';

/**
 * A holding is valued, and says what it is for, when it is added, not only after a second visit to its own screen.
 *
 * It was added with a quantity alone and listed as "not valued" until somebody opened it and recorded a reading, and
 * its earmark could be set only by editing it afterwards. Both are said on the Add form now. It writes to the demo
 * household like the other holdings specs and archives what it made.
 */

test.use({ actionTimeout: 15_000 });

test('a fund added with what it is worth today is valued at once, and carries its earmark', async ({ page }) => {
  test.setTimeout(90_000);
  const name = `e2e-add-${Date.now()}`;

  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();

  const add = page.locator('form').filter({ hasText: 'Priced in' });
  await add.getByLabel('Name', { exact: true }).fill(name);
  await add.locator('select').nth(1).selectOption('INR');
  await add.locator('select').nth(2).selectOption('INR');
  await page.getByLabel(/Foreign asset for disclosure/).uncheck();
  await add.getByLabel('Quantity').fill('10');
  await add.getByLabel('Worth today').fill('12345.5');
  await add.getByLabel('Set aside for').selectOption({ label: "Child's savings" });
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

  await openList(page);
  await page.getByRole('button', { name: /^Add\b/ }).click();

  const add = page.locator('form').filter({ hasText: 'Priced in' });
  await add.getByLabel('Name', { exact: true }).fill(name);
  await add.locator('select').nth(1).selectOption('INR');
  await add.locator('select').nth(2).selectOption('INR');
  await page.getByLabel(/Foreign asset for disclosure/).uncheck();
  await add.getByLabel('Quantity').fill('3');
  await add.getByRole('button', { name: 'Add', exact: true }).click();

  try {
    await expect(await rowFor(page, name)).toContainText('not valued');
  } finally {
    await archiveByName(page, name);
  }
});

test('a running deposit offers its worked-out value as its first reading, and is valued once added', async ({ page }) => {
  test.setTimeout(90_000);
  const name = `e2e-add-fd-${Date.now()}`;

  const form = await openFixedForm(page);
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Principal').fill('100000');
  await form.getByLabel('Rate %', { exact: true }).fill('7.5');
  await form.getByLabel('Starts').fill('2026-01-01');
  await form.getByLabel('Matures').fill('2031-01-01');

  // Said before it is added, with the figure, and on unless somebody turns it off.
  const offer = form.getByLabel(/Record today.s value/);
  await expect(offer).toBeChecked();
  await form.getByLabel('Set aside for').selectOption({ label: 'Emergency fund' });
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
  const form = await openFixedForm(page);
  await form.getByLabel('Principal').fill('100000');
  await form.getByLabel('Rate %', { exact: true }).fill('7.5');
  await form.getByLabel('Starts').fill('2024-01-01');
  await form.getByLabel('Matures').fill('2025-01-01');

  // What it would be worth is a payout, money in an account and not a holding, so it is not recorded as one.
  await expect(form.getByLabel(/Record today.s value/)).toHaveCount(0);
});
