import { expect, type Page } from '@playwright/test';

/**
 * What the specs create, and how the suite knows it has left nothing behind.
 *
 * The suite writes: expenses, deposits, bonds, a policy, readings. Most of that cannot be deleted from the app
 * (deletes are soft, readings and terms are append-only, a policy has no delete grant, the audit trail is
 * permanent), so "each spec deletes what it creates" is not available. The suite runs in a household of its own
 * instead, and `reset_demo_household` returns that household to the seed before and after every run. Nothing it
 * creates is ever in the household anybody uses.
 *
 * Every row a spec creates is named with the prefix below, so one pattern finds all of them. A spec that makes a
 * row names it through `testName`, and the teardown fails the run if any such row is still visible anywhere,
 * in the test household after its reset or in any other household the account belongs to.
 */

/** Names a test creates: `e2e-<what>-<timestamp>`. Unique per run, since the households are not reset between specs. */
export function testName(what: string): string {
  return `e2e-${what}-${String(Date.now())}`;
}

/** The one policy the insurance spec uses. It also matches {@link TEST_ROW}. */
export const POLICY_NAME = 'E2E policy';

/** A test-created row, by name: the `e2e-` prefix, or the policy's. */
export const TEST_ROW = /\be2e[- ][\w -]*/gi;

/** The household the suite runs in, or null for the legacy shared-household mode. */
export function testHouseholdName(): string | null {
  const name = process.env['E2E_HOUSEHOLD'];
  return name === undefined || name.trim() === '' ? null : name.trim();
}

/** The screens a test-created row would show on. */
const SCREENS = ['#expenses', '#holdings', '#insurance'] as const;

async function loaded(page: Page) {
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
}

/**
 * Every test-created row visible in the household the page is looking at. Text content and not rendered text,
 * so a row in a collapsed group (an Ended deposit) is still found.
 */
export async function testRowsVisible(page: Page): Promise<string[]> {
  const found = new Set<string>();
  for (const hash of SCREENS) {
    await page.goto(`/${hash}`);
    await loaded(page);
    await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });
    // A screen can be empty and still be loaded; give the first read a moment to settle.
    await page.waitForTimeout(500);
    const text = (await page.locator('main').textContent()) ?? '';
    for (const match of text.matchAll(TEST_ROW)) found.add(match[0].trim());
  }
  return [...found].sort();
}

/** Settings → Data → Reset, as an owner does it. The database refuses anyone else, and a household that is not demo. */
export async function resetHousehold(page: Page) {
  await page.goto('/#settings');
  await loaded(page);
  await page.getByRole('button', { name: 'Reset…' }).click();
  await page.getByRole('button', { name: 'Yes, wipe and reseed it' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Reset\./ })).toBeVisible({ timeout: 60_000 });
}

/** Choose a household in the shell's switcher by its name. */
export async function chooseHousehold(page: Page, name: string): Promise<void> {
  await page.goto('/#overview');
  const select = page.getByLabel('Household', { exact: true });
  const name_ = page.getByText(name, { exact: true });
  // One household and no switcher: the shell names it instead, and that has to be the test household.
  await expect(select.or(name_).first()).toBeVisible({ timeout: 20_000 });
  if ((await select.count()) === 0) {
    await expect(name_, `the account's only household is not "${name}"`).toBeVisible();
    return;
  }
  const options = await select.locator('option').allTextContents();
  const index = options.findIndex((text) => text.replace(/\s*\(demo\)\s*$/, '').trim() === name);
  expect(
    index,
    `The account is not in a household called "${name}" (it has: ${options.join('; ')}). ` +
      'Run supabase/bootstrap/e2e_household.sql once, as the owner — see tests/e2e/README.md.',
  ).toBeGreaterThanOrEqual(0);
  await select.selectOption({ index });
  await loaded(page);
}
