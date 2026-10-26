/**
 * The property screen, with a valued property open, has nothing axe can find in either theme.
 *
 * The whole rule set and not only contrast: the screen has forms, a disclosure and a row of figures, and a heading that
 * jumped a level was found this way. It writes to the demo household and archives what it made.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

for (const scheme of ['light', 'dark'] as const) {
  test(`the property screen has no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ colorScheme: scheme });
    const name = `Access house ${Date.now() % 100000}`;
    await page.goto('/#/property');
    await expect(page.getByRole('heading', { name: 'Property', exact: true, level: 2 })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Add a property' }).click();
    const form = page.getByRole('form', { name: 'Add a property' });
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByLabel('Bought on').fill('2019-03-01');
    await form.getByLabel('Price paid').fill('4200000');
    await form.getByLabel(/Household.s share/).fill('50');
    await form.getByRole('button', { name: 'Add the property' }).click();
    const card = page.getByRole('region', { name });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: 'Details', exact: true }).click();
    const v = card.getByRole('form', { name: /Record a valuation/ });
    await v.getByLabel('As at').fill('2025-04-03');
    await v.getByLabel('Worth').fill('6400000');
    await v.getByRole('button', { name: 'Record valuation' }).click();
    await expect(card).toContainText('Valued at');
    // The screen's own content: the bottom bar's role is the shell's, found by this and fixed in its own change.
    const result = await new AxeBuilder({ page }).include('main').analyze();
    const summary = result.violations.map((x) => `${x.id}: ${x.nodes.length} · ${x.nodes[0]?.html.slice(0, 110)}`);
    await card.getByRole('button', { name: 'Archive', exact: true }).click();
    await card.getByRole('button', { name: 'Archive it' }).click();
    expect(result.violations.length, summary.join('\n')).toBe(0);
  });
}
