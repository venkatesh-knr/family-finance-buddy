import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

/**
 * What comes in, on FIRE (docs/design/ledger-income.md section 7; LI-I9, LI-I10, LI-I20; the FireIncome and FireBusiness boards): the yearly income
 * with its working and its months, or, with nothing to read, FIRE's own number without one and a link to Money; and the Household view from the sum
 * function, which lists no member's months.
 *
 * The arithmetic is held to its vectors by the unit tests and the policy suite. What these check is what the screen says, whatever the suite's
 * household holds at the time: other specs enter credits, so no figure is asserted here.
 */

test.use({ actionTimeout: 15_000 });

async function onFire(page: Page) {
  await page.goto('/#/fire');
  await expect(page.getByRole('region', { name: 'What comes in' })).toBeVisible({ timeout: 30_000 });
}

test('FIRE says what comes in: a yearly figure with its working, or that it shows its number without one, and never nothing as a figure', async ({ page }) => {
  await onFire(page);
  const panel = page.getByRole('region', { name: 'What comes in' });
  const total = panel.getByTestId('fire-income-total');

  if ((await total.count()) > 0) {
    // A figure: never grown by inflation, with where it came from, and the way to change it. Never a figure of nothing (LI-I10).
    await expect(total).toContainText('₹');
    await expect(total).not.toHaveText(/^₹\s*0(\.00)?$/);
    await expect(panel).toContainText('never grown by inflation');
    await expect(panel.getByRole('link', { name: 'Change it in Money' })).toBeVisible();
  } else {
    // Nothing to read: said in words, never a zero, with a link to Money (LI-I10).
    await expect(panel).toContainText('FIRE shows your number without a yearly income');
    await expect(panel).not.toContainText(/₹\s*0(\.00)?(?![\d,])/);
    await expect(panel.getByRole('link', { name: 'Add money in on Money' })).toHaveAttribute('href', /#\/money/);
  }
});

test('the Household view comes from the sum function and lists no member’s months, and says why', async ({ page }) => {
  await onFire(page);
  const panel = page.getByRole('region', { name: 'What comes in' });
  // A household of one has nothing to switch between, and shows no switch.
  test.skip((await panel.getByRole('button', { name: 'Household' }).count()) === 0, 'a household of one has no switch');
  await panel.getByRole('button', { name: 'Household' }).click();
  await expect(panel.getByRole('button', { name: 'Household' })).toHaveAttribute('aria-pressed', 'true');
  // No member's months are listed in this view.
  await expect(panel.getByRole('list', { name: 'The months it came from' })).toHaveCount(0);
  if ((await panel.getByTestId('fire-income-total').count()) > 0) {
    await expect(panel).toContainText('No member’s months are listed');
    await expect(panel).toContainText('reveal the other person’s');
  } else {
    await expect(panel).toContainText('FIRE shows your number without a yearly income');
  }
  await panel.getByRole('button', { name: 'Mine' }).click();
  await expect(panel.getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`What comes in has no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await onFire(page);
    const result = await new AxeBuilder({ page }).include('[aria-label="What comes in"]').analyze();
    const found = result.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(found, found.join('\n')).toEqual([]);
  });
}
