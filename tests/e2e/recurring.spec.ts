import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { testName } from './created.ts';

/**
 * Recurring rules: what recurs is listed on Settings, added there, and entered once per due date when an owner or a partner opens the
 * app (docs/design/spending-capture.md section 3; SC-I10). The demo household has two rules that are not yet due.
 *
 * The suite's household is reset after every run, which removes the rule and the entry it made.
 */

test.use({ actionTimeout: 15_000 });

/** The first day of the current month in India: a day from 1 to 28, and one that has come. */
function firstOfMonth(): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return `${today.slice(0, 8)}01`;
}

async function onSettings(page: Page) {
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: 'Recurring' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
}

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

/**
 * How many entries a rule has made under a name, counted through the same API the app uses, as the signed-in member. The Expenses list
 * holds only the 50 newest entries, and a household another spec has filled holds more than that dated later than the 1st.
 */
async function entriesMadeBy(page: Page, name: string): Promise<number> {
  const token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        return (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token ?? '';
      }
    }
    return '';
  });
  expect(token, 'a signed-in session').not.toBe('');
  const { url, key } = bundleEnv();
  const response = await page.request.get(
    `${url}/rest/v1/expense_txn?payee=eq.${encodeURIComponent(name)}&captured_via=eq.rule&voided_at=is.null&select=id`,
    { headers: { apikey: key, authorization: `Bearer ${token}` } },
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as unknown[]).length;
}

/** A fresh load, so the poster runs as it does when the app is opened. */
async function openedAgain(page: Page, hash: string) {
  await page.goto('about:blank');
  await page.goto(`/#${hash}`);
}

test('the demo rules are listed with what each comes to and when it next falls due', async ({ page }) => {
  await onSettings(page);
  const school = page.getByRole('listitem').filter({ hasText: 'School fee' }).first();
  await expect(school).toBeVisible({ timeout: 20_000 });
  await expect(school).toContainText('a quarter');
  await expect(school).toContainText('Next');
  await expect(school).toContainText('a year');
  await expect(page.getByRole('listitem').filter({ hasText: 'Milk delivery' }).first()).toContainText('a month');
});

test('a rule is added, enters its due day once however often the app is opened, and can be paused and archived', async ({ page }) => {
  test.setTimeout(240_000);
  const name = testName('rule');
  await onSettings(page);

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const form = page.getByRole('form', { name: 'Add a recurring entry' });
  await expect(form).toBeVisible();
  await form.getByLabel('What recurs').fill(name);
  await form.getByLabel('Amount (INR)').fill('1234.50');
  await form.getByLabel('First falls due').fill(firstOfMonth());
  await form.getByRole('button', { name: 'Add', exact: true }).click();

  const row = page.getByRole('listitem').filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('1,234.50');
  // Its day has come, so adding it enters that day at once, and the rule moves on to the next.
  await expect(row).toContainText('Next', { timeout: 20_000 });
  await expect(row).not.toContainText('Fell due');

  // Opening the app again makes no second entry for the day that was entered.
  for (const _ of [1, 2]) {
    await openedAgain(page, 'expenses');
    await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/^(Loading|Reading)…$/)).toHaveCount(0, { timeout: 20_000 });
    // However often the app is opened, the day is entered once (SC-I10).
    await expect.poll(() => entriesMadeBy(page, name), { timeout: 20_000 }).toBe(1);
  }

  // The rule has moved on to the next due day, and pausing it stops anything more being entered.
  await onSettings(page);
  const after = page.getByRole('listitem').filter({ hasText: name }).first();
  await expect(after).toContainText('Next');
  await page.getByRole('button', { name: `Pause ${name}` }).click();
  await expect(after).toContainText('Paused: nothing is entered');
  await page.getByRole('button', { name: `Resume ${name}` }).click();
  await expect(after).not.toContainText('Paused');

  // A day earlier than the next one is refused: it could enter a period that was already entered.
  await page.getByRole('button', { name: `Change ${name}` }).click();
  const change = page.getByRole('form', { name: `Change ${name}` });
  const nextDue = await change.getByLabel('Next falls due').inputValue();
  await change.getByLabel('Next falls due').fill(firstOfMonth());
  await change.getByRole('button', { name: 'Save' }).click();
  await expect(change.getByRole('alert')).toContainText('moved later and not earlier');
  await change.getByLabel('Next falls due').fill(nextDue);

  // An amount is changed in place; what was entered stays as it was.
  await change.getByLabel('Amount (INR)').fill('1500');
  await change.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name }).first()).toContainText('1,500');

  // Archived, never deleted: it leaves the list and is kept under Archived.
  await page.getByRole('button', { name: `Archive ${name}` }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
  await page.getByRole('button', { name: /^Archived \(/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
});

test('a rule refuses a day past the 28th, and an amount of nothing', async ({ page }) => {
  await onSettings(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const form = page.getByRole('form', { name: 'Add a recurring entry' });
  await form.getByLabel('What recurs').fill('e2e-refused');
  await form.getByLabel('Amount (INR)').fill('0');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('above nothing');

  await form.getByLabel('Amount (INR)').fill('100');
  await form.getByLabel('First falls due').fill('2026-12-31');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('1 to 28');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the recurring section has no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await onSettings(page);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Add a recurring entry' })).toBeVisible();
    const result = await new AxeBuilder({ page }).analyze();
    const found = result.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(found, found.join('\n')).toEqual([]);
  });
}
