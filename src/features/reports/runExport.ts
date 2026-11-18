import { buildReport } from '../../domain/export/report.ts';
import { buildBackup, type Problem } from '../../domain/export/workbook.ts';
import { istCalendarDate } from '../../lib/dates.ts';
import { saveFile, writeWorkbookFile, XLSX_MIME } from '../../lib/workbookFile.ts';
import { verifyTotpCode } from '../../repo/auth.ts';
import { readEverything } from '../../repo/export.ts';
import { readForReport } from '../../repo/reportRead.ts';
import { writeReportFile } from '../../lib/reportFile.ts';
import { exportFilename, reportFilename, rememberExport } from './exportFile.ts';

/** The export did not produce a file because something in the data cannot be written to a spreadsheet exactly. */
export class ExportBlocked extends Error {
  readonly problems: readonly Problem[];

  constructor(problems: readonly Problem[]) {
    super('The export was stopped: some figures cannot be written to a spreadsheet exactly.');
    this.name = 'ExportBlocked';
    this.problems = problems;
  }
}

/**
 * The full export: a fresh authenticator code, everything the caller may read, the workbook, the file saved by the browser.
 *
 * The code comes first because an export is a sensitive action (docs/design/trust-and-security.md): a device left unlocked should
 * not be enough to take the household's whole record. Everything after it happens on this device; nothing is uploaded.
 */
export async function runBackup(householdId: string, code: string): Promise<{ readonly filename: string; readonly exportedAt: string }> {
  await verifyTotpCode(code);
  const source = await readEverything(householdId);
  const exportedAt = new Date().toISOString();
  const { workbook, problems } = buildBackup(
    source.tables,
    { exportedAt, householdName: source.householdName, baseCurrency: source.baseCurrency, demo: source.isDemo },
    source.refs,
  );
  if (problems.length > 0) throw new ExportBlocked(problems);

  const bytes = await writeWorkbookFile(workbook.sheets, { sample: source.isDemo });
  const filename = exportFilename(source.householdName, istCalendarDate(new Date(exportedAt)), source.isDemo);
  saveFile(bytes, filename, XLSX_MIME);
  rememberExport(householdId, exportedAt);
  return { filename, exportedAt };
}

/**
 * The report (docs/design/export-redesign.md section 2): the household's figures in sheets a person reads, made on this device from what the signed-in
 * person can already read. A fresh authenticator code first, as for the backup: a report takes the household's figures out of the app too.
 */
export async function runReport(householdId: string, code: string): Promise<{ readonly filename: string; readonly exportedAt: string }> {
  await verifyTotpCode(code);
  const source = await readForReport(householdId);
  const exportedAt = new Date().toISOString();
  const report = buildReport(source.tables, { exportedAt, householdName: source.householdName, demo: source.isDemo });
  const bytes = await writeReportFile(report, { householdName: source.householdName });
  const filename = reportFilename(source.householdName, istCalendarDate(new Date(exportedAt)), source.isDemo);
  saveFile(bytes, filename, XLSX_MIME);
  return { filename, exportedAt };
}
