import { test, expect, type Page } from '@playwright/test';

/**
 * A property is in net worth, the allocation and the history, at the household's share (docs/decisions.md, Property).
 *
 * It files a property held half and half, valued at 2,00,00,000, so the household's share is 1,00,00,000, and looks for it
 * where the Overview counts what is held: a row of the allocation, named Property, whose whole row links to the Property
 * screen. Archiving it takes it out again. It writes to the demo household like the other specs and archives what it made.
 */

test.use({ actionTimeout: 15_000 });

async function onOverview(page: Page) {
  await page.goto('/#overview');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.alloc-row').first()).toBeVisible({ timeout: 20_000 });
}

test('a valued property is a row of the allocation at the household share, and archiving it takes it out', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `e2e-nw-${Date.now()}`;

  await page.goto('/#/property');
  await expect(page.getByRole('heading', { name: 'Property', exact: true, level: 2 })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add a property' }).click();
  const form = page.getByRole('form', { name: 'Add a property' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Bought on').fill('2019-03-01');
  await form.getByLabel('Price paid').fill('9000000');
  await form.getByLabel(/Household.s share/).fill('50');
  await form.getByRole('button', { name: 'Add the property' }).click();

  const card = page.getByRole('region', { name });
  try {
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: 'Details', exact: true }).click();
    const valuation = card.getByRole('form', { name: `Record a valuation of ${name}` });
    // Today's, first, with the date the form offers, which is the app's own today: a date worked out here could be a day
    // ahead of it for the minutes after midnight in India, and a valuation cannot be dated after today.
    await valuation.getByLabel('Worth').fill('20000000');
    await valuation.getByRole('button', { name: 'Record valuation' }).click();
    await expect(card).toContainText('2,00,00,000');
    // And one at the purchase, so the history is not stopped at the first valuation recorded.
    await valuation.getByLabel('As at').fill('2019-03-01');
    await valuation.getByLabel('Worth').fill('9000000');
    await valuation.getByRole('button', { name: 'Record valuation' }).click();
    await expect(card).toContainText('90,00,000');
    await expect(card).toContainText('2,00,00,000');

    // Half of two crore is one crore, and it is a row of the allocation, which links to the Property screen.
    await onOverview(page);
    const row = page.locator('.alloc-row').filter({ hasText: /^Property/ });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.alloc-value')).toHaveAttribute('title', /1,00,00,000/);
    await expect(row.locator('a')).toHaveAttribute('href', '#/property');

    // Pressing anywhere on the row opens the Property screen. Brought to the middle of the screen, clear of the fixed bar.
    await row.evaluate((el) => {
      el.scrollIntoView({ block: 'center' });
    });
    const box = await row.boundingBox();
    await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) * 0.55, (box?.y ?? 0) + (box?.height ?? 0) * 0.5);
    await expect(page).toHaveURL((url) => /^#\/?property$/.test(url.hash));
  } finally {
    await page.goto('/#/property');
    const again = page.getByRole('region', { name });
    if ((await again.count()) > 0 || (await again.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false))) {
      const details = again.getByRole('button', { name: 'Details', exact: true });
      if ((await details.getAttribute('aria-expanded')) !== 'true') await details.click();
      await again.getByRole('button', { name: 'Archive', exact: true }).click();
      await again.getByRole('button', { name: 'Archive it' }).click();
      await expect(page.getByRole('region', { name })).toHaveCount(0, { timeout: 20_000 });
    }
  }

  // Archived, it is no longer held, so it is not a row.
  await onOverview(page);
  await expect(page.locator('.alloc-row').filter({ hasText: /^Property/ })).toHaveCount(0);
});

test('a property valued long ago is counted and marked on the Overview, and says what to do', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `e2e-stale-${Date.now()}`;

  await page.goto('/#/property');
  await expect(page.getByRole('heading', { name: 'Property', exact: true, level: 2 })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add a property' }).click();
  const form = page.getByRole('form', { name: 'Add a property' });
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Bought on').fill('2019-03-01');
  await form.getByLabel('Price paid').fill('5000000');
  await form.getByRole('button', { name: 'Add the property' }).click();

  const card = page.getByRole('region', { name });
  try {
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: 'Details', exact: true }).click();
    const valuation = card.getByRole('form', { name: `Record a valuation of ${name}` });
    await valuation.getByLabel('As at').fill('2023-01-10');
    await valuation.getByLabel('Worth').fill('5000000');
    await valuation.getByRole('button', { name: 'Record valuation' }).click();
    await expect(card).toContainText('50,00,000');

    // It is counted, and the figure says it is old and what to do: the text is in the mark's panel.
    await onOverview(page);
    await expect(page.locator('.alloc-row').filter({ hasText: /^Property/ })).toHaveCount(1);
    await expect(page.getByText(new RegExp(String.raw`${name} \(\d+ months\) has a valuation more than 12 months old`)).first()).toBeAttached();
    await expect(page.getByText(/Record a new valuation on Property/).first()).toBeAttached();
  } finally {
    await page.goto('/#/property');
    const again = page.getByRole('region', { name });
    if (await again.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)) {
      const details = again.getByRole('button', { name: 'Details', exact: true });
      if ((await details.getAttribute('aria-expanded')) !== 'true') await details.click();
      await again.getByRole('button', { name: 'Archive', exact: true }).click();
      await again.getByRole('button', { name: 'Archive it' }).click();
      await expect(page.getByRole('region', { name })).toHaveCount(0, { timeout: 20_000 });
    }
  }
});

for (const livedIn of [true, false]) {
  test(`the FIRE screen ${livedIn ? 'leaves out a home the family lives in, with the amount' : 'counts a property that is not lived in, and says nothing is left out for it'}`, async ({ page }) => {
    test.setTimeout(180_000);
    const name = `e2e-fire-${livedIn ? 'home' : 'plot'}-${Date.now()}`;

    await page.goto('/#/property');
    await expect(page.getByRole('heading', { name: 'Property', exact: true, level: 2 })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Add a property' }).click();
    const form = page.getByRole('form', { name: 'Add a property' });
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByLabel('Bought on').fill('2019-03-01');
    await form.getByLabel('Price paid').fill('5000000');
    if (livedIn) await form.getByLabel('Lived in by the family').check();
    await form.getByRole('button', { name: 'Add the property' }).click();

    const card = page.getByRole('region', { name });
    try {
      await expect(card).toBeVisible({ timeout: 20_000 });
      await card.getByRole('button', { name: 'Details', exact: true }).click();
      const valuation = card.getByRole('form', { name: `Record a valuation of ${name}` });
      await valuation.getByLabel('As at').fill('2019-03-01');
      await valuation.getByLabel('Worth').fill('5000000');
      await valuation.getByRole('button', { name: 'Record valuation' }).click();
      await expect(card).toContainText('50,00,000');

      await page.goto('/#/fire');
      await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByTestId('fire-left-out')).toBeVisible({ timeout: 20_000 });
      const line = page.getByTestId('fire-property-left-out');
      if (livedIn) {
        await expect(line).toBeVisible();
        await expect(line).toContainText('left out');
        await expect(line).toContainText('50L');
      } else {
        // Counted in the corpus, so there is nothing about it to say is left out.
        await expect(line).toHaveCount(0);
      }
      // And the corpus is not said to be short for want of a value on a property that is valued.
      await expect(page.getByText(/properties? (has|have) never been valued/)).toHaveCount(0);
    } finally {
      await page.goto('/#/property');
      const again = page.getByRole('region', { name });
      if (await again.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)) {
        const details = again.getByRole('button', { name: 'Details', exact: true });
        if ((await details.getAttribute('aria-expanded')) !== 'true') await details.click();
        await again.getByRole('button', { name: 'Archive', exact: true }).click();
        await again.getByRole('button', { name: 'Archive it' }).click();
        await expect(page.getByRole('region', { name })).toHaveCount(0, { timeout: 20_000 });
      }
    }
  });
}
