/**
 * The retirement screens, the Add form for each type and a PPF's own screen with a payment on it, have nothing axe can find in
 * either theme. The whole rule set and not only contrast: they are forms, disclosures and lists of figures. It writes to the demo
 * household and archives what it made.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { choose, next, stepper } from './fields.ts';
import { archiveByName, openHolding, openList } from './holdings.ts';

for (const scheme of ['light', 'dark'] as const) {
  test(`the retirement screens have no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme });
    const name = `Access PPF ${Date.now() % 100000}`;
    const found: string[] = [];
    const scan = async (where: string) => {
      const result = await new AxeBuilder({ page }).analyze();
      for (const v of result.violations) found.push(`${where} · ${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    };

    await openList(page);
    await page.getByRole('button', { name: /^Add\b/ }).click();
    await choose(page, 'Type', /^A retirement account/);
    const form = stepper(page);
    await form.getByLabel('What it is', { exact: true }).fill(name);
    for (const type of [/^EPF/, /^NPS/]) {
      await choose(page, 'Which', type);
      await scan(`add form, step one, ${String(type).slice(2, 5)}`);
      await next(page);
      await scan(`add form, step two, ${String(type).slice(2, 5)}`);
      await page.getByRole('button', { name: 'Back' }).click();
    }
    await choose(page, 'Which', /^PPF/);
    await next(page);
    await form.getByLabel('Opening balance', { exact: true }).fill('100000');
    await form.getByLabel('As at', { exact: true }).fill('2026-03-31');
    await expect(form.getByLabel(/Record today.s value/)).toBeChecked({ timeout: 20_000 });
    await scan('add form, PPF, figures');
    await next(page);
    await form.getByLabel('Bank or post office').fill('SBI');
    await scan('add form, PPF, where it is held');
    await form.getByRole('button', { name: 'Add the PPF' }).click();

    try {
      await openHolding(page, name);
      const payment = page.getByRole('form', { name: 'Record a PPF payment' });
      await payment.getByLabel('Amount').fill('50000');
      await payment.getByRole('button', { name: 'Record', exact: true }).click();
      await expect(page.getByTestId('ppf-worked-out')).toContainText('1,50,000');
      await scan('PPF screen');
    } finally {
      await archiveByName(page, name);
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}
