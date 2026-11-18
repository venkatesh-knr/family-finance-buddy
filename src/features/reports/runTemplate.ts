import { financialYearsFor, templateListsFrom } from '../../domain/export/templateV3.ts';
import { istCalendarDate } from '../../lib/dates.ts';
import { saveFile, XLSX_MIME } from '../../lib/workbookFile.ts';
import { writeTemplateFileV3 } from '../../lib/templateFileV3.ts';
import { readForReport } from '../../repo/reportRead.ts';
import { exportFilename } from './exportFile.ts';

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A short code for this download: its row keys' refs carry it, so two downloads never collide. */
export function newTemplateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `TPL-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * The template, version 3 (docs/design/export-redesign.md section 3), made on this device with the household's own lists in its dropdowns. It holds names
 * (members, categories, accounts, investments) and nothing else of the household's, and is read from what the signed-in person can already see.
 */
export async function runTemplate(householdId: string): Promise<{ readonly filename: string }> {
  const source = await readForReport(householdId);
  const now = new Date();
  const today = istCalendarDate(now);
  const day = Number(today.slice(8, 10));
  const madeOn = `${String(day)} ${LONG_MONTHS[Number(today.slice(5, 7)) - 1] ?? ''} ${today.slice(0, 4)}`;
  const bytes = await writeTemplateFileV3(templateListsFrom(source.tables), {
    householdName: source.householdName,
    madeOn,
    templateId: newTemplateId(),
    demo: source.isDemo,
    financialYears: financialYearsFor(today),
  });
  const filename = exportFilename(source.householdName, today, source.isDemo).replace('family-finance-buddy-', 'family-finance-buddy-template-').replace(/-\d{4}-\d{2}-\d{2}/, '');
  saveFile(bytes, filename, XLSX_MIME);
  return { filename };
}
