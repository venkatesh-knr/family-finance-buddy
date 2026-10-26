import { test, expect } from '@playwright/test';

/**
 * An allocation row on the Overview is one link to Holdings filtered to its class (docs/design/holdings.md, HD-I4).
 *
 * The whole row is the link, not an underlined word in it: pressing anywhere on the row goes, the row's name is
 * plain, and the filter is in the URL so Back undoes it. Read-only: nothing here writes.
 */

async function onOverview(page: import('@playwright/test').Page) {
  await page.goto('/#overview');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.alloc-row').first()).toBeVisible({ timeout: 20_000 });
}

test('each allocation row has exactly one link, to its class, and the name is not underlined', async ({ page }) => {
  await onOverview(page);
  const rows = page.locator('.alloc-row');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const links = rows.nth(i).locator('a');
    await expect(links, `row ${String(i + 1)} has one link`).toHaveCount(1);
    await expect(links.first()).toHaveAttribute('href', /^#\/holdings\?kind=[a-z_]+$/);
  }
  const decoration = await rows.first().locator('a.alloc-link').evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(decoration).toBe('none');
});

test('pressing anywhere on a row opens Holdings filtered to its class, and Back undoes it', async ({ page }) => {
  await onOverview(page);
  const row = page.locator('.alloc-row').first();
  // A press by coordinates reaches only what is on the screen: bring the row into view first, to the middle of it, since at
  // the bottom edge on a phone it is behind the fixed bar and the press lands on a tab.
  await row.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
  });
  const href = await row.locator('a').first().getAttribute('href');
  const kind = /kind=([a-z_]+)/.exec(href ?? '')?.[1];
  expect(kind).toBeTruthy();

  // Not on the name: well to the right of it, where only a stretched link would catch the press.
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) * 0.55, (box?.y ?? 0) + (box?.height ?? 0) * 0.5);

  await expect(page).toHaveURL((url) => url.hash.startsWith(`#/holdings?kind=${kind ?? ''}`));
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  // The class's chip is the one pressed, and the list is only that class.
  await expect(page.locator('.chips a[aria-current="true"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('.chips a[aria-current="true"]')).not.toHaveText(/^All/);

  await page.goBack();
  // The hash the page was opened with, with or without the slash the shell writes.
  await expect(page).toHaveURL((url) => /^#\/?overview$/.test(url.hash));
});
