import { test, expect, type Page } from '@playwright/test';

/**
 * The app at 200% text size, checked.
 *
 * `CLAUDE.md`: "Respect OS text size to 200%; no fixed-height container holds text." Until this spec
 * nothing verified either half (finding 21 in the UI review). The sizes are in rem, so doubling the root
 * font size is what a person who has set their device to 200% gets, and it is what this does.
 *
 * Two things that go wrong, and that can be told from the page without looking at it:
 *
 *   The page scrolls sideways. Something is wider than the screen once its text has doubled. A container
 *   that scrolls on purpose (a table in `.scroll-x`) is not the page, and does not count.
 *
 *   Text is cut off. An element that hides its overflow and whose content is taller than it is: a fixed
 *   height around text. Truncating a long name with an ellipsis is deliberate and is a width, so only the
 *   vertical is measured.
 *
 * Read-only: it opens each screen and reads the layout.
 */

const SCREENS = ['overview', 'expenses', 'holdings', 'tax', 'fire', 'profile', 'settings'] as const;

async function ready(page: Page, screen: string) {
  await page.goto(`/#${screen}`);
  await expect(page.getByRole('group', { name: 'Screen' }).first()).toBeVisible();
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('h2, h3').first()).toBeVisible({ timeout: 20_000 });
}

/** What is wrong with the page as laid out now. Run in the page, so it has no closure over anything here. */
const measure = (): { wide: number; cut: string[] } => {
  const wide = document.documentElement.scrollWidth - window.innerWidth;

  const describe = (el: Element): string => {
    const id = el.id === '' ? '' : `#${el.id}`;
    const cls =
      typeof el.className === 'string' && el.className.trim() !== ''
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  const cut: string[] = [];
  for (const el of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.overflowY !== 'hidden' && style.overflowY !== 'clip') continue;
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    // A visually hidden label is clipped on purpose, to a pixel.
    if (box.width <= 1 || box.height <= 1) continue;
    // SVG is a drawing, not text in a box.
    if (el instanceof SVGElement) continue;
    if (el.scrollHeight > el.clientHeight + 1 && (el.textContent ?? '').trim() !== '') {
      cut.push(`${describe(el)} is ${String(el.clientHeight)}px tall for ${String(el.scrollHeight)}px of content`);
    }
  }
  return { wide, cut };
};

for (const screen of SCREENS) {
  test(`${screen} at 200% text: the page does not scroll sideways and no text is cut off`, async ({ page }) => {
    await ready(page, screen);
    // After the screen is up: an init script runs before the document has a root to size. !important, so
    // it holds against a stylesheet that sets the root itself.
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    // Let layout settle after the size change, charts included.
    await page.waitForTimeout(800);

    const root = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(root, 'the root font size was doubled').toBeGreaterThanOrEqual(30);

    const report = await page.evaluate(measure);

    expect(
      report.wide,
      `the page is ${String(report.wide)}px wider than the screen at 200% text`,
    ).toBeLessThanOrEqual(1);
    expect(report.cut, 'text cut off by a fixed height').toEqual([]);
  });
}

test('the check sees what it claims to: a fixed-height box of text and an over-wide element are both found', async ({
  page,
}) => {
  await page.goto('/#settings');
  await expect(page.getByRole('group', { name: 'Screen' }).first()).toBeVisible();
  await page.evaluate(() => {
    const cut = document.createElement('div');
    cut.setAttribute('style', 'height:20px;overflow:hidden;width:200px');
    cut.textContent = 'text '.repeat(200);
    const wide = document.createElement('div');
    wide.setAttribute('style', 'width:5000px;height:4px');
    document.body.append(cut, wide);
  });
  const report = await page.evaluate(measure);
  expect(report.wide, 'an element 5000px wide is wider than the screen').toBeGreaterThan(100);
  expect(report.cut.length, 'a 20px box holding hundreds of words is cut off').toBeGreaterThan(0);
});
