import { test, expect, type Page } from '@playwright/test';

/**
 * "Adding X a month brings it to Y" on the FIRE screen: the household's own projection with a round extra put in each
 * month, shown only where it moves the date earlier, with Adjust going to the monthly amount it is about.
 *
 * It needs assumptions to project from, and the household has none until somebody sets them, so this sets a monthly
 * amount and a return and puts both back whatever happens. They are written to the household row, which is why the
 * read-only FIRE spec leaves them alone.
 */

async function onFire(page: Page) {
  await page.goto('/#fire');
  await expect(page.getByText('What the projection assumes', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
}

test('the line appears once there is something put in and a return, and Adjust focuses the monthly amount', async ({ page }) => {
  test.setTimeout(120_000);
  await onFire(page);
  const assumptions = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'What the projection assumes' }) });
  const monthly = assumptions.locator('#fire-contribution');
  test.skip((await monthly.count()) === 0, 'this role cannot set the assumptions');
  const ret = assumptions.getByLabel('Return');
  const before = { monthly: await monthly.inputValue(), ret: await ret.inputValue() };

  try {
    await monthly.fill('20000');
    await monthly.press('Enter');
    await ret.fill('8');
    await ret.press('Tab');

    const line = page.getByRole('region', { name: 'How far along' }).locator('.fire-whatif');
    await expect(line).toContainText(/Adding .+ a month brings it to \d{4}/, { timeout: 20_000 });

    await line.getByRole('button', { name: /^Adjust/ }).click();
    await expect(monthly).toBeFocused();
  } finally {
    await monthly.fill(before.monthly);
    await monthly.press('Enter');
    await ret.fill(before.ret);
    await ret.press('Tab');
    await expect(ret).toHaveValue(before.ret, { timeout: 20_000 });
  }
});
