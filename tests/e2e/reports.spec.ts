import { test, expect, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';
import { readFileSync } from 'node:fs';
import { ENTITIES } from '../../src/domain/export/entities.ts';
import { readWorkbook } from '../../src/domain/export/workbook.ts';
import { readWorkbookFile } from '../../src/lib/workbookFile.ts';

/**
 * Reports: Export everything makes a workbook on the device from what the signed-in person can read, behind a fresh
 * authenticator code, and the file reads back with no problems (docs/build-plan.md, step 5; blueprint section 14).
 *
 * It only reads, so it writes nothing to the demo household. The file is opened in the spec with the same reader the upload
 * will use, so what is checked is the file and not the screen's claim about it.
 */

test.use({ actionTimeout: 15_000 });

let lastWindow = -1;

/** A code for the current 30-second window, waiting for the next if this worker has already used the current one. */
async function freshCode(): Promise<string> {
  const secret = process.env['E2E_TOTP_SECRET'];
  if (!secret) throw new Error('E2E_TOTP_SECRET must be set (tests/e2e/README.md).');
  const window = () => Math.floor(Date.now() / 30_000);
  while (window() === lastWindow) await new Promise((resolve) => setTimeout(resolve, 1_000));
  lastWindow = window();
  return new TOTP({ secret, digits: 6, period: 30 }).generate();
}

async function openReports(page: Page) {
  await page.goto('/#/reports');
  await expect(page.getByRole('region', { name: 'Export everything' })).toBeVisible({ timeout: 20_000 });
}

test('Export everything asks for a fresh code, then saves a workbook that reads back clean', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openReports(page);

  await page.getByRole('button', { name: 'Export everything · Excel' }).click();
  const confirm = page.getByRole('form', { name: 'Confirm the export' });
  await expect(confirm).toBeVisible();

  // A wrong code is refused and nothing is saved.
  await confirm.getByLabel('Code from your authenticator app').fill('000000');
  await confirm.getByRole('button', { name: 'Export everything · Excel' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('export-saved')).toHaveCount(0);

  await confirm.getByLabel('Code from your authenticator app').fill(await freshCode());
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), confirm.getByRole('button', { name: 'Export everything · Excel' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^family-finance-buddy-.+-\d{4}-\d{2}-\d{2}(-sample)?\.xlsx$/);

  const path = testInfo.outputPath('export.xlsx');
  await download.saveAs(path);

  const sheets = await readWorkbookFile(new Uint8Array(readFileSync(path)));
  const names = sheets.map((sheet) => sheet.name);
  expect(names[0]).toBe('About');
  for (const entity of ENTITIES) expect(names, entity.sheet).toContain(entity.sheet);

  const back = readWorkbook(sheets);
  expect(back.problems).toEqual([]);
  // The demo household has members, holdings and expenses, and the household row is the one that was open.
  expect(back.tables['household']).toHaveLength(1);
  expect((back.tables['member'] ?? []).length).toBeGreaterThan(0);
  expect((back.tables['holding'] ?? []).length).toBeGreaterThan(0);
  expect((back.tables['expense_txn'] ?? []).length).toBeGreaterThan(0);

  // The household is the one this session is in, and nothing in the file belongs to another.
  const householdId = back.tables['household']?.[0]?.['id'];
  for (const entity of ENTITIES) {
    if (entity.scope !== 'household' || entity.key === 'household') continue;
    for (const row of back.tables[entity.key] ?? []) expect(row['household_id'], entity.key).toBe(householdId);
  }

  // No credential, account id or raw statement payload in any sheet.
  const text = sheets.flatMap((sheet) => sheet.rows.flat()).filter((cell): cell is string => typeof cell === 'string').join('\n');
  expect(text).not.toMatch(/sb_secret|code_hash|auth_user_id/);

  await expect(page.getByTestId('export-saved')).toContainText('.xlsx');
  await expect(page.getByTestId('last-export')).toContainText('Last exported on this device');
});

test('the last export is remembered by this device and shown on More', async ({ page }) => {
  await openReports(page);
  await expect(page.getByTestId('last-export')).toContainText(/Last exported on this device|Not exported from this device yet/);
  await page.goto('/#/more');
  const row = page.getByRole('link', { name: /Reports/ });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByRole('region', { name: 'Export everything' })).toBeVisible();
});
