import { test, expect } from '@playwright/test';
import { card, setEarmark } from './earmark.ts';

/**
 * Earmarking a holding takes it out of the FIRE corpus, and un-earmarking it puts it back (PF-C7, PF-C8).
 *
 * It writes to the demo household, so it puts the holding back as it found it, in `finally`. It tags one
 * holding and reads the FIRE screen's standing line; it does not assert a figure, because what the demo
 * household holds is its own business and the arithmetic is the unit tests'.
 */

// An action that cannot find its element fails in seconds with the reason, not at the end of the test with a closed page.
test.use({ actionTimeout: 15_000 });

test('PF-C7 PF-C8 — an earmark leaves the FIRE corpus and the screen says so, and clearing it brings it back', async ({ page }) => {
  // Four page loads and two saves against a hosted database: well over the default thirty seconds.
  test.setTimeout(150_000);
  const name = /Vanguard/;
  try {
    await setEarmark(page, name, "Child's savings");
    await expect(card(page, name).getByText("Child's savings", { exact: true })).toBeVisible();

    await page.goto('/#fire');
    await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
    const leftOut = page.getByTestId('fire-left-out');
    await expect(leftOut).toBeVisible({ timeout: 20_000 });
    // The standing line states the exclusion by name (PF-C8), and says why the figure fell the first time.
    await expect(leftOut).toContainText(/Left out because it is set aside/);
    await expect(leftOut).toContainText(/child.s savings/i);
  } catch (failure) {
    // Put the holding back, and say both if both fail: a restore error must not hide why the test failed.
    await setEarmark(page, name, 'No earmark').catch((restore: unknown) => {
      throw new Error(`${String(failure)} — and putting the holding back failed too: ${String(restore)}`);
    });
    throw failure;
  }

  await setEarmark(page, name, 'No earmark');

  await page.goto('/#fire');
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('fire-left-out')).toBeVisible({ timeout: 20_000 });
  // Back to where it was: nothing earmarked, so nothing left out. (Not a search for the words, which the hint uses.)
  await expect(page.getByTestId('fire-left-out')).toContainText(/Nothing is earmarked/);
  await expect(page.getByTestId('fire-left-out')).not.toContainText(/Left out because/);
});
