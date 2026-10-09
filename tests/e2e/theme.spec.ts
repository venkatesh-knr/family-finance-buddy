import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * What the palette promises, checked.
 *
 * `docs/tokens.md` §1 and §2 make three claims that no other test touches and
 * that nobody verifies reliably by eye:
 *
 *   — contrast meets WCAG AA in BOTH themes;
 *   — one lifted surface per screen, and only one;
 *   — `--muted` is a neutral grey, not a blue-grey.
 *
 * Written before the palette landed, so it failed first. The light values are
 * darkened counterparts of the dark ones rather than the same hexes, which
 * means a light-theme contrast regression is the specific failure this change
 * risks — and the one a person working in dark mode will never see.
 *
 * Not tagged @screens: this is an assertion suite and belongs in the default
 * `npm run test:e2e` run.
 */

const SCREENS = ['overview', 'expenses', 'holdings', 'tax', 'fire', 'profile', 'settings'] as const;

/** The same settle the screenshot capture uses, and for the same reasons. */
async function ready(page: import('@playwright/test').Page, screen: string) {
  await page.goto(`/#${screen}`);
  await expect(page.getByRole('group', { name: 'Screen' }).first()).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('h2, h3').first()).toBeVisible({ timeout: 20_000 });
}

for (const scheme of ['dark', 'light'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const screen of SCREENS) {
      test(`${screen} — contrast`, async ({ page }) => {
        await ready(page, screen);

        // Colour-contrast only. The rest of axe's rule set is worth running
        // one day, but folding it in here would mean this spec fails for
        // reasons that have nothing to do with the palette, and a test that
        // fails for unrelated reasons is one people stop reading.
        const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();

        // Name the offending text in the failure. "3 violations" sends someone
        // hunting; "₹62.58 at 3.9:1" sends them to the token.
        const offenders = result.violations.flatMap((v) =>
          v.nodes.map((n) => `${n.target.join(' ')} — ${n.failureSummary?.split('\n').pop()?.trim()}`),
        );
        expect(offenders, `${screen}, ${scheme}:\n${offenders.join('\n')}`).toEqual([]);
      });
    }

    test(`one lifted surface per screen — ${scheme}`, async ({ page }) => {
      for (const screen of SCREENS) {
        await ready(page, screen);

        // §1: "One lifted surface per screen — a second one is two things
        // claiming to be the most important." A gradient background is the
        // signature; nothing else in the system uses one.
        const lifted = await page.evaluate(() =>
          Array.from(document.querySelectorAll('*')).filter((el) => {
            const bg = getComputedStyle(el).backgroundImage;
            return bg.includes('gradient') && el.getBoundingClientRect().height > 60;
          }).length,
        );

        expect(lifted, `${screen} has ${lifted} lifted surfaces`).toBeLessThanOrEqual(1);
      }
    });
  });
}

test('--muted is a neutral grey, not a blue-grey', async ({ page }) => {
  await ready(page, 'settings');

  // §1: it was #68758A and #8D9BAC, close enough to the link colour that
  // description lines on Settings and Tax read as pressable. A blue-grey has
  // a blue channel well above its red; a neutral grey does not. 24 is the
  // slack that lets a grey be faintly cool without reading as a link.
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const muted = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(),
    );

    const hex = muted.replace('#', '');
    expect(hex, `--muted is not a hex in ${scheme}: ${muted}`).toHaveLength(6);

    const r = parseInt(hex.slice(0, 2), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    expect(b - r, `--muted ${muted} is ${b - r} bluer than it is red, in ${scheme}`).toBeLessThanOrEqual(24);
  }
});
