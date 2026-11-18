import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { reportFixture } from '../domain/export/reportFixture.ts';
import { LIST_NAMES, TEMPLATE_SHEETS, TEMPLATE_V3_ROWS, financialYearsFor, plainHeader, rowKey, templateListsFrom, type TemplateMeta } from '../domain/export/templateV3.ts';
import { writeTemplateFileV3 } from './templateFileV3.ts';

/**
 * The template, version 3, as a file (docs/design/export-redesign.md section 3; XR-I7): the sheets and headers of the design, How to fill first and Lists
 * last, a hidden pre-filled key in column A, the example row, a comment on every header, the checks of the sample and a list on every ▾ column.
 */

const META: TemplateMeta = { householdName: 'The Rao household', madeOn: '17 November 2026', templateId: 'TPL-ABCDEF', demo: false, financialYears: financialYearsFor('2026-11-17') };
const LISTS = templateListsFrom(reportFixture());

const load = async () => {
  const bytes = await writeTemplateFileV3(LISTS, META);
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return { book, zip: await JSZip.loadAsync(bytes) };
};

describe('the household’s lists', () => {
  it('are the members, the categories and accounts in use and the investments held today as Name (Whose)', () => {
    expect(LISTS.members).toEqual(['Venkatesh', 'Meera']);
    expect(LISTS.categories).toEqual(['Fuel', 'Groceries']);
    expect(LISTS.accounts).toEqual(['HDFC savings ••4821', 'ICICI card ••1188']);
    expect(LISTS.investments).toEqual(['Demo Flexi Cap Fund (Venkatesh)', 'Emergency fund (bank FD) (Venkatesh)', 'NPS TIER1 (Meera)', 'Vanguard Total Stock Market ETF (Venkatesh)']);
  });

  it('offers three financial years, the one that began last April, this one and the next', () => {
    expect(financialYearsFor('2026-11-17')).toEqual(['2025-26', '2026-27', '2027-28']);
    expect(financialYearsFor('2026-02-01')).toEqual(['2024-25', '2025-26', '2026-27']);
  });
});

// The first test loads the spreadsheet library, which takes seconds on a busy machine.
describe('XR-I7 — the template has exactly the sheets and headers of the design', { timeout: 30_000 }, () => {
  it('has How to fill first, the data sheets in order, and Lists last', async () => {
    const { book } = await load();
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['How to fill', 'Spending', 'Money in', 'Monthly plan', 'Investments', 'Purchases and sales', 'Deposits', 'Insurance', 'Loans', 'Property', 'Lists']);
    expect(book.worksheets.map((sheet) => sheet.name)).not.toContain('Value history');
  });

  it('has the headers of the design on every sheet, with * for what is needed and ▾ for a list', async () => {
    const { book } = await load();
    const expected: Record<string, string[]> = {
      Spending: ['Date *', 'Amount *', 'Currency ▾', 'Category * ▾', 'Who * ▾', 'Paid to', 'How paid ▾', 'From account ▾', 'Note', 'Private ▾'],
      'Money in': ['Date *', 'Amount *', 'Currency ▾', 'What it is * ▾', 'Whose * ▾', 'Into account ▾', 'From', 'Private ▾'],
      'Monthly plan': ['Category * ▾', 'Per month', 'Per year', 'Financial year * ▾'],
      Investments: ['Name *', 'Type * ▾', 'Whose * ▾', 'Units', 'Amount invested', 'Bought on', 'Latest value', 'Value as on', 'Kept for ▾', 'Held outside India ▾', 'Currency ▾'],
      'Purchases and sales': ['Date *', 'Investment * ▾', 'What happened * ▾', 'Units *', 'Amount', 'Currency ▾', 'Note'],
      Deposits: ['Deposit *', 'Bank', 'Principal *', 'Interest rate % *', 'Start date *', 'Maturity date *', 'Interest added ▾', 'Account last 4'],
      Insurance: ['Policy *', 'Type * ▾', 'Insurer', 'Policy no. last 4', 'Covers ▾', 'Cover amount', 'Premium *', 'Paid * ▾', 'Next renewal'],
      Loans: ['Loan *', 'Type * ▾', 'Whose ▾', 'EMI *', 'Paid * ▾', 'Outstanding', 'Outstanding as on'],
      Property: ['Property *', 'Type * ▾', 'Whose * ▾', 'Bought on', 'Price paid', 'Stamp duty', 'Registration', 'Your share %', 'You live in it ▾'],
    };
    for (const [name, headers] of Object.entries(expected)) {
      const sheet = book.getWorksheet(name);
      expect([...Array(headers.length)].map((_, i) => String(sheet?.getCell(1, i + 2).value)), name).toEqual(headers);
      expect(String(sheet?.getCell(1, 1).value), name).toBe('Row key');
    }
    expect(TEMPLATE_SHEETS.map((sheet) => sheet.name)).toEqual(Object.keys(expected));
  });

  it('hides the key column and pre-fills it, SP-0001 to SP-0300, under an example row keyed EXAMPLE', async () => {
    const { book } = await load();
    for (const spec of TEMPLATE_SHEETS) {
      const sheet = book.getWorksheet(spec.name);
      expect(sheet?.getColumn(1).hidden, spec.name).toBe(true);
      expect(sheet?.getCell(2, 1).value, spec.name).toBe('EXAMPLE');
      expect(sheet?.getCell(3, 1).value, spec.name).toBe(rowKey(spec.prefix, 1));
      expect(sheet?.getCell(TEMPLATE_V3_ROWS + 2, 1).value, spec.name).toBe(rowKey(spec.prefix, TEMPLATE_V3_ROWS));
      expect(sheet?.getCell(TEMPLATE_V3_ROWS + 3, 1).value, spec.name).toBeNull();
    }
  });

  it('puts a comment on every header, a darker header on a needed column, and the example in grey italic', async () => {
    const { book } = await load();
    for (const spec of TEMPLATE_SHEETS) {
      const sheet = book.getWorksheet(spec.name);
      spec.columns.forEach((column, i) => {
        const header = sheet?.getCell(1, i + 2);
        const note = header?.note;
        const text = typeof note === 'string' ? note : (note?.texts ?? []).map((part) => part.text).join('');
        expect(text.trim().length, `${spec.name}: ${column.header}`).toBeGreaterThan(0);
        const fill = header?.fill as { fgColor?: { argb?: string } } | undefined;
        expect(fill?.fgColor?.argb, `${spec.name}: ${column.header}`).toBe(column.needed ? 'FF013F33' : 'FF025F4C');
      });
      expect(sheet?.getRow(2).font?.italic, spec.name).toBe(true);
    }
  });

  it('has a list validation on every ▾ column, down every row, from a named range on Lists', async () => {
    const { book } = await load();
    for (const spec of TEMPLATE_SHEETS) {
      const sheet = book.getWorksheet(spec.name);
      spec.columns.forEach((column, i) => {
        if (column.list === undefined) return;
        for (const row of [2, 3, TEMPLATE_V3_ROWS + 1]) {
          const validation = sheet?.getCell(row, i + 2).dataValidation;
          expect(validation?.type, `${spec.name}: ${column.header} row ${String(row)}`).toBe('list');
          expect(String(validation?.formulae?.[0])).toBe(`L_${column.list}`);
        }
      });
    }
    const names = book.definedNames.model.map((entry) => entry.name);
    for (const list of LIST_NAMES) expect(names).toContain(`L_${list}`);
  });

  it('warns, and does not stop, on the Investment column of Purchases and sales, and stops on every other list', async () => {
    const { book } = await load();
    const trades = book.getWorksheet('Purchases and sales');
    expect(trades?.getCell(3, 3).dataValidation).toMatchObject({ errorStyle: 'warning', errorTitle: 'Not in the list' });
    const spending = book.getWorksheet('Spending');
    expect(spending?.getCell(3, 5).dataValidation).toMatchObject({ errorStyle: 'stop', errorTitle: 'Pick from the list', error: 'Choose one of the category in the list.' });
  });

  it('checks a date, an amount, a percentage and the last four, with the sample’s messages', async () => {
    const { book } = await load();
    const spending = book.getWorksheet('Spending');
    expect(spending?.getCell(3, 2).dataValidation).toMatchObject({ type: 'date', operator: 'greaterThan', errorTitle: 'A date', error: 'Type a date, like 31-10-2026.' });
    expect(spending?.getCell(3, 3).dataValidation).toMatchObject({ type: 'decimal', operator: 'greaterThan', errorTitle: 'An amount', error: 'Type an amount more than 0, like 1,42,000.' });
    const deposits = book.getWorksheet('Deposits');
    expect(deposits?.getCell(3, 5).dataValidation).toMatchObject({ type: 'decimal', operator: 'between', errorTitle: 'A percentage', error: 'Type a number from 0 to 100, like 7.1.' });
    expect(deposits?.getCell(3, 9).dataValidation).toMatchObject({ type: 'textLength', operator: 'equal', errorTitle: 'Last four only', error: 'Type only the last four digits. Never the full number.' });
    expect(plainHeader('Category * ▾')).toBe('Category');
  });

  it('fills Lists from the household and protects it, and says on How to fill which version and which download this is', async () => {
    const { book, zip } = await load();
    const lists = book.getWorksheet('Lists');
    expect(lists?.getCell(1, 1).value).toBe('Members');
    expect(lists?.getCell(2, 1).value).toBe('Venkatesh');
    expect(lists?.getCell(2, 4).value).toBe('Demo Flexi Cap Fund (Venkatesh)');
    const index = book.worksheets.findIndex((sheet) => sheet.name === 'Lists') + 1;
    expect(await zip.file(`xl/worksheets/sheet${String(index)}.xml`)?.async('string')).toContain('<sheetProtection');
    const how = book.getWorksheet('How to fill');
    const lines = [...Array(40)].map((_, i) => String(how?.getCell(i + 1, 1).value ?? ''));
    expect(lines).toContain('Template version 3 · id TPL-ABCDEF');
    expect(lines.some((line) => line.startsWith('1. Fill the sheets you need'))).toBe(true);
  });
});
