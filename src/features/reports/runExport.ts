import { buildWorkbook, type Problem } from '../../domain/export/workbook.ts';
import { istCalendarDate } from '../../lib/dates.ts';
import { saveFile, writeWorkbookFile, XLSX_MIME } from '../../lib/workbookFile.ts';
import { verifyTotpCode } from '../../repo/auth.ts';
import { readEverything } from '../../repo/export.ts';
import { exportFilename, rememberExport } from './exportFile.ts';

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
export async function runFullExport(householdId: string, code: string): Promise<{ readonly filename: string; readonly exportedAt: string }> {
  await verifyTotpCode(code);
  const source = await readEverything(householdId);
  const exportedAt = new Date().toISOString();
  const { workbook, problems } = buildWorkbook(
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
