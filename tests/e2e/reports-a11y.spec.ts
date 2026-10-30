/**
 * Reports, closed and with the code step open, has nothing axe can find in either theme. It only reads.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

for (const scheme of ['light', 'dark'] as const) {
  test(`Reports has no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    const found: string[] = [];
    const scan = async (where: string) => {
      const result = await new AxeBuilder({ page }).analyze();
      for (const v of result.violations) found.push(`${where} · ${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    };

    await page.goto('/#/reports');
    await expect(page.getByRole('region', { name: 'Export everything' })).toBeVisible({ timeout: 20_000 });
    await scan('closed');
    await page.getByRole('button', { name: 'Export everything · Excel' }).click();
    await expect(page.getByRole('form', { name: 'Confirm the export' })).toBeVisible();
    await scan('asking for the code');
    expect(found, found.join('\n')).toEqual([]);
  });
}
