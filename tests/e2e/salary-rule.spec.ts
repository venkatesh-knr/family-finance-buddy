import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { testName } from './created.ts';
import { choiceField, choose, next } from './fields.ts';

/**
 * The salary rule (docs/design/ledger-income.md section 5; LI-I8, LI-I14): made from *Repeats every month* on Add money in, a credit that waits
 * in the Expected panel and counts nowhere until it is confirmed, confirmed, confirmed at another amount, passed over, and the rule paused.
 *
 * A rule is made from a credit dated the first of last month, so it first falls due on the first of this month and is expected today whatever
 * the day is. The suite's household is reset after every run, which removes the rules and credits these tests make.
 */

test.use({ actionTimeout: 15_000 });

/** The first of a month in India, `back` months before this one, as the form's date field takes it. */
function firstOfMonth(back: number): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const index = year * 12 + (month - 1) - back;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

async function onLedger(page: Page) {
  await page.goto('/#/money');
  await expect(page.getByRole('navigation', { name: 'Money' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: '+ Money in' })).toBeVisible({ timeout: 20_000 });
}

const expected = (page: Page) => page.getByRole('region', { name: 'Expected' });
const ruleForm = (page: Page, name: string) => page.getByRole('form', { name });

/** Enter a credit with *Repeats every month* on, save the rule it opens, and return the row it is expected as. */
async function makeRule(page: Page, payer: string, amount: string, monthsBack = 1) {
  await page.getByRole('button', { name: '+ Money in' }).click();
  const form = page.getByRole('form', { name: 'Add money in' });
  await form.getByLabel(/^Amount/).fill(amount);
  await form.getByLabel('Date it was credited').fill(firstOfMonth(monthsBack));
  await next(page);
  await form.getByLabel('From').fill(payer);
  await form.getByRole('switch', { name: 'Repeats every month' }).click();
  await form.getByRole('button', { name: 'Add credit' }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });

  // The rule form opens with what the credit had.
  const rule = ruleForm(page, 'Salary rule');
  await expect(rule).toBeVisible({ timeout: 20_000 });
  await expect(rule.getByLabel('Name')).toHaveValue(payer);
  await expect(choiceField(page, 'Payday')).toContainText('1st of the month');
  await rule.getByRole('button', { name: 'Save rule' }).click();
  await expect(rule).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Rule saved.' })).toBeVisible();

  const row = expected(page).getByRole('listitem').filter({ hasText: payer }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}

async function showAll(page: Page) {
  const seeAll = page.getByRole('button', { name: 'See all' });
  await expect(page.getByRole('region', { name: 'Recent expenses' })).toBeVisible({ timeout: 20_000 });
  if (await seeAll.isVisible()) await seeAll.click();
}

test('LI-I8 — a rule from a credit waits as Expected, counts nowhere, and Confirm writes one credit at its amount', async ({ page }) => {
  test.setTimeout(120_000);
  const payer = testName('rule-confirm');
  await onLedger(page);
  const row = await makeRule(page, payer, '50,000');
  await expect(row).toContainText('not counted yet');
  await expect(row).toContainText('₹50,000');
  await expect(row).toContainText('expected');

  // Not in the list of credits until it is confirmed: the first credit is last month's, and no credit is this month's.
  await showAll(page);
  const listed = page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row').filter({ hasText: payer });
  await expect(listed).toHaveCount(1);

  await row.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Confirmed ${payer}.` })).toBeVisible({ timeout: 20_000 });
  await expect(expected(page).getByRole('listitem').filter({ hasText: payer })).toHaveCount(0, { timeout: 20_000 });
  await showAll(page);
  await expect(listed).toHaveCount(2, { timeout: 20_000 });
});

test('Change amount confirms at what came in, and can change the rule’s usual amount from then on', async ({ page }) => {
  test.setTimeout(120_000);
  const payer = testName('rule-amount');
  await onLedger(page);
  const row = await makeRule(page, payer, '40,000');
  await row.getByRole('button', { name: 'Change amount' }).click();
  const form = page.getByRole('form', { name: 'Change amount' });
  await expect(form).toBeVisible();
  await expect(form.getByLabel(/^Amount that came in/)).toHaveValue('40000.00');
  // The day it was credited begins as the due date, which is the first of this month, and can be changed to the day it landed.
  await expect(form.getByLabel('Date it was credited')).toHaveValue(firstOfMonth(0));
  await expect(form.getByText('The rule said ₹40,000.')).toBeVisible();
  await form.getByLabel(/^Amount that came in/).fill('39,500');
  await form.getByLabel(/Use this amount from now on/).check();
  await form.getByRole('button', { name: 'Confirm' }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: 'at the amount that came in' })).toBeVisible();
  await expect(expected(page).getByRole('listitem').filter({ hasText: payer })).toHaveCount(0, { timeout: 20_000 });
  await showAll(page);
  await expect(page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row').filter({ hasText: payer }).first()).toContainText('+₹39,500');
});

test('Not this month writes nothing and the rule moves on', async ({ page }) => {
  test.setTimeout(120_000);
  const payer = testName('rule-pass');
  await onLedger(page);
  const row = await makeRule(page, payer, '30,000');
  await row.getByRole('button', { name: 'Not this month' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'marked not this month' })).toBeVisible({ timeout: 20_000 });
  await expect(expected(page).getByRole('listitem').filter({ hasText: payer })).toHaveCount(0, { timeout: 20_000 });
  await showAll(page);
  // Only last month's credit it was made from: nothing was written for this month.
  await expect(page.getByRole('region', { name: 'Recent expenses' }).locator('.recent-row').filter({ hasText: payer })).toHaveCount(1);
});

test('a rule is changed from its row, and a paused rule expects nothing', async ({ page }) => {
  test.setTimeout(120_000);
  const payer = testName('rule-pause');
  await onLedger(page);
  const row = await makeRule(page, payer, '20,000');
  await row.getByRole('button', { name: 'Change this rule' }).click();
  const form = ruleForm(page, 'Change a rule');
  await expect(form).toBeVisible();
  await expect(form.getByLabel(/^Usual amount/)).toHaveValue('20000.00');
  // The payday is a choice of the days 1 to 28, so that it falls in every month.
  await choose(page, 'Payday', '28th of the month');
  await expect(choiceField(page, 'Payday')).toContainText('28th of the month');
  await choose(page, 'Payday', /^1st of the month/);
  await form.getByRole('button', { name: 'Pause rule' }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Rule paused.' })).toBeVisible();
  await expect(expected(page).getByRole('listitem').filter({ hasText: /not counted yet/ }).filter({ hasText: payer })).toHaveCount(0, { timeout: 20_000 });

  // A paused rule is listed, with the way back: it can be resumed, and then it expects its due date again.
  const paused = expected(page).getByRole('list', { name: 'Paused rules' }).getByRole('listitem').filter({ hasText: payer });
  await expect(paused).toContainText('paused');
  await paused.getByRole('button', { name: 'Change this rule' }).click();
  await ruleForm(page, 'Change a rule').getByRole('button', { name: 'Resume rule' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rule resumed.' })).toBeVisible({ timeout: 20_000 });
  await expect(expected(page).getByRole('listitem').filter({ hasText: /not counted yet/ }).filter({ hasText: payer })).toBeVisible({ timeout: 20_000 });
});

test('LI-I8 — a rule behind by two months is acted on from its oldest date, and Archive asks first', async ({ page }) => {
  test.setTimeout(150_000);
  const payer = testName('rule-order');
  await onLedger(page);
  await makeRule(page, payer, '10,000', 2);
  const rows = expected(page).getByRole('listitem').filter({ hasText: payer });
  await expect(rows).toHaveCount(2);
  // Only the oldest has its actions; the later one waits and says so, so that no action reports success without doing anything.
  await expect(rows.nth(0).getByRole('button', { name: 'Confirm' })).toBeVisible();
  await expect(rows.nth(1).getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  await expect(rows.nth(1)).toContainText('earlier date first');
  await rows.nth(0).getByRole('button', { name: 'Confirm' }).click();
  await expect(rows).toHaveCount(1, { timeout: 20_000 });
  await expect(rows.nth(0).getByRole('button', { name: 'Confirm' })).toBeVisible();
  await expect(rows.nth(0).getByRole('button', { name: 'Confirm' })).toBeEnabled();

  // Archive asks first, and Keep it leaves the rule as it was.
  await rows.nth(0).getByRole('button', { name: 'Change this rule' }).click();
  const form = ruleForm(page, 'Change a rule');
  await form.getByRole('button', { name: 'Archive rule' }).click();
  await expect(form.getByText('Archive this rule?')).toBeVisible();
  await form.getByRole('button', { name: 'Keep it' }).click();
  await expect(form.getByRole('button', { name: 'Archive rule' })).toBeVisible();
  await form.getByRole('button', { name: 'Archive rule' }).click();
  await form.getByRole('button', { name: 'Yes, archive it' }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Rule archived.' })).toBeVisible();
  await expect(rows).toHaveCount(0, { timeout: 20_000 });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Expected and the rule form have no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await onLedger(page);
    const row = await makeRule(page, testName(`rule-axe-${scheme}`), '10,000');
    await expect(row).toBeVisible();
    const panel = await new AxeBuilder({ page }).analyze();
    const foundPanel = panel.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(foundPanel, foundPanel.join('\n')).toEqual([]);

    await row.getByRole('button', { name: 'Change this rule' }).click();
    await expect(ruleForm(page, 'Change a rule')).toBeVisible();
    const result = await new AxeBuilder({ page }).analyze();
    const found = result.violations.map((v) => `${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    expect(found, found.join('\n')).toEqual([]);
  });
}
