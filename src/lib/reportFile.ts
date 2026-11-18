/**
 * The report as a file: the one place the spreadsheet library is named for it (docs/design/export-redesign.md section 2).
 *
 * `src/domain/export/report.ts` makes sheets of cells; this makes the bytes of an .xlsx from them, in the report's look: a forest header with cream text, the
 * first row frozen and a filter on every table, a column width for each column, number formats that group in lakhs and crores, and formulas where the
 * model has them. The library is loaded only when a file is made, so the page that offers the download does not carry it, and nothing here touches the
 * network.
 */

import type { ReportCell, ReportSheet, ReportStyle, ReportWorkbook } from '../domain/export/report.ts';

const FOREST = 'FF025F4C';
const CREAM = 'FFF6F2E4';
const LIME = 'FFC9E35A';
const INK = 'FF1D2823';
const MUTED = 'FF5A655F';

/** A cell reference such as `A1`, `M12`. */
function column(col: number): string {
  let n = col;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export const cellRef = (row: number, col: number): string => `${column(col)}${String(row)}`;

type Worksheet = import('exceljs').Worksheet;

function styleCell(worksheet: Worksheet, cell: ReportCell, style: ReportStyle | undefined): void {
  const target = worksheet.getCell(cell.row, cell.col);
  switch (style) {
    case 'title':
      target.font = { bold: true, size: 14, color: { argb: INK } };
      break;
    case 'subtitle':
      target.font = { color: { argb: MUTED } };
      break;
    case 'note':
      target.font = { color: { argb: MUTED } };
      break;
    case 'label':
    case 'total':
      target.font = { bold: true };
      break;
    case 'header':
      target.font = { bold: true, color: { argb: CREAM } };
      target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FOREST } };
      target.alignment = { vertical: 'middle', wrapText: true };
      break;
    default:
      break;
  }
}

/** The bytes of an .xlsx for a report. */
export async function writeReportFile(report: ReportWorkbook, options: { readonly householdName: string }): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  book.creator = 'Family Finance Buddy';
  book.title = `${options.householdName} · report`;
  // A formula has no stored result; the reader of the file works it out when it opens.
  book.calcProperties = { fullCalcOnLoad: true };

  for (const sheet of report.sheets) {
    const worksheet = book.addWorksheet(sheet.name, {
      properties: { tabColor: { argb: sheet.tab === 'overview' ? FOREST : LIME } },
      ...(sheet.freeze ? { views: [{ state: 'frozen' as const, ySplit: 1 }] } : {}),
    });
    sheet.widths.forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });
    for (const cell of sheet.cells) {
      const target = worksheet.getCell(cell.row, cell.col);
      target.value = typeof cell.value === 'object' && cell.value !== null && 'formula' in cell.value ? { formula: cell.value.formula } : (cell.value as string | number | Date | null);
      if (cell.format !== undefined) target.numFmt = cell.format;
      styleCell(worksheet, cell, cell.style);
    }
    // Every column of a data table carries its own number format down to its last row, so a person who adds a row below finds it formatted.
    if (sheet.filter !== null) {
      worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.filter.toRow, column: sheet.filter.toCol } };
    }
    if (sheet.tab === 'data') worksheet.getRow(1).height = 30;
  }

  const buffer = await book.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

export type { ReportSheet };
