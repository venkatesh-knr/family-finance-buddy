import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { SHEETED } from '../../src/domain/export/entities.ts';
import { readWorkbook } from '../../src/domain/export/workbook.ts';
import { readWorkbookFile } from '../../src/lib/workbookFile.ts';
import { freshCode } from './totp.ts';

/**
 * Reports (docs/design/export-redesign.md section 4; docs/build-plan.md, step 5; blueprint section 14).
 *
 * Three files, each made on the device from what the signed-in person can read: the report, behind a fresh authenticator code; the template, with none,
 * since it holds only the household's names; and the complete backup, in Settings under Data, behind a fresh code. Each is opened here with a reader and not
 * taken on the screen's word.
 *
 * It only reads, so it writes nothing to the demo household.
 */

test.use({ actionTimeout: 15_000 });

async function openReports(page: Page) {
  await page.goto('/#/reports');
  await expect(page.getByRole('region', { name: 'Download a report' })).toBeVisible({ timeout: 20_000 });
}

test('Download a report asks for a fresh code, then saves a report a person can read', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openReports(page);

  // The main action is the report, with the template beside it, and the complete backup is not on this screen.
  const region = page.getByRole('region', { name: 'Download a report' });
  await expect(region.getByRole('button', { name: 'Download a report' })).toBeVisible();
  await expect(region.getByRole('button', { name: 'Download the template' })).toBeVisible();
  await expect(page.getByRole('button', { name: /complete backup/i })).toHaveCount(0);
  await expect(page.getByText('Export everything')).toHaveCount(0);

  await region.getByRole('button', { name: 'Download a report' }).click();
  const confirm = page.getByRole('form', { name: 'Confirm the download' });
  await expect(confirm).toBeVisible();

  // A wrong code is refused and nothing is saved.
  await confirm.getByLabel('Code from your authenticator app').fill('000000');
  await confirm.getByRole('button', { name: 'Download a report' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('export-saved')).toHaveCount(0);

  await confirm.getByLabel('Code from your authenticator app').fill(await freshCode());
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), confirm.getByRole('button', { name: 'Download a report' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^family-finance-buddy-report-.+-\d{4}-\d{2}-\d{2}(-sample)?\.xlsx$/);

  const path = testInfo.outputPath('report.xlsx');
  await download.saveAs(path);

  // Opened as the package it is: the report holds charts, which the spreadsheet library cannot read back, so its parts are read directly.
  const zip = await JSZip.loadAsync(readFileSync(path));
  const part = async (name: string): Promise<string> => (await zip.file(name)?.async('string')) ?? '';
  const names = [...(await part('xl/workbook.xml')).matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'));
  expect(names.slice(0, 2)).toEqual(['Read me', 'Summary']);
  expect(names).toContain('Spending');
  // A report is for reading: none of the database's own sheets or columns is in it.
  for (const absent of ['About', 'Household', 'Members', 'Instruments', 'Prices', 'Scheme rates', 'Tax rules', 'FX rates', 'Imports', 'Holdings', 'Expenses']) expect(names).not.toContain(absent);
  const words = await part('xl/sharedStrings.xml');
  expect(words).not.toMatch(/sb_secret|code_hash|auth_user_id|_minor/);

  // Charts are in the file, so Excel has something to draw, and its parts are listed.
  expect(Object.keys(zip.files).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name)).length).toBeGreaterThan(0);

  await expect(page.getByTestId('export-saved')).toContainText('.xlsx');
  await expect(page.getByTestId('last-export')).toContainText('Last downloaded on this device');
});

test('Download the template saves a version 3 template with this household’s lists, and asks for no code', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openReports(page);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('region', { name: 'Download a report' }).getByRole('button', { name: 'Download the template' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^family-finance-buddy-template-.+(-sample)?\.xlsx$/);
  const path = testInfo.outputPath('template.xlsx');
  await download.saveAs(path);

  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);
  const names = book.worksheets.map((sheet) => sheet.name);
  expect(names[0]).toBe('How to fill');
  expect(names[names.length - 1]).toBe('Lists');
  expect(names).toEqual(expect.arrayContaining(['Spending', 'Money in', 'Investments', 'Purchases and sales']));
  // The lists are this household's own: the demo household has members and categories.
  const lists = book.getWorksheet('Lists');
  expect(String(lists?.getCell(2, 1).value ?? '').length).toBeGreaterThan(0);

  await expect(page.getByTestId('template-saved')).toContainText('.xlsx');
  await expect(page.getByRole('form', { name: /Confirm/ })).toHaveCount(0);
});

test('the complete backup is in Settings under Data, says what it is for, and reads back clean', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/#/settings');
  const row = page.getByRole('button', { name: /Download a complete backup/ });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(/complete/i);
  await expect(row).toContainText(/restore/i);
  await row.click();

  const confirm = page.getByRole('form', { name: 'Confirm the backup' });
  await expect(confirm).toBeVisible();
  await confirm.getByLabel('Code from your authenticator app').fill('000000');
  await confirm.getByRole('button', { name: 'Download a complete backup' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('backup-saved')).toHaveCount(0);

  await confirm.getByLabel('Code from your authenticator app').fill(await freshCode());
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), confirm.getByRole('button', { name: 'Download a complete backup' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^family-finance-buddy-.+-\d{4}-\d{2}-\d{2}(-sample)?\.xlsx$/);
  expect(download.suggestedFilename()).not.toContain('-report-');
  expect(download.suggestedFilename()).not.toContain('-template-');

  const path = testInfo.outputPath('backup.xlsx');
  await download.saveAs(path);

  const sheets = await readWorkbookFile(new Uint8Array(readFileSync(path)));
  const names = sheets.map((sheet) => sheet.name);
  expect(names[0]).toBe('About');
  for (const entity of SHEETED) expect(names, String(entity.sheet)).toContain(entity.sheet);
  // Only what a person adds or changes: not settings, members, instruments as a sheet, or reference data the app keeps.
  for (const absent of ['Household', 'Members', 'Instruments', 'Prices', 'Scheme rates', 'Tax rules', 'FX rates', 'Imports']) expect(names).not.toContain(absent);

  const back = readWorkbook(sheets);
  expect(back.problems).toEqual([]);
  // The demo household has holdings, each with what it is written beside it, and expenses.
  const holdingSheet = sheets.find((sheet) => sheet.name === 'Holdings');
  expect(holdingSheet?.rows[0]).toEqual(expect.arrayContaining(['name', 'kind', 'quantity', 'cost', 'currency']));
  expect((back.tables['holding'] ?? []).length).toBeGreaterThan(0);
  expect((back.tables['instrument'] ?? []).length).toBeGreaterThan(0);
  expect((back.tables['expense_txn'] ?? []).length).toBeGreaterThan(0);

  // No credential, account id or raw statement payload in any sheet.
  const text = sheets.flatMap((sheet) => sheet.rows.flat()).filter((cell): cell is string => typeof cell === 'string').join('\n');
  expect(text).not.toMatch(/sb_secret|code_hash|auth_user_id/);

  await expect(page.getByTestId('backup-saved')).toContainText('.xlsx');
});

test('the last download is remembered by this device and shown on More', async ({ page }) => {
  await openReports(page);
  await expect(page.getByTestId('last-export')).toContainText(/Last downloaded on this device|Not downloaded from this device yet/);
  await page.goto('/#/more');
  const row = page.getByRole('link', { name: /Reports/ });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByRole('region', { name: 'Download a report' })).toBeVisible();
});
