import { test, expect, type Page } from '@playwright/test';

/**
 * More, and the bar on the screens behind it (docs/design/vibrant-canvas.html, More, Tax, Insurance, Profile,
 * Settings): each row a tile, a name, a line of what is true now and, where there is something to do, a pill; and
 * on a phone each screen below it opens with "‹ More", its name and the privacy switch.
 *
 * Read-only: nothing here writes.
 */

async function onMore(page: Page) {
  await page.goto('/#more');
  await expect(page.getByRole('navigation', { name: 'More' })).toBeVisible({ timeout: 20_000 });
}

test('each place behind More is one link with a name and a line saying what is true now', async ({ page }) => {
  await onMore(page);
  const rows = page.getByRole('navigation', { name: 'More' }).getByRole('link');
  await expect(rows).toHaveCount(4);
  for (const [name, line] of [
    ['Tax', /\d{4}–\d{2}|gains and income/],
    ['Insurance', /polic|Policies/],
    ['Profile', /two-step sign-in on/],
    ['Settings', /Theme, how amounts show, members/],
  ] as const) {
    const row = rows.filter({ hasText: new RegExp(`^${name}`) });
    await expect(row, `a row for ${name}`).toHaveCount(1);
    await expect(row).toContainText(line, { timeout: 20_000 });
  }
});

test('a row opens its screen, and on a phone the screen has a bar with its name and a way back to More', async ({
  page,
}, testInfo) => {
  await onMore(page);
  await page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: /^Settings/ }).click();
  await expect(page).toHaveURL((url) => /settings/.test(url.hash));

  const phone = (page.viewportSize()?.width ?? 1000) < 640;
  test.skip(!phone, `the bar is a phone's; ${testInfo.project.name} keeps the full header`);

  const bar = page.locator('.screen-bar');
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // The demo badge stays: a screen of fake money is never read as real because the bar changed.
  await expect(bar.getByText(/^demo$/i)).toBeVisible();
  // The boards draw the privacy switch on Tax and Insurance, where there are amounts, and not on Profile or Settings.
  await expect(bar.getByRole('button', { name: /Amounts (shown|hidden)/ })).toHaveCount(0);

  await bar.getByRole('button', { name: 'More' }).click();
  await expect(page).toHaveURL((url) => /more/.test(url.hash));
  await expect(page.getByRole('navigation', { name: 'More' })).toBeVisible();
});

test('the bar on Tax carries the privacy switch', async ({ page }, testInfo) => {
  const phone = (page.viewportSize()?.width ?? 1000) < 640;
  test.skip(!phone, `the bar is a phone's; ${testInfo.project.name} keeps the full header`);
  await page.goto('/#tax');
  await expect(page.locator('.screen-bar').getByRole('button', { name: /Amounts (shown|hidden)/ })).toBeVisible();
});

test('the line under Tax states a figure only when nothing was left out of it', async ({ page }) => {
  await onMore(page);
  const tax = page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: /^Tax/ });
  // Whatever it says, it is one of the three things it may say; never a bare figure beside a sale it did not count.
  await expect(tax).toContainText(/tax on gains|sales? not counted|working is on the Tax screen/, { timeout: 20_000 });
  const text = await tax.innerText();
  if (/not counted/.test(text)) expect(text).not.toMatch(/allowance unused|tax on gains/);
});

test('with amounts hidden, the figures on More are out of the document', async ({ page }) => {
  await onMore(page);
  const tax = page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: /^Tax/ });
  await expect(tax).toContainText(/tax on gains|not counted|working is on the Tax screen/, { timeout: 20_000 });
  await page.getByRole('button', { name: /Amounts shown/ }).click();
  // The year is a date and stays; no amount is left in the row, in the line or in the pill.
  const text = (await tax.innerText()).replace(/\d{4}–\d{2}/, '');
  expect(text).not.toMatch(/\d/);
});
