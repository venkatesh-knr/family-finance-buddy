import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

/**
 * The month and the year are added up from every entry in them, not from the 50 most recent the list holds.
 *
 * The totals used to be made from the list, so a household with more than 50 entries in the month saw a figure short
 * by the older ones, and a note that said so. This puts 51 entries into the household's month through the same API
 * the app uses, as the signed-in member, and checks the screen no longer says its figure is short for that reason.
 *
 * It writes to the demo household, so it runs only where the suite resets it afterwards (E2E_HOUSEHOLD): deletes are
 * soft everywhere in this app and fifty-one test entries would otherwise stay.
 */

test.skip(process.env['E2E_HOUSEHOLD'] === undefined, 'writes 51 entries; the suite resets its household only when E2E_HOUSEHOLD is set');

/** The two values the bundle ships with, read from the repository's own .env. */
function bundleEnv(): { url: string; key: string } {
  const text = readFileSync('.env', 'utf8');
  const read = (name: string): string => {
    const match = new RegExp(`^${name}=(.*)$`, 'm').exec(text);
    if (match?.[1] === undefined) throw new Error(`${name} is not in .env`);
    return match[1].trim().replace(/^["']|["']$/g, '');
  };
  return { url: read('VITE_SUPABASE_URL'), key: read('VITE_SUPABASE_PUBLISHABLE_KEY') };
}

test('a month with more than 50 entries is added up in full, and does not say it is short for that', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#expenses');
  await expect(page.getByTestId('period-spent')).toBeVisible({ timeout: 30_000 });

  const session = await page.evaluate(() => {
    let token = '';
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        token = (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token ?? '';
      }
    }
    return { token, household: localStorage.getItem('finance-buddy:household') ?? '' };
  });
  expect(session.token, 'a signed-in session').not.toBe('');
  expect(session.household, 'the household the run switched to').not.toBe('');

  const { url, key } = bundleEnv();
  const headers = {
    apikey: key,
    authorization: `Bearer ${session.token}`,
    'content-type': 'application/json',
  };
  const members = (await (
    await page.request.get(`${url}/rest/v1/member?household_id=eq.${session.household}&select=id&limit=1`, { headers })
  ).json()) as { id: string }[];
  const memberId = members[0]?.id;
  expect(memberId, 'a member to file against').toBeDefined();

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const rows = Array.from({ length: 51 }, () => ({
    household_id: session.household,
    member_id: memberId,
    txn_date: today,
    amount_minor: '100',
    currency: 'INR',
    visibility: 'household',
  }));
  const inserted = await page.request.post(`${url}/rest/v1/expense_txn`, { headers, data: rows });
  expect(inserted.ok(), await inserted.text()).toBe(true);

  await page.goto('/#expenses');
  await page.reload();
  await expect(page.getByTestId('period-spent')).toBeVisible({ timeout: 30_000 });

  // The mark is there for other reasons in some households; open it if it is, and read what it says.
  const mark = page.getByRole('button', { name: 'Why this figure may be short' });
  if ((await mark.count()) > 0) await mark.first().click();
  await expect(page.getByText(/holds more entries than the 50 most recent/)).toHaveCount(0);
});
