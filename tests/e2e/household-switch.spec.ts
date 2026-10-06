import { test, expect } from '@playwright/test';

/**
 * Switching household changes everything the screen is about.
 *
 * What this does *not* do: prove that household A cannot read household B's
 * rows. That is a security property and it is proved where it is enforced — in
 * `supabase/tests/rls_household_isolation.test.sql` and its siblings, against
 * the policies themselves, with a second authenticated role. A browser test
 * that signs in as one person can never establish it, and writing one that
 * looks like it does would be worse than having none.
 *
 * What this proves is narrower and still worth having: that the switcher is
 * wired to the queries, so a person who switches is actually looking at the
 * other household rather than at a stale render of the first. A filter that
 * outlives the control that set it is a screen quietly showing the wrong money.
 */

test('the figures change when the household changes', async ({ page }) => {
  await page.goto('/#overview');

  const switcher = page.getByRole('combobox').first();

  const options = await switcher.locator('option').allTextContents();
  test.skip(
    options.length < 2,
    'only one household on this account — add a second demo household to exercise the switcher',
  );

  const headline = page.getByRole('heading', { name: /net worth/i }).locator('..');
  const before = await headline.innerText();

  await switcher.selectOption({ index: 1 });

  // Not a sleep: wait for the figure itself to differ. Two households with
  // identical net worth would make this flake, which is why the seed gives them
  // different positions.
  await expect
    .poll(async () => headline.innerText(), { timeout: 10_000 })
    .not.toBe(before);
});

test('a holdings filter does not survive the household it was set in', async ({ page }) => {
  // From the shell's own note: "A filter that outlived the click that set it is
  // a list quietly missing rows." Arriving at Holdings by asking for Holdings
  // means all of them.
  await page.goto('/#overview');

  const allocationRow = page.getByRole('link').filter({ hasText: /mutual funds|bonds|etf/i }).first();
  test.skip((await allocationRow.count()) === 0, 'no allocation rows in this household');

  await allocationRow.click();
  await expect(page).toHaveURL(/holdings/);

  await page.getByRole('group', { name: 'Screen' }).first().getByText('Overview', { exact: true }).click();
  await page.getByRole('group', { name: 'Screen' }).first().getByText('Holdings', { exact: true }).click();

  await expect(
    page.getByRole('button', { name: /clear filter|all holdings/i }),
    'a class filter survived navigating away and back',
  ).toHaveCount(0);
});
