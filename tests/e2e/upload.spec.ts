import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { readWorkbookFile } from '../../src/lib/workbookFile.ts';
import { freshCode } from './totp.ts';

/**
 * Upload: the gate of step 5 (docs/build-plan.md): export the household, edit rows in Excel, upload the file back, and land in the
 * state the edits describe; upload the same file again and nothing is written twice; reverse the upload and the household is as it
 * was. It runs against the demo household and puts it back by the reversal, and the run's teardown resets it besides.
 *
 * The workbook is edited here with the same library the app uses to write one, on the file the app made, so what is proved is the
 * round trip through a real .xlsx and not a model of one.
 */

test.use({ actionTimeout: 20_000 });

type Cell = string | number | boolean | Date | null;

async function openReports(page: Page) {
  await page.goto('/#/reports');
  await expect(page.getByRole('region', { name: 'Export everything' })).toBeVisible({ timeout: 20_000 });
}

async function exportWorkbook(page: Page, path: string) {
  await page.getByRole('button', { name: 'Export everything · Excel' }).click();
  const form = page.getByRole('form', { name: 'Confirm the export' });
  await form.getByLabel('Code from your authenticator app').fill(await freshCode());
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), form.getByRole('button', { name: 'Export everything · Excel' }).click()]);
  await download.saveAs(path);
}

/** The exported file, edited: three expenses given a note, and two new ones with a reference of their own. */
async function edited(from: string, to: string): Promise<void> {
  const sheets = await readWorkbookFile(new Uint8Array(readFileSync(from)));
  const expenses = sheets.find((sheet) => sheet.name === 'Expenses');
  if (expenses === undefined) throw new Error('no Expenses sheet');
  const headers = (expenses.rows[0] ?? []).map(String);
  const at = (name: string) => headers.indexOf(name);
  const data = expenses.rows.slice(1);
  expect(data.length, 'the demo household has expenses to edit').toBeGreaterThanOrEqual(3);

  for (let index = 0; index < 3; index += 1) (data[index] as Cell[])[at('note')] = `e2e-edited-${String(index)}`;
  const first = data[0] as Cell[];
  for (const n of [1, 2]) {
    const row: Cell[] = headers.map(() => null);
    row[at('ref')] = `e2e-up-${String(n)}`;
    row[at('member_name')] = first[at('member_name')] ?? null;
    row[at('category_name')] = first[at('category_name')] ?? null;
    row[at('txn_date')] = '2026-10-30';
    row[at('amount')] = 10 + n;
    row[at('currency')] = 'INR';
    row[at('payee')] = `e2e-upload-${String(n)}`;
    row[at('method')] = 'upi';
    row[at('visibility')] = 'household';
    data.push(row);
  }
  expenses.rows.splice(1, expenses.rows.length - 1, ...data);

  const book = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = book.addWorksheet(sheet.name);
    for (const row of sheet.rows) worksheet.addRow(row);
  }
  await book.xlsx.writeFile(to);
}

async function choose(page: Page, path: string) {
  await page.locator('#upload-file').setInputFiles(path);
  await expect(page.getByTestId('upload-preview')).toBeVisible({ timeout: 60_000 });
}

test('export, edit, upload: it says what it will do, writes it, writes nothing the second time, and reverses cleanly', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const original = testInfo.outputPath('household.xlsx');
  const changed = testInfo.outputPath('household-edited.xlsx');

  await openReports(page);
  await exportWorkbook(page, original);
  await edited(original, changed);

  // The preview says what the file would do, and nothing is written yet.
  await choose(page, changed);
  await expect(page.getByTestId('upload-problems')).toHaveCount(0);
  await expect(page.getByTestId('upload-add')).toHaveText('2');
  await expect(page.getByTestId('upload-change')).toHaveText('3');
  await expect(page.getByTestId('upload-preview')).toContainText('What changes (3)');

  // Written: all of it, once.
  const confirm = page.getByRole('form', { name: 'Confirm the upload' });
  await confirm.getByLabel('Code from your authenticator app').fill(await freshCode());
  await confirm.getByRole('button', { name: 'Add 2 and change 3' }).click();
  await expect(page.getByTestId('upload-done')).toContainText('2 added and 3 changed', { timeout: 60_000 });
  await expect(page.getByTestId('upload-list')).toContainText(/household-edited\.xlsx/);

  // The same file again: the references lead to the rows the first upload made, so nothing is added twice and nothing has changed.
  await choose(page, changed);
  await expect(page.getByTestId('upload-nothing')).toBeVisible({ timeout: 30_000 });

  // Reversed, as a unit: what it changed is put back and what it added is gone.
  await page.getByTestId('upload-list').getByRole('button', { name: 'Reverse', exact: true }).first().click();
  const reverse = page.getByRole('form', { name: 'Confirm the reversal' });
  await reverse.getByLabel('Code from your authenticator app').fill(await freshCode());
  await reverse.getByRole('button', { name: 'Reverse this upload' }).click();
  await expect(page.getByTestId('upload-done')).toContainText('3 put back as they were and 2 removed', { timeout: 60_000 });

  // And the household is as it was: the same file asks for the same two additions and three changes again.
  await choose(page, changed);
  await expect(page.getByTestId('upload-add')).toHaveText('2');
  await expect(page.getByTestId('upload-change')).toHaveText('3');
});

test('a workbook with a cell that is wrong is refused before anything is written, naming the sheet, row and column', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const original = testInfo.outputPath('household.xlsx');
  const broken = testInfo.outputPath('household-broken.xlsx');

  await openReports(page);
  await exportWorkbook(page, original);

  const sheets = await readWorkbookFile(new Uint8Array(readFileSync(original)));
  const expenses = sheets.find((sheet) => sheet.name === 'Expenses');
  const headers = (expenses?.rows[0] ?? []).map(String);
  (expenses?.rows[1] as Cell[])[headers.indexOf('txn_date')] = '30/10/2026';
  (expenses?.rows[2] as Cell[])[headers.indexOf('category_name')] = 'A category nobody has made';
  (expenses?.rows[2] as Cell[])[headers.indexOf('category_id')] = null;
  const book = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = book.addWorksheet(sheet.name);
    for (const row of sheet.rows) worksheet.addRow(row);
  }
  await book.xlsx.writeFile(broken);

  await choose(page, broken);
  const problems = page.getByTestId('upload-problems');
  await expect(problems).toContainText('Expenses, row 2, txn_date');
  await expect(problems).toContainText('YYYY-MM-DD');
  // Nothing can be confirmed while there is a problem.
  await expect(page.getByRole('form', { name: 'Confirm the upload' })).toHaveCount(0);
});
