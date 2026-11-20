import { test, expect, type Page } from '@playwright/test';

/**
 * The mint tray at the foot of the Holdings summary card (docs/tokens.md section 1, Depth; docs/drafts/linen-light-theme.md; the owner, 20 November 2026). The class colours cannot be read
 * on the forest, so the strip and its legend sit on a tray that the forest fades into. Read-only: nothing here writes.
 */

async function onHoldings(page: Page) {
  await page.goto('/#/holdings');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('class-shares')).toBeVisible({ timeout: 20_000 });
}

test('in Linen the strip and its legend sit on the mint tray, below a fade that holds nothing', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await onHoldings(page);
  const card = page.locator('section.card-lift').filter({ has: page.getByTestId('class-shares') });
  const tray = card.locator('.lift-tray');
  const fade = card.locator('.lift-tray-fade');

  await expect(tray).toHaveCSS('background-color', 'rgb(228, 241, 232)');
  await expect(fade).toHaveAttribute('aria-hidden', 'true');
  await expect(fade).toHaveCSS('height', '32px');
  expect(await fade.evaluate((element) => element.childElementCount + (element.textContent ?? '').length)).toBe(0);

  // It spans the card edge to edge, at its foot, and the strip and legend are inside it, below the fade.
  const [cardBox, trayBox, fadeBox, stripBox] = await Promise.all([card.boundingBox(), tray.boundingBox(), fade.boundingBox(), page.getByTestId('class-shares').boundingBox()]);
  expect(Math.abs((trayBox?.x ?? 0) - ((cardBox?.x ?? 0) + 1))).toBeLessThanOrEqual(1);
  expect(Math.abs((trayBox?.width ?? 0) - ((cardBox?.width ?? 0) - 2))).toBeLessThanOrEqual(1);
  expect((fadeBox?.y ?? 0) + (fadeBox?.height ?? 0)).toBeLessThanOrEqual((trayBox?.y ?? 0) + 1);
  expect(stripBox?.y ?? 0).toBeGreaterThanOrEqual(trayBox?.y ?? 0);
  expect((stripBox?.y ?? 0) + (stripBox?.height ?? 0)).toBeLessThanOrEqual((trayBox?.y ?? 0) + (trayBox?.height ?? 0));

  // The page's inks are back inside it: the legend is dark on mint, not cream.
  const legend = tray.locator('.class-legend');
  const colour = await legend.evaluate((element) => getComputedStyle(element).color);
  const [r, g, b] = (colour.match(/\d+/g) ?? []).map(Number) as [number, number, number];
  expect(r + g + b).toBeLessThan(300);
});

test('in dark the tray takes no room and draws nothing, so the screen is as it was', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await onHoldings(page);
  const card = page.locator('section.card-lift').filter({ has: page.getByTestId('class-shares') });
  await expect(card.locator('.lift-tray-fade')).toBeHidden();
  const tray = card.locator('.lift-tray');
  await expect(tray).toHaveCSS('padding-top', '0px');
  await expect(tray).toHaveCSS('padding-left', '0px');
  await expect(tray).toHaveCSS('margin-left', '0px');
  await expect(tray).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('at 200% text the legend wraps inside the tray', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await onHoldings(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const tray = page.locator('.lift-tray');
  const items = tray.locator('.class-legend li');
  const count = await items.count();
  expect(count).toBeGreaterThan(1);
  const trayBox = await tray.boundingBox();
  for (let at = 0; at < count; at += 1) {
    const box = await items.nth(at).boundingBox();
    expect(box?.x ?? 0).toBeGreaterThanOrEqual((trayBox?.x ?? 0) - 1);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((trayBox?.x ?? 0) + (trayBox?.width ?? 0) + 1);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((trayBox?.y ?? 0) + (trayBox?.height ?? 0) + 1);
  }
});
