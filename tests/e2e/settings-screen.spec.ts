import { test, expect, type Page } from '@playwright/test';

/**
 * Settings as its artboard draws it (docs/design/vibrant-canvas.html, Settings): this device, this household,
 * members, and the reset, each a plain row. Read-only except for the device switch, which it puts back, and the
 * reset, which it opens and does not confirm.
 */

async function onSettings(page: Page) {
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: 'This device' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
}

test('this device: a theme control, a switch for hiding amounts, and a row that opens the currency choice', async ({
  page,
}) => {
  await onSettings(page);
  await expect(page.getByRole('group', { name: 'Colour theme' }).getByRole('button')).toHaveCount(3);

  const hide = page.getByRole('switch', { name: 'Hide amounts when the app opens' });
  const was = await hide.getAttribute('aria-checked');
  await hide.click();
  await expect(hide).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
  await hide.click();
  await expect(hide).toHaveAttribute('aria-checked', was ?? 'false');

  const currency = page.getByRole('combobox', { name: 'Read amounts in' });
  await expect(currency.locator('option').first()).toHaveText('INR');
});

test('this household: its name with the demo badge, the base currency and where the tax year starts', async ({
  page,
}) => {
  await onSettings(page);
  const group = page.getByRole('heading', { name: 'This household' }).locator('xpath=../following-sibling::div[1]');
  await expect(group).toContainText('Name');
  await expect(group.getByText(/^demo$/i)).toBeVisible();
  await expect(group).toContainText('Base currency');
  await expect(group).toContainText('Tax year starts');
  await expect(group).toContainText('1 April');
  // What used to sit under every row, and a Kind row the badge already says, are gone.
  await expect(page.getByText('Kind', { exact: true })).toHaveCount(0);
});

test('members: a row each with the role at the right, an Invite button, and the rest folded', async ({ page }) => {
  await onSettings(page);
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  await expect(page.getByText('· you')).toBeVisible();

  const invite = page.getByRole('button', { name: 'Invite' });
  await expect(invite).toHaveAttribute('aria-expanded', 'false');
  await invite.click();
  await expect(page.getByRole('heading', { name: 'Invite someone' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Invite someone' })).toHaveCount(0);

  const fold = page.getByRole('button', { name: /former member/ });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('· former')).toBeVisible();
});

test('data: the reset is one row; opening it asks first and changes nothing until it is confirmed', async ({ page }) => {
  await onSettings(page);
  const row = page.getByRole('button', { name: /Reset the demo household/ });
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await row.click();
  await expect(page.getByRole('button', { name: 'Yes, wipe and reseed it' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep it as it is' }).click();
  await expect(page.getByRole('button', { name: 'Yes, wipe and reseed it' })).toHaveCount(0);
});

test('the placeholder cards are gone', async ({ page }) => {
  await onSettings(page);
  await expect(page.getByText('Spending plan', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Not here yet', { exact: true })).toHaveCount(0);
});
