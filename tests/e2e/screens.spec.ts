import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Screenshots of every screen, at both widths, in both themes.
 *
 * This spec asserts almost nothing. Its output is the point: a folder of PNGs
 * that a person — or the `design-conformance` subagent, whose Read tool renders
 * images — can look at.
 *
 * Why it exists. Everything else in this suite proves behaviour, and behaviour
 * is not what was wrong with this app. The ten findings in
 * `docs/design/ui-review.md` were all things you could only see: three hero
 * figures competing, a caveat marker that reads as a loss, a control wrapping
 * onto its own line at 375px. No assertion would have caught one of them.
 * Reasoning about hierarchy from CSS is how you get confident and wrong.
 *
 * Both themes, because `docs/tokens.md` warns that a colour declared only
 * inside a media or `[data-theme]` block is "the classic unreadable-in-the-
 * other-theme bug", and the only way to find one is to look at both.
 *
 * Not part of `npm run test:e2e` — it is tagged @screens and the default run
 * excludes it. Run it when you want to look: `npm run test:screens`.
 */

const SCREENS = ['overview', 'expenses', 'holdings', 'tax', 'fire', 'profile', 'settings'] as const;

async function capture(page: import('@playwright/test').Page, screen: string, theme: string) {
  const project = test.info().project.name.replace('screens-', '');
  const dir = `screenshots/${theme}/${project}`;
  mkdirSync(dir, { recursive: true });

  await page.goto(`/#${screen}`);

  // The shell, not the network: a screenshot taken before the chrome renders is
  // a picture of nothing, and networkidle is a worse signal than the thing you
  // actually want on screen.
  await expect(page.getByRole('group', { name: 'Screen' }).first()).toBeVisible();

  // Then the data. Every screen that queries renders `Loading…` first, so wait
  // for that to go rather than for a number of milliseconds — the first version
  // of this used a 600ms timer and photographed Overview mid-load, which is a
  // picture of nothing and worse than no picture, because it looks like a
  // finding. A generous timeout: this runs against a live Supabase in Mumbai.
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20_000 });

  // A beat for fonts, chart geometry and layout to settle once the data is in.
  await page.waitForTimeout(250);

  await page.screenshot({ path: `${dir}/${screen}.png`, fullPage: true });
}

test.describe('@screens dark', () => {
  test.use({ colorScheme: 'dark' });
  for (const screen of SCREENS) {
    test(`${screen} — dark`, async ({ page }) => {
      await capture(page, screen, 'dark');
    });
  }
});

test.describe('@screens light', () => {
  test.use({ colorScheme: 'light' });
  for (const screen of SCREENS) {
    test(`${screen} — light`, async ({ page }) => {
      await capture(page, screen, 'light');
    });
  }
});
