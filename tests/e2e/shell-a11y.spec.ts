import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

/**
 * The app's navigation has nothing axe can find, at the phone's width and the desktop's, and a phone has a navigation
 * landmark.
 *
 * The bottom bar was a `nav` carrying `role="group"`, which a nav may not have (axe: aria-allowed-role). The role replaced
 * the landmark, so a screen reader on a phone found no navigation region at all, and `theme.spec.ts` runs axe's colour
 * contrast rule alone and so never saw it. This runs the whole rule set over the header and the navigation.
 */

test('the navigation passes every axe rule, and a phone has a navigation landmark', async ({ page }) => {
  await page.goto('/#/expenses');
  await expect(page.getByRole('group', { name: 'Screen' }).first()).toBeVisible({ timeout: 20_000 });

  const phone = (page.viewportSize()?.width ?? 1000) < 640;
  if (phone) {
    // The bar is a landmark, and the group inside it holds the five places.
    const bar = page.getByRole('navigation', { name: 'Screens' });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('group', { name: 'Screen' }).getByRole('button')).toHaveCount(5);
  }

  const result = await new AxeBuilder({ page }).include('header').include('nav').analyze();
  const summary = result.violations.map((v) => `${v.id}: ${v.nodes.length} · ${v.nodes[0]?.html.slice(0, 120) ?? ''}`);
  expect(result.violations.length, summary.join('\n')).toBe(0);
});
