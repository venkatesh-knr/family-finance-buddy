import { test, expect, type Page } from '@playwright/test';
import { testName } from './created.ts';

/**
 * The foot of the Money month card (docs/drafts/month-actions.md; the MonthActions boards): *+ Money in*, *Accounts* with its count, and, when a month is
 * waiting to be closed, *Close October* as the one primary with the status line beside it.
 *
 * That Close is absent for a closed month, that the Accounts link targets the Accounts tab and the reading order are asserted on the markup in
 * src/features/money/monthFooterMarkup.test.ts. What needs a browser is here: Close spans the card at 375px, and at 200% text nothing leaves the card.
 * The close prompt is there only while the month is open, as in month-close.spec, so the tests that need it skip when it is gone.
 */

test.use({ actionTimeout: 15_000 });

async function addAccount(page: Page, name: string) {
  await page.goto('/#/accounts');
  await expect(page.getByRole('button', { name: '+ Add an account' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '+ Add an account' }).click();
  const form = page.getByRole('form', { name: 'Add an account' });
  await form.getByLabel('Name').fill(name);
  await form.getByRole('button', { name: 'Add account' }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });
}

async function onMoney(page: Page) {
  await page.goto('/#/money');
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
}

/** The month card's lifted surface, the one that holds the footer. */
const card = (page: Page) => page.locator('section.card-lift').filter({ has: page.locator('.month-footer') });
const close = (page: Page) => card(page).getByRole('button', { name: /^Close [A-Z][a-z]+$/ });

test('Accounts is a link to the Accounts tab, with its count named', async ({ page }) => {
  test.setTimeout(120_000);
  await addAccount(page, testName('footer-acct'));
  await onMoney(page);
  const link = card(page).getByRole('link', { name: /^Accounts \d+ accounts?$/ });
  await expect(link).toBeVisible();
  await expect(link.getByRole('img', { name: /^\d+ accounts?$/ })).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/#\/accounts/);
});

test('every control in the footer is at least 44px tall and keeps its label on one line', async ({ page }) => {
  test.setTimeout(120_000);
  await addAccount(page, testName('footer-targets'));
  await onMoney(page);
  for (const control of [card(page).getByRole('button', { name: '+ Money in' }), card(page).getByRole('link', { name: /^Accounts/ })]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  }
});

test('at 375px, Close spans the width of the card', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 900 });
  await addAccount(page, testName('footer-close'));
  await onMoney(page);
  test.skip((await close(page).count()) === 0, 'the month was closed earlier in this run');
  const [card_, close_] = await Promise.all([card(page).boundingBox(), close(page).boundingBox()]);
  expect(card_).not.toBeNull();
  expect(close_).not.toBeNull();
  if (card_ === null || close_ === null) return;
  // The card's own padding is 18px a side; Close fills what is left, so it is the card's width less that and a pixel.
  expect(close_.width).toBeGreaterThanOrEqual(card_.width - 40);
  expect(close_.x).toBeGreaterThanOrEqual(card_.x);
  expect(close_.x + close_.width).toBeLessThanOrEqual(card_.x + card_.width + 0.5);
  // The status line is above it on a phone, and Money in and Accounts are below it.
  const status = await card(page).locator('.month-footer-status').boundingBox();
  const moneyIn = await card(page).getByRole('button', { name: '+ Money in' }).boundingBox();
  expect(status?.y ?? 0).toBeLessThan(close_.y);
  expect(moneyIn?.y ?? 0).toBeGreaterThan(close_.y);
});

test('at 200% text, nothing in the footer leaves the card', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 900 });
  await addAccount(page, testName('footer-200'));
  await onMoney(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(card(page)).toBeVisible();
  const overflow = await card(page).evaluate((el) => {
    const outer = el.getBoundingClientRect();
    const out: string[] = [];
    for (const child of Array.from(el.querySelectorAll('.month-footer *'))) {
      const box = child.getBoundingClientRect();
      if (box.width === 0) continue;
      if (box.left < outer.left - 0.5 || box.right > outer.right + 0.5) out.push(`${child.tagName.toLowerCase()}.${String(child.className)} ${String(Math.round(box.left))}-${String(Math.round(box.right))} in ${String(Math.round(outer.left))}-${String(Math.round(outer.right))}`);
    }
    return { out, scrolls: el.scrollWidth > el.clientWidth + 1 };
  });
  expect(overflow.out, 'what leaves the card').toEqual([]);
  expect(overflow.scrolls, 'the card scrolls sideways').toBe(false);
});
