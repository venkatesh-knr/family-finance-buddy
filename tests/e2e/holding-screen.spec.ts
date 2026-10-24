import { test, expect, type Page } from '@playwright/test';

/**
 * A holding's own screen as its artboards draw it (docs/design/vibrant-canvas.html, the deposit and the fund): on a
 * phone a bar of its own, the identity with the member and a kind pill, the value card with what is worked out or
 * quoted beside it, the term in four figures with a tick for today, the position in four figures with the peak last,
 * the transactions folded to a row, and Archive with its icon.
 *
 * Read-only: nothing is recorded, renewed or archived here.
 */

async function open(page: Page, kind: 'deposit' | 'mutual_fund') {
  await page.goto(`/#/holdings?kind=${kind}`);
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.holding-row').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.holding-row').first().locator('a.holding-link').click();
  await expect(page.getByTestId('detail-value')).toBeVisible({ timeout: 20_000 });
}

test('on a phone the screen has its own bar: back to Holdings, the privacy switch and Edit', async ({ page }, testInfo) => {
  await open(page, 'deposit');
  const phone = (page.viewportSize()?.width ?? 1000) < 640;
  test.skip(!phone, `the bar is a phone's; ${testInfo.project.name} keeps the full header`);
  const bar = page.locator('header.screen-bar');
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Holdings' })).toBeVisible();
  await expect(bar.getByRole('button', { name: /Amounts shown/ })).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Edit / })).toBeVisible();
  // The app's own header is not above it.
  await expect(page.getByRole('heading', { name: 'Family Finance Buddy' })).toBeHidden();
});

test('a deposit: kind pill, the value card with what is worked out, the term in four figures with a tick, and the pair of buttons', async ({
  page,
}) => {
  await open(page, 'deposit');
  await expect(page.getByText('Fixed deposit', { exact: true })).toBeVisible();

  const value = page.getByRole('region', { name: 'Value' });
  await expect(value.getByText('In net worth', { exact: true }).or(value.getByText('Last reading', { exact: true }))).toBeVisible();
  // The worked-out value sits in the card, with how it differs from the reading; recording it is one press away.
  await expect(value).toContainText(/Worked out today|Value at par|Recorded as today/);

  const term = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Term', exact: true }) });
  await expect(term.getByTestId('term-progress').locator('.term-tick')).toBeVisible();
  for (const label of ['Principal', 'Rate', 'Interest so far', 'This term pays']) {
    await expect(term.getByText(label, { exact: true })).toBeVisible();
  }
  // Not repeated from the card above, or from the dates under the bar.
  await expect(term.getByText('Value today', { exact: true })).toHaveCount(0);
  await expect(term.getByText('Matures', { exact: true })).toHaveCount(0);

  // Record a renewal and Archive are a pair, as drawn, outside the card.
  const renewal = page.getByRole('button', { name: /^Record a renewal/ });
  const archive = page.getByRole('button', { name: /^Archive / });
  await expect(renewal).toBeVisible();
  await expect(archive).toContainText('Archive');
  await expect(archive).not.toContainText(/Archive .+/);
  const a = await renewal.boundingBox();
  const b = await archive.boundingBox();
  expect(Math.abs((a?.y ?? 0) - (b?.y ?? 99999)), 'the pair share a line, or wrap together').toBeLessThan(80);
});

test('a fund: the position in four figures, the peak last, the transactions folded to a row of their own', async ({ page }) => {
  await open(page, 'mutual_fund');
  const position = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Position', exact: true }) });
  const labels = await position.locator('dt.label').allInnerTexts();
  expect(labels.slice(0, 4)).toEqual(['Units', 'Cost of units held', 'Return', 'Realised']);
  // The peak is the last row of the card.
  await expect(position.locator('.peak-row')).toContainText(/Peak \d{4}/);

  // The transactions are not in the Position card: a folded row of their own with one button.
  await expect(position.getByText('Add a purchase or sale')).toHaveCount(0);
  const transactions = page.getByRole('region', { name: 'Transactions' });
  await expect(transactions.getByRole('button', { name: /^Transactions/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(transactions.getByRole('button', { name: 'Add a purchase or sale' })).toBeVisible();

  // Archive is the word and its icon.
  await expect(page.getByRole('button', { name: /^Archive / })).toContainText('Archive');
});

test('a fund linked to a price feed has Fetch price beside Record a value, and says what it found', async ({ page }) => {
  await open(page, 'mutual_fund');
  const fetch = page.getByRole('button', { name: 'Fetch price' });
  test.skip((await fetch.count()) === 0, 'the first fund in this household is not linked to a price feed');
  await expect(page.getByRole('button', { name: 'Record a value' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Value' })).toContainText('Quoted');
});
