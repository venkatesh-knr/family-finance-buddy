import { test as teardown, expect } from '@playwright/test';
import { chooseHousehold, resetHousehold, testHouseholdName, testRowsVisible } from './created.ts';

/**
 * After the run: put the test household back to the seed, then fail if any row a spec created is still visible.
 *
 * The check is the point. A reset that left something behind, a spec that wrote to the wrong household, or a new
 * table the reset does not know are all the same failure here: a row named like a test's that somebody can see.
 * It reads the three screens a test-created row would appear on (Expenses, Holdings, Insurance) in the test
 * household and in every other household the account belongs to.
 *
 * Without `E2E_HOUSEHOLD` there is no household the suite may reset, so it only reports.
 */

teardown('nothing a spec created survives the run', async ({ page }) => {
  const dedicated = testHouseholdName();

  if (dedicated === null) {
    await page.goto('/#overview');
    const survivors = await testRowsVisible(page);
    console.warn(
      `\n  E2E_HOUSEHOLD is not set, so the suite cannot clean up after itself. ${String(survivors.length)} test-created ` +
        `row(s) are visible in the household it ran in${survivors.length > 0 ? `: ${survivors.slice(0, 5).join(', ')}` : ''}.\n`,
    );
    return;
  }

  await chooseHousehold(page, dedicated);
  await resetHousehold(page);

  const switcher = page.getByLabel('Household', { exact: true });
  const options = (await switcher.count()) === 0 ? [dedicated] : await switcher.locator('option').allTextContents();
  const survivors: string[] = [];
  for (const [index, label] of options.entries()) {
    await page.goto('/#overview');
    if ((await switcher.count()) > 0) await switcher.selectOption({ index });
    for (const row of await testRowsVisible(page)) survivors.push(`${label.trim()}: ${row}`);
  }

  // Leave the browser on the test household, which is where the next run expects to start.
  await chooseHousehold(page, dedicated);

  expect(survivors, 'rows a spec created that are still visible after the reset').toEqual([]);
});
