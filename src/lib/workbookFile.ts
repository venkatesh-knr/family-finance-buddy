/**
 * The workbook as a file: the one place a spreadsheet library is named.
 *
 * `src/domain/export` turns rows into sheets of cells and back; this turns sheets of cells into the bytes of an .xlsx and back.
 * The library is loaded only when a file is made or read, so the page that offers the export does not carry it, and nothing here
 * touches the network: the file is made on the device and handed to the browser to save.
 */

import type { Cell } from '../domain/export/cells.ts';
import type { ReadSheet, SheetModel } from '../domain/export/workbook.ts';

const HEADER_FILL = 'FF1F2A44';
const READ_ONLY_TAB = 'FF7A869A';
const SAMPLE_TAB = 'FFC9971C';

/** The bytes of an .xlsx holding these sheets. A sample (demo) household's About sheet is tabbed amber. */
export async function writeWorkbookFile(sheets: readonly SheetModel[], options: { readonly sample: boolean }): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  book.creator = 'Family Finance Buddy';

  for (const sheet of sheets) {
    const tab = sheet.entity === null ? (options.sample ? SAMPLE_TAB : undefined) : sheet.readOnly ? READ_ONLY_TAB : undefined;
    const worksheet = book.addWorksheet(sheet.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
      ...(tab === undefined ? {} : { properties: { tabColor: { argb: tab } } }),
    });
    worksheet.addRow([...sheet.headers]);
    for (const row of sheet.rows) worksheet.addRow([...row]);

    const header = worksheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };

    sheet.headers.forEach((name, index) => {
      const column = worksheet.getColumn(index + 1);
      const longest = sheet.rows.reduce((width, row) => Math.max(width, String(row[index] ?? '').length), name.length);
      column.width = Math.min(48, Math.max(10, longest + 2));
      const format = sheet.formats[index];
      if (format !== null && format !== undefined) column.numFmt = format;
    });
    // A dropdown on every column that takes one of a few values: the database's own list, down the whole column.
    sheet.headers.forEach((_, index) => {
      const list = sheet.lists[index];
      if (list === null || list === undefined || list.length === 0) return;
      // A list in a cell's validation is one string of at most 255 characters; a longer one is left as free text.
      const joined = list.join(',');
      if (joined.length > 250) return;
      const last = Math.max(sheet.rows.length + 1 + 200, 500);
      for (let row = 2; row <= last; row += 1) {
        worksheet.getCell(row, index + 1).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${joined}"`],
          showErrorMessage: true,
          errorTitle: 'Not one of the choices',
          error: `Choose one of: ${joined}`,
        };
      }
    });
    // The template's example rows are shown as examples: grey and italic.
    const refAt = sheet.headers.indexOf('ref');
    if (refAt >= 0) {
      worksheet.eachRow((row, number) => {
        const marker = row.getCell(refAt + 1).value;
        if (number > 1 && typeof marker === 'string' && /^EXAMPLE\b/.test(marker)) row.font = { italic: true, color: { argb: 'FF7A869A' } };
      });
    }
    if (sheet.headers.length > 0) {
      worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.headers.length } };
    }
  }

  const buffer = await book.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

function plain(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record['richText'])) return (record['richText'] as { text?: string }[]).map((part) => part.text ?? '').join('');
    if ('result' in record) return plain(record['result']);
    if (typeof record['text'] === 'string') return record['text'];
    if (typeof record['error'] === 'string') return record['error'];
  }
  return String(value);
}

/** The sheets of an .xlsx as rows of cells, the first row being the headers. Formulas are read as the value they last had. */
export async function readWorkbookFile(bytes: ArrayBuffer | Uint8Array): Promise<ReadSheet[]> {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes instanceof Uint8Array ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : bytes);
  return book.worksheets.map((worksheet) => {
    const rows: Cell[][] = [];
    const width = worksheet.columnCount;
    for (let r = 1; r <= worksheet.rowCount; r += 1) {
      const row = worksheet.getRow(r);
      rows.push(Array.from({ length: width }, (_, c) => plain(row.getCell(c + 1).value)));
    }
    return { name: worksheet.name, rows };
  });
}

/** Hand bytes to the browser to save as a file. Nothing is uploaded. */
export function saveFile(bytes: Uint8Array, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
