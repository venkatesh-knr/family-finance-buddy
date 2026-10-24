import { expect, type Page } from '@playwright/test';

/**
 * Getting at what the FIRE screen folds away (docs/design/vibrant-canvas.html, FIRE; the owner's call on the
 * mock-vs-build review, item 7): the planning cards are folded to a title and a line until they are pressed, and
 * what else the corpus does not hold is one press away under the ring.
 */

/** Open a folded card by its title, if it is not open already. */
export async function openCard(page: Page, title: string): Promise<void> {
  const toggle = page.getByRole('button', { name: new RegExp(`^${title}`) }).first();
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** Open the "What else it leaves out" disclosure under the ring, if it is not open already. */
export async function openRestsOn(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'What else it leaves out' });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByTestId('fire-rests-on')).toBeVisible();
}
