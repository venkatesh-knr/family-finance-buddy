import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { freshCode } from './totp.ts';

/**
 * Import a statement (docs/design/spending-capture.md sections 3 and 4; docs/build-plan.md step 7): the Money screen's way to bring spending in from a bank, a card or Google Pay.
 *
 * The statements here are synthetic files in HDFC's delimited layout, with a reference and a narration made for the run, so nothing of a household's is in them and a run never
 * collides with an earlier one. The run's teardown resets the demo household, which clears what is imported here.
 */

test.use({ actionTimeout: 20_000 });

/** Rupees as the statement prints them, from paise: 5,012.34 as 5012.34 and, with grouping, 54,876.55. */
const plain = (minor: bigint): string => `${String(minor / 100n)}.${String(minor % 100n).padStart(2, '0')}`;
const grouped = (minor: bigint): string => `${(minor / 100n).toLocaleString('en-US')}.${String(minor % 100n).padStart(2, '0')}`;
/** A credit whose amount differs from one run to the next, so that a credit an earlier run left is not mistaken for this one's, which the import rightly offers as a guess. */
const salaryOf = (run: number): bigint => 500_000n + BigInt(run % 9000);

/** A statement of four lines: two UPI payments, a debit to a fund house (a guess that it is not an expense), and money in. */
function statement(run: number): { readonly name: string; readonly mimeType: string; readonly buffer: Buffer } {
  const base = BigInt(run) * 10n;
  const ref = (n: bigint): string => String(base + n).padStart(12, '0').slice(-12);
  const header = '  Date     ,Narration                                                                  ,Value Dat,Debit Amount       ,Credit Amount      ,Chq/Ref Number  ,Closing Balance  ';
  const row = (date: string, narration: string, debit: string, credit: string, reference: string, balance: string): string =>
    ` ${date}  ,${narration.padEnd(70)} ,${date} ,${debit.padStart(14)}     ,${credit.padStart(14)}     ,${reference},${balance}  `;
  const text = [
    '',
    header,
    row('15/09/26', `UPI-E2ESHOPONE-E2ESHOP1@OKBANK-ABCD0000001-${ref(1n)}-NOTE`, '123.45', '0.00', `0000${ref(1n)}`, '100000.00'),
    row('16/09/26', `UPI-E2ESHOPTWO-E2ESHOP2@OKBANK-ABCD0000001-${ref(2n)}-NOTE`, '456.78', '0.00', `0000${ref(2n)}`, '99543.22'),
    row('17/09/26', `ACH D- INDMONEY MUTUAL FUND-${String(run)}`, '1000.00', '0.00', `ACH${String(run).slice(-6)}`, '98543.22'),
    row('18/09/26', `SALARY CREDIT E2E ${String(run)}`, '0.00', plain(salaryOf(run)), `SAL${String(run).slice(-6)}`, plain(9_854_322n + salaryOf(run))),
    '',
  ].join('\n');
  return { name: 'statement.txt', mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') };
}

async function openImport(page: Page) {
  await page.goto('/#/money');
  const button = page.getByRole('button', { name: 'Import a statement' });
  await expect(button).toBeVisible({ timeout: 20_000 });
  await button.click();
  await expect(page.getByRole('form', { name: 'Import a statement' })).toBeVisible();
}

const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });

test('a file that is not a statement is said not to be one, and nothing can go on from it', async ({ page }) => {
  test.setTimeout(120_000);
  await openImport(page);
  await page.setInputFiles('#statement-file', { name: 'letter.txt', mimeType: 'text/plain', buffer: Buffer.from('hello, this is a letter', 'utf8') });
  await expect(page.getByRole('alert')).toContainText('not a statement the app reads');
  await expect(next(page)).toBeDisabled();
});

test('a statement is read, every line says what it will do and can be changed, and what is written is not written twice', async ({ page }) => {
  test.setTimeout(240_000);
  const run = Date.now();
  await openImport(page);
  await page.setInputFiles('#statement-file', statement(run));
  await expect(page.getByTestId('statement-read')).toContainText('Read 4 lines from an HDFC delimited file.');
  await next(page).click();

  // Two payments to add, and the salary as money in. A debit to a fund house is left out as a guess, shown unfolded and apart from what is left out for certain, and can be overruled.
  await expect(page.getByTestId('statement-summary')).toContainText('2 to add as expenses');
  await expect(page.getByTestId('statement-summary')).toContainText('1 to add as money in');
  await expect(page.getByTestId('statement-summary')).toContainText('1 left out');
  const guess = page.getByTestId('statement-group-guess');
  await expect(guess).toContainText('Looks like money put into an investment');

  // Money in is filed under a credit category, guessed from its words, which can be changed.
  const money = page.getByTestId('statement-group-add').getByRole('listitem').filter({ hasText: 'SALARY CREDIT' });
  await expect(money).toContainText('Add as money in');
  await expect(money.getByLabel('Category')).toHaveValue('salary');
  await money.getByLabel('Category').selectOption({ label: 'Other income' });
  await expect(money.getByLabel('Category')).toHaveValue('other_income');

  // Each payment to add can be filed, and says so when a category is only a suggestion.
  const add = page.getByTestId('statement-group-add');
  await expect(add.getByLabel('Category').first()).toBeVisible();
  expect(await add.getByLabel('Category').first().locator('option').count()).toBeGreaterThan(1);
  await expect(add.getByLabel('Category').first().locator('option').first()).toHaveText('No category');

  await guess.getByLabel('What to do').selectOption({ label: 'Add as an expense' });
  await expect(page.getByTestId('statement-summary')).toContainText('3 to add as expenses');

  await next(page).click();
  await page.getByLabel('Code from your authenticator app').fill(await freshCode());
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Imported: 3 expenses added, 1 money in added.')).toBeVisible({ timeout: 60_000 });

  // The same file again: every line is recognised, nothing is offered, and nothing can be imported.
  await openImport(page);
  await page.setInputFiles('#statement-file', statement(run));
  await expect(page.getByTestId('statement-read')).toBeVisible();
  await next(page).click();
  await expect(page.getByTestId('statement-summary')).toContainText('0 to add as expenses');
  await expect(page.getByTestId('statement-summary')).toContainText('4 left out');
  // Nothing can be imported, and it says so in words and not only with a button that is off.
  await expect(page.getByTestId('statement-nothing')).toContainText('there is nothing to import');
  await page.getByTestId('statement-group-left').locator('summary').click();
  // The four that were written, the money in among them, are recognised by their hashes.
  await expect(page.getByText('Already imported from this statement.')).toHaveCount(4);
  await expect(next(page)).toBeDisabled();
});

/** The printed HDFC statement of one account, with its number and period, so that the balances it states can be read. */
function printedStatement(run: number): { readonly name: string; readonly mimeType: string; readonly buffer: Buffer } {
  const widths = [8, 40, 16, 8, 18, 18, 18] as const;
  const fixed = (cells: readonly string[]): string => cells.map((cell, i) => (i >= 4 ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0))).join('  ');
  const ref = String(run * 10).padStart(12, '0').slice(-12);
  const text = [
    'HDFC BANK Ltd.                                     Page No .:   1                                        Statement of accounts',
    '',
    '                                                                         Account No     : 50100000007391   PB Customer',
    'Statement From      : 01/08/2026  To: 31/08/2026                         RTGS/NEFT IFSC : HDFC0000001    MICR : 560000000',
    '',
    widths.map((w) => '-'.repeat(w)).join('  '),
    'Date      Narration                                 Chq./Ref.No.      Value Dt  Withdrawal Amt.        Deposit Amt.     Closing Balance',
    widths.map((w) => '-'.repeat(w)).join('  '),
    '',
    fixed(['05/08/26', `UPI-E2EPRINTED-E2EPRINT@OKBANK-ABCD0000001-${ref}-NOTE`.slice(0, 40), `0000${ref}`, '05/08/26', '123.45', '', '49,876.55']),
    fixed(['', `UPI-E2EPRINTED-E2EPRINT@OKBANK-ABCD0000001-${ref}-NOTE`.slice(40, 80), '', '', '', '', '']),
    fixed(['20/08/26', `SALARY CREDIT E2E ${String(run)}`.slice(0, 40), `SAL${String(run).slice(-6)}`, '20/08/26', '', grouped(salaryOf(run)), grouped(4_987_655n + salaryOf(run))]),
    '',
    widths.map((w) => '*'.repeat(w)).join('  '),
  ].join('\n');
  return { name: 'printed.txt', mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') };
}

test('a statement that states its balances shows them, and records them for the month close', async ({ page }) => {
  test.setTimeout(240_000);
  const run = Date.now();
  await openImport(page);
  await page.setInputFiles('#statement-file', printedStatement(run));
  await expect(page.getByTestId('statement-read')).toContainText('Read 2 lines');
  await next(page).click();

  // The balance on its last day, and on the day before it begins (worked back from its first line), are shown before anything is written.
  const balances = page.getByTestId('statement-balances');
  await expect(balances).toContainText('Balances the statement states');
  await expect(balances).toContainText(grouped(4_987_655n + salaryOf(run)).slice(0, -3));
  await expect(balances).toContainText('31 Jul: ₹50,000');
  await expect(balances).toContainText('••7391');

  await next(page).click();
  await page.getByLabel('Code from your authenticator app').fill(await freshCode());
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Imported: 1 expense added, 1 money in added.*2 balances recorded/)).toBeVisible({ timeout: 60_000 });
});

/** An amount that differs from one run to the next, so that a move an earlier run left is not mistaken for this one's. */
const moveOf = (run: number): bigint => 700_000n + BigInt(run % 9000);

/** The printed HDFC statement of an account with one line on it: a debit or a credit of the move, with a narration that says nothing of what it is. */
function printedMove(run: number, account: string, direction: 'debit' | 'credit'): { readonly name: string; readonly mimeType: string; readonly buffer: Buffer } {
  const widths = [8, 40, 16, 8, 18, 18, 18] as const;
  const fixed = (cells: readonly string[]): string => cells.map((cell, i) => (i >= 4 ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0))).join('  ');
  const amount = grouped(moveOf(run));
  const text = [
    'HDFC BANK Ltd.                                     Page No .:   1                                        Statement of accounts',
    '',
    `                                                                         Account No     : 501000000${account}   PB Customer`,
    'Statement From      : 01/08/2026  To: 31/08/2026                         RTGS/NEFT IFSC : HDFC0000001    MICR : 560000000',
    '',
    widths.map((w) => '-'.repeat(w)).join('  '),
    'Date      Narration                                 Chq./Ref.No.      Value Dt  Withdrawal Amt.        Deposit Amt.     Closing Balance',
    widths.map((w) => '-'.repeat(w)).join('  '),
    '',
    fixed(['10/08/26', `NEFT ${direction === 'debit' ? 'DR' : 'CR'}-E2E MOVE ${String(run)}`.slice(0, 40), `MOV${String(run).slice(-6)}`, '10/08/26', direction === 'debit' ? amount : '', direction === 'credit' ? amount : '', '100,000.00']),
    '',
    widths.map((w) => '*'.repeat(w)).join('  '),
  ].join('\n');
  return { name: `move-${account}.txt`, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') };
}

test('two statements read together offer a move between the household’s own accounts, written once and not again', async ({ page }) => {
  test.setTimeout(300_000);
  const run = Date.now();
  await openImport(page);
  await page.setInputFiles('#statement-file', [printedMove(run, '6101', 'debit'), printedMove(run, '6102', 'credit')]);
  await expect(page.getByTestId('statement-read')).toHaveCount(2);
  await expect(page.getByTestId('statement-read').first()).toContainText('••6101');
  await next(page).click();

  // The debit of one and the credit of the other are one move, not an expense and money in.
  await expect(page.getByTestId('statement-summary')).toContainText('0 to add as expenses');
  await expect(page.getByTestId('statement-summary')).toContainText('1 to add as a move between your accounts');
  const add = page.getByTestId('statement-group-add').getByRole('listitem');
  await expect(add).toHaveCount(1);
  await expect(add).toContainText('A move from ••6101 to ••6102');
  await expect(add).toContainText('HDFC statement ••6101');
  // The other half is folded away, and says it is counted once.
  await page.getByTestId('statement-group-left').locator('summary').click();
  await expect(page.getByTestId('statement-group-left')).toContainText('counted once, as a move');

  // Saying it is not a move puts the two lines back to what they looked like.
  await add.getByLabel('What to do').selectOption({ label: 'Add as an expense' });
  await expect(page.getByTestId('statement-summary')).toContainText('1 to add as expenses');
  await expect(page.getByTestId('statement-summary')).toContainText('1 to add as money in');
  await page.getByTestId('statement-group-add').getByRole('listitem').filter({ hasText: 'NEFT DR' }).getByLabel('What to do').selectOption({ label: 'Add as a move between your accounts' });
  await expect(page.getByTestId('statement-summary')).toContainText('1 to add as a move between your accounts');

  await next(page).click();
  await page.getByLabel('Code from your authenticator app').fill(await freshCode());
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Imported: 0 expenses added, 1 move between your accounts added/)).toBeVisible({ timeout: 90_000 });

  // The same two files again: the debit is recognised by its hash and the credit by the move into its account, so nothing is offered.
  await openImport(page);
  await page.setInputFiles('#statement-file', [printedMove(run, '6101', 'debit'), printedMove(run, '6102', 'credit')]);
  await expect(page.getByTestId('statement-read')).toHaveCount(2);
  await next(page).click();
  await expect(page.getByTestId('statement-summary')).toContainText('0 to add as expenses');
  await expect(page.getByTestId('statement-nothing')).toBeVisible();
  await expect(page.getByTestId('statement-group-guess')).toContainText('Already recorded as a move between your own accounts');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the import has no accessibility violations in the ${scheme} theme`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme });
    await openImport(page);
    const found: string[] = [];
    const scan = async (where: string) => {
      const result = await new AxeBuilder({ page }).analyze();
      for (const v of result.violations) found.push(`${where} · ${v.id}: ${String(v.nodes.length)} · ${v.nodes[0]?.html.slice(0, 110) ?? ''}`);
    };
    await scan('choosing the statement');
    await page.setInputFiles('#statement-file', statement(Date.now() + (scheme === 'dark' ? 7 : 0)));
    await expect(page.getByTestId('statement-read')).toBeVisible();
    await next(page).click();
    await scan('what it will do');
    expect(found, found.join('\n')).toEqual([]);
  });
}
