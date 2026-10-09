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

  // Then the data. Wait for the placeholder to go rather than for a number of
  // milliseconds — the first version used a 600ms timer and photographed
  // Overview mid-load, which is a picture of nothing and worse than no
  // picture, because it looks like a finding.
  //
  // Both words. Six screens say `Loading…`; Profile says `Reading…`. The
  // second version of this watched only for the first, photographed Profile
  // mid-load, and I filed a stuck-screen defect against a screen that loads
  // perfectly well. Twice now the capture's own impatience has looked like a
  // bug in the app, which is the hazard of judging a screen from a picture.
  //
  // A generous timeout: this runs against a live Supabase in Mumbai.
  //
  // The beat before it is not padding. Waiting for a placeholder to be ABSENT
  // passes trivially while it is still absent — before the cards have mounted
  // — so the third version of this walked straight past the check and
  // photographed Profile mid-load anyway. Let the placeholders appear, then
  // wait for them to go.
  await page.waitForTimeout(400);
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });

  // And confirm something real arrived, rather than trusting an absence: every
  // screen renders at least one card heading once it has data.
  await expect(page.locator('h2, h3').first()).toBeVisible({ timeout: 20_000 });

  // A beat for fonts, chart geometry and layout to settle once the data is in.
  await page.waitForTimeout(250);

  // Two shots, because neither alone is honest.
  //
  // fullPage captures everything below the fold, which is what you want for
  // reading a screen's content — but it renders `position: fixed` elements at
  // their viewport position, so the phone's bottom bar lands in the middle of
  // the image with content continuing past it. That looks exactly like a
  // layout defect and is not one.
  //
  // The viewport shot is the opposite: the chrome sits where a person sees it,
  // and anything below the fold is gone. Judge layout from `-top`, judge
  // content from the other, and do not report the bar's position from either.
  await page.screenshot({ path: `${dir}/${screen}.png`, fullPage: true });
  await page.screenshot({ path: `${dir}/${screen}-top.png`, fullPage: false });
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
