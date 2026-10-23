import { test, expect, type Page } from '@playwright/test';
import { testName } from './created.ts';

/**
 * Profile as its artboard draws it (docs/design/vibrant-canvas.html, Profile): who you are, how you sign in, how
 * many of your entries are private and which, what has been done in plain words, and Sign out.
 *
 * It never changes the password and never signs out: both would end the session every other spec depends on. The
 * password form is tested as far as the check made before anything is sent.
 */

async function onProfile(page: Page) {
  await page.goto('/#profile');
  await expect(page.getByRole('region', { name: 'Recent activity' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
}

test('who you are: a name, the household, and the role', async ({ page }) => {
  await onProfile(page);
  const hero = page.getByRole('region', { name: 'You', exact: true });
  await expect(hero.locator('.profile-name')).not.toBeEmpty();
  await expect(hero).toContainText(/owner|partner|contributor|viewer/i);
  // What the role permits, so nobody has to guess, and for an owner where to do it.
  await expect(hero).toContainText(/^[\s\S]*(Can |Has no role)/);
  const where = hero.getByTestId('profile-where');
  if ((await where.count()) > 0) {
    await expect(where).toContainText('Invite people and change roles under Members in Settings');
    await where.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
  }
});

test('how you sign in: your email, a password you can change, and two-step sign-in that is on', async ({ page }) => {
  await onProfile(page);
  const signIn = page.getByRole('region', { name: 'Sign-in' });
  await expect(signIn).toContainText('Email');
  await expect(signIn.getByRole('button', { name: /Two-step sign-in/ })).toContainText('On', { timeout: 20_000 });

  await signIn.getByRole('button', { name: /Two-step sign-in/ }).click();
  await expect(signIn).toContainText('cannot be turned off');
});

test('changing the password asks for a good one and says what is wrong before sending anything', async ({ page }) => {
  await onProfile(page);
  const row = page.getByRole('button', { name: /^Password/ });
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');

  await page.getByLabel('New password', { exact: true }).fill('short');
  await page.getByLabel('New password again').fill('short');
  await page.getByLabel('Six-digit code').fill('123456');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('alert')).toContainText('at least 12 characters');

  // A good password with no code is not sent either: the code is asked for first.
  await page.getByLabel('New password', { exact: true }).fill('Correct-Horse-9-Battery');
  await page.getByLabel('New password again').fill('Correct-Horse-9-Battery');
  await page.getByLabel('Six-digit code').fill('12');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('alert')).toContainText('six-digit code');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
});

test('your private entries: the count, the entries it counts, and how it works', async ({ page }) => {
  await onProfile(page);
  const privacy = page.getByRole('region', { name: 'Your privacy' });
  const text = await privacy.innerText();
  test.skip(/None of your entries/.test(text), 'this household has no private entries of the signed-in member');

  await expect(privacy).toContainText(/\d+ of your entries (is|are) private/);
  await privacy.getByRole('button', { name: 'See them' }).click();
  await expect(privacy.locator('.activity-row').first()).toBeVisible({ timeout: 20_000 });

  await privacy.getByRole('button', { name: 'How it works' }).click();
  await expect(privacy).toContainText('the owner included');
});

test('with amounts hidden, a private entry\'s amount is out of the document', async ({ page }) => {
  await onProfile(page);
  const privacy = page.getByRole('region', { name: 'Your privacy' });
  test.skip(/None of your entries/.test(await privacy.innerText()), 'no private entries to list');
  await privacy.getByRole('button', { name: 'See them' }).click();
  await expect(privacy.locator('.activity-row').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Amounts shown/ }).click();
  const rows = await privacy.locator('.activity-row').allInnerTexts();
  for (const row of rows) expect(row).not.toMatch(/\d{1,3}(,\d{2,3})*\.\d{2}|\d,\d{3}/);
});

test('recent activity names the thing: an expense just added shows as "Added an expense · its payee"', async ({ page }) => {
  const payee = testName('activity');
  await page.goto('/#expenses');
  await expect(page.getByRole('region', { name: 'Recent expenses' })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/^Amount \(/).fill('12.34');
  await page.getByLabel('Payee').fill(payee);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Recent expenses' })).toContainText(payee, { timeout: 20_000 });

  await onProfile(page);
  const row = page.getByRole('region', { name: 'Recent activity' }).locator('li').filter({ hasText: payee });
  await expect(row.first()).toContainText('Added an expense', { timeout: 20_000 });
  // Grouped by day, with the time at the right.
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(row.first()).toContainText(/\d{1,2}:\d{2} (am|pm)/);
});

test('Sign out is a button at the foot of the screen', async ({ page }) => {
  await onProfile(page);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});
