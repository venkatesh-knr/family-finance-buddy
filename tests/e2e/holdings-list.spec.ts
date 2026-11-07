import { test, expect, type Page } from '@playwright/test';
import { next } from './fields.ts';

/**
 * The Holdings list and a holding's own screen (docs/design/holdings.md), as tabs (docs/design/simple-layout.md section 2).
 * Read-only: nothing here writes.
 *
 * HD-I1 to HD-I6, each named in a title so `check:invariants` counts them. The arithmetic behind HD-I2 is a unit
 * test (`holdingGroups.test.ts`), where the figures are exact; the compact figures on a screen are not.
 *
 * All is the whole picture (the total, one row per class, what is set aside) and has no holding rows; a class tab is that class's
 * holdings. So the tests that read a row go to a class tab, and the ones about the strip go to All.
 */

async function onHoldings(page: Page, hash = '#/holdings') {
  await page.goto(`/${hash}`);
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'Holdings by class' })).toBeVisible({ timeout: 20_000 });
}

/** A class tab with holdings on it, ready to be read. */
async function onClass(page: Page, kind: string) {
  await onHoldings(page, `#/holdings?kind=${kind}`);
  await expect(page.locator('.holding-row').first()).toBeVisible({ timeout: 20_000 });
}

const currentTab = (page: Page) => page.locator('nav[aria-label="Holdings by class"] [aria-current="page"]');

test('HD-I5 — exactly one control named Add on the list, named for the tab, and no per-row purchase or sale', async ({ page }) => {
  await onHoldings(page);
  await expect(page.getByRole('button', { name: /^Add\b/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add a holding', exact: true })).toBeVisible();
  await onClass(page, 'mutual_fund');
  await expect(page.getByRole('button', { name: /^Add\b/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /purchase or sale/i })).toHaveCount(0);
});

test('HD-I4 — the filter is in the URL: only deposits, the tab current, and Back returns to All', async ({ page }) => {
  await onHoldings(page);
  await expect(page.locator('.holding-row')).toHaveCount(0);

  await onClass(page, 'deposit');
  expect(await page.locator('.holding-row').count()).toBeGreaterThan(0);
  await expect(currentTab(page)).toHaveText('Deposits');
  await expect(page.getByRole('link', { name: 'All', exact: true })).not.toHaveAttribute('aria-current', 'page');
  // The summary card describes the filter, and the Add names the class.
  await expect(page.getByRole('button', { name: 'Add a deposit' })).toBeVisible();

  await page.goBack();
  await expect(currentTab(page)).toHaveText('All', { timeout: 20_000 });
});

test('HD-I3 — a holding whose return is refused keeps its mark and its reason on the row', async ({ page }) => {
  await onClass(page, 'mutual_fund');
  const refused = page.locator('.holding-row').filter({ hasText: /return not shown|no cost recorded/ });
  // The demo household has positions resting on a partial statement; if it has none, say so and not pass.
  expect(await refused.count(), 'a row with a refused return in the demo household').toBeGreaterThan(0);
  await expect(refused.first().getByRole('button', { name: /Why there is no/ })).toBeVisible();
});

test('HD-I1 — a row shows the latest recorded reading, and the holding opens on the same figure', async ({ page }) => {
  await onClass(page, 'mutual_fund');
  const row = page.locator('.holding-row').filter({ has: page.locator('.holding-value') }).first();
  const rowText = (await row.locator('.holding-value').innerText()).replace(/\s+/g, '');
  await row.locator('a.holding-link').click();
  await expect(page.getByTestId('detail-value')).toBeVisible({ timeout: 20_000 });
  const detail = (await page.getByTestId('detail-value').innerText()).replace(/\s+/g, '');
  // The list is compact and the holding's screen is the figure in full (the board draws it so): two views, one answer
  // to "what is this worth", so the compact figure is the full one rounded to its three significant digits.
  const units: Record<string, number> = { Cr: 1e7, L: 1e5, K: 1e3, M: 1e6, B: 1e9, '': 1 };
  const asNumber = (text: string): number => {
    const m = /^[₹$]([\d,]+(?:\.\d+)?)(Cr|L|K|M|B)?$/.exec(text);
    if (m === null) throw new Error(`not a figure: ${text}`);
    return Number((m[1] ?? '0').replace(/,/g, '')) * (units[m[2] ?? ''] ?? 1);
  };
  const compact = asNumber(rowText);
  const full = asNumber(detail);
  expect(Math.abs(full - compact) / Math.max(full, 1), `the list says ${rowText} and the holding ${detail}`).toBeLessThan(0.006);
});

test('HD-I6 — a deposit opens on its terms, with no units, purchases or realised figure', async ({ page }) => {
  await onClass(page, 'deposit');
  // The largest is first, and a deposit entered before there were terms has none to show: open one that has.
  await page.locator('.holding-row').filter({ hasText: /matures/ }).first().locator('a.holding-link').click();
  await expect(page.getByTestId('term-progress')).toBeVisible({ timeout: 20_000 });
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\bunits?\b/i);
  expect(text).not.toMatch(/purchase/i);
  expect(text).not.toMatch(/realised/i);
  // Archive is a visible button, named for the holding.
  await expect(page.getByRole('button', { name: /^Archive\b/ })).toBeVisible();
});

test('a fund opens on units, cost and its transactions, and Back returns to the list', async ({ page }) => {
  await onClass(page, 'mutual_fund');
  await page.locator('.holding-row').first().locator('a.holding-link').click();
  await expect(page.getByText(/units/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /Holdings$/ }).first()).toBeVisible();
  await page.goBack();
  await expect(page.locator('.holding-row').first()).toBeVisible({ timeout: 20_000 });
});

test('a row is compact: about a glance, and a screen of eight holdings is not seven', async ({ page }) => {
  await onClass(page, 'deposit');
  const first = await page.locator('.holding-row').first().boundingBox();
  // A row is a glance, not a card: about a hundred pixels. Measured at 412px on the seeded household, the first row
  // (a deposit whose terms wrap to a second line, under an earmark pill) is 103px; a fund's is under 96. 112 is room
  // for one wrapped line and a pill, and well under the 150px or more that inline detail cost.
  expect(first?.height ?? 999).toBeLessThan(112);
  const viewport = page.viewportSize()?.height ?? 800;
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  // Eight holdings took about 6.7 phone screens of inline detail; the list is a handful.
  expect(total / viewport).toBeLessThan(5);
});

test('a filtered summary describes the filter: its share of the portfolio, and none of another class\'s caveat', async ({
  page,
}) => {
  await onClass(page, 'deposit');
  const summary = page.locator('section.card-lift');
  // Its share, and of what: "70.2% of ₹15.98L", the portfolio the class is a part of.
  await expect(page.getByTestId('filter-share')).toContainText(/\d+\.\d% of [₹$]/);
  // The partial-statement positions are mutual funds: they are not the deposits' to carry.
  await expect(summary).not.toContainText('return not shown');
  const share = Number(/(\d+\.\d)%/.exec(await page.getByTestId('filter-share').innerText())?.[1] ?? '100');
  expect(share, 'deposits are a part of the portfolio and not all of it').toBeLessThan(100);
});

test('HD-I6 — a deposit shows what was lent, and a bond filter opens Add as a bond', async ({ page }) => {
  await onClass(page, 'deposit');
  // The largest is first, and a deposit entered before there were terms has none to show: open one that has.
  await page.locator('.holding-row').filter({ hasText: /matures/ }).first().locator('a.holding-link').click();
  await expect(page.getByTestId('term-progress')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('main').getByText('Principal', { exact: true })).toBeVisible();

  await onHoldings(page, '#/holdings?kind=bond');
  await page.getByRole('button', { name: 'Add a bond' }).click();
  // The form opens as a bond: the Bond tab is the one pressed, and its figures come on the next step.
  await expect(page.getByRole('button', { name: 'Bond', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Name', { exact: true }).fill('e2e-never-added');
  await next(page);
  await expect(page.getByLabel('Face value')).toBeVisible();
});

test('the tabs are one row that scrolls sideways: All, then the classes held, and no earmark among them', async ({ page }) => {
  await onHoldings(page);
  const strip = page.locator('nav[aria-label="Holdings by class"]');
  const box = await strip.evaluate((el) => ({ scrolls: el.scrollWidth > el.clientWidth, wraps: getComputedStyle(el).flexWrap }));
  expect(box.wraps, 'one row, not several').toBe('nowrap');
  // The first is All, and the classes follow; the earmarks are rows of All's Set aside, never tabs.
  const names = await strip.getByRole('link').allInnerTexts();
  expect(names[0]).toBe('All');
  expect(names.length).toBeGreaterThan(1);
  expect(names.join(' ')).not.toMatch(/Emergency fund|Child.s savings|House deposit/);
  // The page does not scroll sideways because of it.
  const page_ = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(page_).toBe(true);
  void box.scrolls;
});

test('All has a row for each class with a chevron, and a class’s sort puts the largest first or goes A to Z', async ({ page }) => {
  await onHoldings(page);
  const rows = page.getByTestId('by-class').getByRole('link');
  expect(await rows.count()).toBeGreaterThan(1);
  await expect(rows.first().locator('.flat-row-chevron')).toBeVisible();

  await onClass(page, 'deposit');
  const sort = page.getByRole('button', { name: /Sorted largest first/ });
  await expect(sort).toBeVisible();
  const names = async () => page.locator('.holding-row .holding-name').allInnerTexts();
  const largest = await names();
  await sort.click();
  await expect(page.getByRole('button', { name: /Sorted by name/ })).toBeVisible();
  const byName = await names();
  expect(new Set(byName)).toEqual(new Set(largest));
  // A to Z: the rows against their own sorted copy.
  expect(byName.every((name, i) => i === 0 || (byName[i - 1] ?? '').localeCompare(name) <= 0), 'rows A to Z').toBe(true);
});

test('a row has what the money is for beside its name, a figure in full, and units with separators', async ({ page }) => {
  await onClass(page, 'deposit');
  const earmarked = page.locator('.holding-row').filter({ has: page.locator('.holding-title .pill') }).first();
  if ((await earmarked.count()) > 0) {
    // On the name's own line, not under the row.
    const name = await earmarked.locator('.holding-name').boundingBox();
    const pill = await earmarked.locator('.holding-title .pill').boundingBox();
    expect(Math.abs((name?.y ?? 0) - (pill?.y ?? 999)), 'the pill is on the name\'s line').toBeLessThan(12);
  }
  // Figures are whole (₹3,00,000), not compact (₹3 L), and a quantity of a thousand or more has its separator.
  const values = await page.locator('.holding-value').allInnerTexts();
  for (const v of values) expect(v.replace(/\s+/g, ''), `a row's figure is in full: ${v}`).toMatch(/\d,\d|\d{1,3}$|none|not/i);
  const units = (await page.locator('.holding-sub').allInnerTexts()).join(' ');
  expect(units).not.toMatch(/\b\d{4,},?\d* units/);
});

test('the price fetch is an icon on the summary, Import is at the top, and the one Add floats named for the tab', async ({ page }) => {
  await onHoldings(page);
  await expect(page.getByRole('button', { name: 'Fetch prices' })).toBeVisible();
  const top = page.locator('.holdings-top');
  await expect(top.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
  await expect(page.locator('.floating-add')).toHaveCount(1);
  await expect(page.locator('.floating-add')).toHaveText(/Add a holding/);
  // The sort belongs to a class's list, where there are rows to sort.
  await expect(page.getByRole('button', { name: /Sorted/ })).toHaveCount(0);
  await onClass(page, 'deposit');
  await expect(page.getByRole('button', { name: /Sorted/ })).toBeVisible();
});

test('filtered to deposits: the tabs come first, the summary has the interest and what matures, and the emergency fund is under the list', async ({
  page,
}) => {
  await onClass(page, 'deposit');
  const order = await page.evaluate(() => {
    const tabs = document.querySelector('nav[aria-label="Holdings by class"]')?.getBoundingClientRect().top ?? 0;
    const summary = document.querySelector('section.card-lift')?.getBoundingClientRect().top ?? 0;
    return { tabs, summary };
  });
  expect(order.tabs, 'the tabs are above the summary').toBeLessThan(order.summary);

  const summary = page.locator('section.card-lift');
  await expect(summary.getByText('Interest so far')).toBeVisible();
  await expect(summary.getByText('Next to mature')).toBeVisible();
  await expect(page.getByTestId('worked-out-note')).toContainText(/Worked out today.*Not in net worth until it is recorded/);
  await expect(page.getByText('FD, RD, SSY, NSC, KVP, SCSS and post office deposits all live here. A PPF is under Retirement.')).toBeVisible();
  const card = page.getByTestId('emergency-card');
  if ((await card.count()) > 0) await expect(card).toContainText(/earmarked/);
});

test('on deposits, the worked-out figures say which deposits they cover, and the summary keeps its caveat about the totals', async ({
  page,
}) => {
  await onClass(page, 'deposit');
  const summary = page.locator('section.card-lift');
  // The warning about how the totals are put together does not go quiet on a narrower view of the same figure.
  await expect(summary.getByRole('button', { name: 'How these totals are put together' })).toBeVisible();

  // A deposit entered before there were terms has none to work out, so the figures say how many they cover.
  const withoutTerms = await page.locator('.holding-row').filter({ hasText: 'terms not recorded' }).count();
  if (withoutTerms > 0) {
    await expect(summary.getByRole('button', { name: 'Which deposits these figures cover' })).toBeVisible();
    await expect(page.getByTestId('worked-out-note')).toContainText(/for the \d+ with terms/);
  }
});

test('the top comes first, then the tabs, then the figure; and a class’s list header is its title, its count and its sort', async ({ page }) => {
  await onHoldings(page);
  const all = await page.evaluate(() => ({
    top: document.querySelector('.holdings-top')?.getBoundingClientRect().top ?? 0,
    tabs: document.querySelector('nav[aria-label="Holdings by class"]')?.getBoundingClientRect().top ?? 0,
    figure: document.querySelector('section.card-lift')?.getBoundingClientRect().top ?? 0,
  }));
  expect(all.top, 'Import is above the tabs').toBeLessThan(all.tabs);
  expect(all.tabs, 'the tabs are above the figure').toBeLessThan(all.figure);

  await onClass(page, 'deposit');
  await expect(page.getByRole('button', { name: /Sorted/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Deposits/ })).toBeVisible();
});

test('the icons and the Add on the list are a thumb\'s size on a touch screen', async ({ page }, testInfo) => {
  await onHoldings(page);
  const phone = (page.viewportSize()?.width ?? 1000) < 640;
  test.skip(!phone, `a touch screen's rule; ${testInfo.project.name} uses a mouse`);
  for (const name of ['Fetch prices', 'Import', 'Add a holding']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box?.width, `${name} width`).toBeGreaterThanOrEqual(43.5);
    expect(box?.height, `${name} height`).toBeGreaterThanOrEqual(43.5);
  }
});
