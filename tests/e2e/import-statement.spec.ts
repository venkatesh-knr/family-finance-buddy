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
    row('18/09/26', `SALARY CREDIT E2E ${String(run)}`, '0.00', '5000.00', `SAL${String(run).slice(-6)}`, '103543.22'),
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

  // Two payments to add. A debit to a fund house is left out as a guess, shown unfolded and apart from what is left out for certain, and can be overruled; money in is left out for certain.
  await expect(page.getByTestId('statement-summary')).toContainText('2 to add as expenses');
  await expect(page.getByTestId('statement-summary')).toContainText('2 left out');
  const guess = page.getByTestId('statement-group-guess');
  await expect(guess).toContainText('Looks like money put into an investment');
  const left = page.getByTestId('statement-group-left');
  await left.locator('summary').click();
  await expect(left).toContainText('Money in. Money in is added from the Money screen');

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
  await expect(page.getByText('Imported: 3 expenses added.')).toBeVisible({ timeout: 60_000 });

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
  // The three that were written are recognised by their hashes. Money in was never written, so it is still money in.
  await expect(page.getByText('Already imported from this statement.')).toHaveCount(3);
  await expect(page.getByTestId('statement-group-left')).toContainText('Money in. Money in is added from the Money screen');
  await expect(next(page)).toBeDisabled();
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
    await page.getByTestId('statement-group-left').locator('summary').click();
    await scan('what it will do');
    expect(found, found.join('\n')).toEqual([]);
  });
}
