import { test, expect } from '@playwright/test';
import { householdSwitcher } from './created.ts';

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
  // What differs between two households is who is in them. Their money can be the same: a household reset to the
  // seed holds the seed, so the net worth of two of them is one figure and says nothing about whether the switcher
  // reached the queries. The members listed on Settings are read for the household chosen, so they do.
  async function membersListed(): Promise<string> {
    await page.goto('/#settings');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('.member-row').first()).toBeVisible({ timeout: 20_000 });
    return (await page.locator('.member-row .member-name').allInnerTexts()).join(' | ');
  }

  await page.goto('/#overview');
  // The shell, then the data: counting the switcher's options before it has rendered reads none, and skipped this
  // spec on an account that had two households.
  await expect(page.getByRole('group', { name: 'Screen' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });

  const switcher = householdSwitcher(page);
  const options = await switcher.locator('option').evaluateAll((all) =>
    all.map((option) => (option as HTMLOptionElement).value),
  );
  test.skip(
    options.length < 2,
    'only one household on this account — add a second demo household to exercise the switcher',
  );

  const before = await membersListed();

  // The household that is not the one showing.
  await page.goto('/#overview');
  await expect(switcher).toBeVisible({ timeout: 20_000 });
  const current = await switcher.inputValue();
  const other = options.find((value) => value !== current);
  await switcher.selectOption(other ?? options[1] ?? '');

  // Not a sleep: the other household's members have to be what is listed.
  await expect.poll(membersListed, { timeout: 30_000 }).not.toBe(before);
});

test('a holdings filter does not survive the household it was set in', async ({ page }) => {
  // From the shell's own note: "A filter that outlived the click that set it is
  // a list quietly missing rows." Arriving at Holdings by asking for Holdings
  // means all of them.
  await page.goto('/#overview');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });

  const allocationLink = page.locator('a.alloc-link').first();
  test.skip((await allocationLink.count()) === 0, 'no allocation rows in this household');

  await allocationLink.click();
  await expect(page).toHaveURL((url) => url.hash.includes('kind='));

  await page.getByRole('group', { name: 'Screen' }).first().getByText('Overview', { exact: true }).click();
  await page.getByRole('group', { name: 'Screen' }).first().getByText('Holdings', { exact: true }).click();

  // Asking for Holdings means all of them: no class in the address, and the All chip is the one pressed.
  await expect(page).toHaveURL((url) => !url.hash.includes('kind='));
  await expect(
    page.locator('.chips a[aria-current="true"]'),
    'a class filter survived navigating away and back',
  ).toHaveText(/^All/, { timeout: 20_000 });
});
