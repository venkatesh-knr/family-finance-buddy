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

const SCREENS = ['overview', 'money', 'holdings', 'tax', 'fire', 'profile', 'settings'] as const;

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

test('SL-I7 — a screen has at most one lifted surface, and Holdings has exactly one on every tab', async ({ page }) => {
  // docs/design/simple-layout.md section 1: one lifted surface per screen, the answer at the top; everything else is flat. Counted by
  // the class that draws it, and, as the existing check does, by the gradient that is its signature.
  test.setTimeout(150_000);
  const lifted = async () =>
    page.evaluate(() => ({
      byClass: document.querySelectorAll('.card-lift').length,
      byGradient: Array.from(document.querySelectorAll('*')).filter((el) => getComputedStyle(el).backgroundImage.includes('gradient') && el.getBoundingClientRect().height > 60).length,
    }));

  for (const screen of [...SCREENS, 'property', 'insurance', 'reports', 'more']) {
    await ready(page, screen);
    const found = await lifted();
    expect(found.byClass, `${screen} has ${String(found.byClass)} elements of the lifted class`).toBeLessThanOrEqual(1);
    expect(found.byGradient, `${screen} has ${String(found.byGradient)} gradient surfaces`).toBeLessThanOrEqual(1);
  }

  for (const hash of ['#/holdings', '#/holdings?kind=deposit', '#/holdings?kind=gold']) {
    await page.goto(`/${hash}`);
    await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('navigation', { name: 'Holdings by class' })).toBeVisible({ timeout: 20_000 });
    expect((await lifted()).byClass, `${hash} has one lifted surface`).toBe(1);
  }
});

/** What a panel is: the plain card and the two row groups that are drawn as one, and the lifted card, which is the one panel with an outline. */
const PANEL = '.card, .setgrp, .policy-card';

test('SL-I9 — no panel sits inside a panel, on every screen and every Holdings tab', async ({ page }) => {
  // docs/design/simple-layout.md section 1: a note or a group inside a panel is plain text or rows, never a second filled or outlined
  // box. Counted by the class that draws a panel, as SL-I7 counts the lift: no element with a panel's class has a descendant with one.
  test.setTimeout(150_000);
  const nested = async () =>
    page.evaluate((selector) => {
      const inside: string[] = [];
      for (const outer of Array.from(document.querySelectorAll(selector))) {
        for (const inner of Array.from(outer.querySelectorAll(selector))) {
          inside.push(`${inner.className} inside ${outer.className}`);
        }
      }
      return inside;
    }, PANEL);

  // The class check is the invariant's own test. The second is what a person means by it: no block of text, list or note inside a
  // panel, and no caveat line on the page, is filled or outlined on all four sides. Controls (pills, chips, switches, tiles, bars) are
  // not blocks of this kind, and a hairline between rows is one side only.
  const boxes = async () =>
    page.evaluate(() => {
      const found: string[] = [];
      const blocks = 'p, pre, code, ul, dl, details, .notice, .notice-names > li, .chart-note, .samplebar';
      for (const el of Array.from(document.querySelectorAll(blocks))) {
        // A panel is the one thing meant to be filled; it is the list or note inside one that is not.
        if (el.matches('.card, .setgrp, .policy-card')) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || el.getBoundingClientRect().height === 0) continue;
        const filled = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
        const outlined = ['Top', 'Right', 'Bottom', 'Left'].every((side) => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0);
        if (filled || outlined) found.push(`${el.tagName.toLowerCase()}.${String(el.className)}${filled ? ' filled' : ''}${outlined ? ' outlined' : ''}`);
      }
      return found;
    });

  const check = async (where: string) => {
    expect(await nested(), `${where} has a panel inside a panel`).toEqual([]);
    expect(await boxes(), `${where} has a filled or outlined box inside a panel, or on the page`).toEqual([]);
  };

  for (const screen of [...SCREENS, 'property', 'insurance', 'reports', 'more']) {
    await ready(page, screen);
    await check(screen);
  }
  for (const hash of ['#/holdings', '#/holdings?kind=deposit', '#/holdings?kind=gold']) {
    await page.goto(`/${hash}`);
    await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('navigation', { name: 'Holdings by class' })).toBeVisible({ timeout: 20_000 });
    await check(hash);
  }
});

for (const scheme of ['dark', 'light'] as const) {
  test(`SL-I7 — a soft panel has no outline and no shadow, and the lifted card keeps both — ${scheme}`, async ({ page }) => {
    // The panel is told from the page by its tone alone; the one lifted surface is the only thing with an outline and a shadow.
    test.setTimeout(150_000);
    await page.emulateMedia({ colorScheme: scheme });
    for (const screen of [...SCREENS, 'property', 'insurance', 'reports', 'more']) {
      await ready(page, screen);
      const found = await page.evaluate(() => {
        const look = (el: Element) => {
          const style = getComputedStyle(el);
          return { border: style.borderTopWidth, shadow: style.boxShadow, radius: style.borderTopLeftRadius };
        };
        return {
          panels: Array.from(document.querySelectorAll('.card:not(.card-lift), .setgrp, .policy-card')).map(look),
          lifted: Array.from(document.querySelectorAll('.card-lift')).map(look),
        };
      });
      for (const panel of found.panels) {
        expect(panel.border, `${screen}: a panel has an outline`).toBe('0px');
        expect(panel.shadow, `${screen}: a panel has a shadow`).toBe('none');
        expect(panel.radius, `${screen}: a panel's corners`).toBe('16px');
      }
      for (const lift of found.lifted) {
        expect(lift.border, `${screen}: the lifted card has lost its outline`).toBe('1px');
        expect(lift.shadow, `${screen}: the lifted card has lost its shadow`).not.toBe('none');
        expect(lift.radius, `${screen}: the lifted card's corners`).toBe('16px');
      }
    }
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
