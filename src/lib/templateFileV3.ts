/**
 * The template, version 3, as a file (docs/design/export-redesign.md section 3; XR-I7): the one place the spreadsheet library is named for it.
 *
 * `src/domain/export/templateV3.ts` is the shape; this writes it: *How to fill* first and *Lists* last; each sheet with a hidden, pre-filled key in column A
 * (SP-0001 and on, 300 rows), a header that is darker where a column is needed and carries a comment, the example row in grey italic keyed EXAMPLE, and the
 * checks of the sample (a date, an amount, a percentage, the last four) and a list on every ▾ column, from the protected Lists sheet by named ranges. The
 * investment column of *Purchases and sales* warns and does not stop, because a new investment may be named on the file's own Investments sheet.
 */

import {
  LIST_HEADERS,
  LIST_NAMES,
  TEMPLATE_SHEETS,
  TEMPLATE_V3_ROWS,
  howToFill,
  listValues,
  plainHeader,
  rowKey,
  type ListName,
  type TemplateColumn,
  type TemplateLists,
  type TemplateMeta,
  type TemplateSheet,
} from '../domain/export/templateV3.ts';
import { DATE_FORMAT, INR_2DP } from '../domain/export/report.ts';

const FOREST = 'FF025F4C';
const FOREST_DARK = 'FF013F33';
const CREAM = 'FFF6F2E4';
const LIME = 'FFC9E35A';
const INK = 'FF1D2823';
const MUTED = 'FF5A655F';
const GREY = 'FF7A7F7B';

type Worksheet = import('exceljs').Worksheet;
type DataValidation = import('exceljs').DataValidation;

function column(col: number): string {
  let n = col;
  let out = '';
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** The check a column carries, with the messages of the sample workbook. Null for a column that has none. */
export function validationFor(spec: TemplateColumn): DataValidation | null {
  const prompt = { showErrorMessage: true, allowBlank: true } as const;
  if (spec.list !== undefined) {
    const what = plainHeader(spec.header).toLowerCase();
    return spec.warnOnly === true
      ? {
          type: 'list',
          formulae: [`L_${spec.list}`],
          ...prompt,
          errorStyle: 'warning',
          errorTitle: 'Not in the list',
          error: 'Not one of your investments. That is fine if it is on the Investments sheet of this file, with the same name and whose.',
        }
      : { type: 'list', formulae: [`L_${spec.list}`], ...prompt, errorStyle: 'stop', errorTitle: 'Pick from the list', error: `Choose one of the ${what} in the list.` };
  }
  switch (spec.check) {
    case 'date':
      return { type: 'date', operator: 'greaterThan', formulae: ['DATE(1990,1,1)'], ...prompt, errorTitle: 'A date', error: 'Type a date, like 31-10-2026.' };
    case 'amount':
      return { type: 'decimal', operator: 'greaterThan', formulae: [0], ...prompt, errorTitle: 'An amount', error: 'Type an amount more than 0, like 1,42,000.' };
    case 'number':
      return { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], ...prompt, errorTitle: 'A number', error: 'Type a number, like 1500.5.' };
    case 'percent':
      return { type: 'decimal', operator: 'between', formulae: [0, 100], ...prompt, errorTitle: 'A percentage', error: 'Type a number from 0 to 100, like 7.1.' };
    case 'last4':
      return { type: 'textLength', operator: 'equal', formulae: [4], ...prompt, errorTitle: 'Last four only', error: 'Type only the last four digits. Never the full number.' };
    default:
      return null;
  }
}

/** The example row's value for a column: a placeholder in braces is filled from the household's own lists. */
function exampleValue(raw: string | number | undefined, lists: TemplateLists, meta: TemplateMeta): string | number | Date | null {
  if (raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  const filled: Record<string, string | undefined> = {
    '{category}': lists.categories[0],
    '{member}': lists.members[0],
    '{account}': lists.accounts[0],
    '{investment}': lists.investments[0],
    '{fy}': meta.financialYears[1] ?? meta.financialYears[0],
  };
  if (raw in filled) return filled[raw] ?? null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : raw;
}

function dataSheet(book: import('exceljs').Workbook, spec: TemplateSheet, lists: TemplateLists, meta: TemplateMeta): void {
  const sheet: Worksheet = book.addWorksheet(spec.name, {
    properties: { tabColor: { argb: LIME } },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
  });
  const headers = ['Row key', ...spec.columns.map((entry) => entry.header)];
  sheet.addRow(headers);
  // Row 2 is the example, keyed EXAMPLE: grey and italic, and never uploaded.
  sheet.addRow(['EXAMPLE', ...spec.columns.map((entry) => exampleValue(spec.example[entry.header], lists, meta))]);
  for (let n = 1; n <= TEMPLATE_V3_ROWS; n += 1) sheet.addRow([rowKey(spec.prefix, n)]);

  sheet.getColumn(1).width = 13;
  sheet.getColumn(1).hidden = true;
  spec.columns.forEach((entry, index) => {
    const at = index + 2;
    const target = sheet.getColumn(at);
    target.width = entry.width;
    if (entry.format === 'amount') target.numFmt = INR_2DP;
    if (entry.format === 'date') target.numFmt = DATE_FORMAT;
    const head = sheet.getCell(1, at);
    head.font = { bold: true, color: { argb: CREAM } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: entry.needed ? FOREST_DARK : FOREST } };
    head.alignment = { vertical: 'middle', wrapText: true };
    head.note = entry.comment === '' ? ' ' : entry.comment;
    const validation = validationFor(entry);
    if (validation !== null) {
      for (let row = 2; row <= TEMPLATE_V3_ROWS + 1; row += 1) sheet.getCell(row, at).dataValidation = validation;
    }
  });
  const keyHead = sheet.getCell(1, 1);
  keyHead.font = { bold: true, color: { argb: CREAM } };
  keyHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FOREST } };
  const example = sheet.getRow(2);
  example.font = { italic: true, color: { argb: GREY } };
  sheet.getRow(1).height = 30;
}

/** The bytes of an .xlsx for a version 3 template. */
export async function writeTemplateFileV3(lists: TemplateLists, meta: TemplateMeta): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  book.creator = 'Family Finance Buddy';
  book.title = `${meta.householdName} · template`;

  const how = book.addWorksheet('How to fill', { properties: { tabColor: { argb: FOREST } } });
  how.getColumn(1).width = 110;
  howToFill(meta).forEach((line, index) => {
    const cell = how.getCell(index + 1, 1);
    cell.value = line.text === '' ? null : line.text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (line.style === 'title') cell.font = { bold: true, size: 14, color: { argb: INK } };
    else if (line.style === 'head') cell.font = { bold: true };
    else if (line.style === 'sub' || line.style === 'muted') cell.font = { color: { argb: MUTED }, size: line.style === 'muted' ? 9 : 11 };
  });

  for (const spec of TEMPLATE_SHEETS) dataSheet(book, spec, lists, meta);

  const values = listValues(lists, meta);
  const listSheet = book.addWorksheet('Lists');
  LIST_NAMES.forEach((name: ListName, index) => {
    const at = index + 1;
    const head = listSheet.getCell(1, at);
    head.value = LIST_HEADERS[name];
    head.font = { bold: true, color: { argb: CREAM } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FOREST } };
    const entries = values[name];
    entries.forEach((entry, row) => {
      listSheet.getCell(row + 2, at).value = entry;
    });
    listSheet.getColumn(at).width = Math.min(48, Math.max(14, ...entries.map((entry) => entry.length + 2), LIST_HEADERS[name].length + 2));
    const last = Math.max(entries.length, 1) + 1;
    book.definedNames.add(`Lists!$${column(at)}$2:$${column(at)}$${String(last)}`, `L_${name}`);
  });
  const tallest = Math.max(...LIST_NAMES.map((name) => values[name].length), 1);
  const help = listSheet.getCell(tallest + 3, 1);
  help.value = 'Filled in by the app from your household when you download the template. Members, categories and accounts are added in the app.';
  help.font = { color: { argb: MUTED } };
  // Lists is the dropdowns' source and is not for editing: protected, with no password.
  await listSheet.protect('', { selectLockedCells: true, selectUnlockedCells: true });

  book.calcProperties = { fullCalcOnLoad: true };
  const buffer = await book.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
