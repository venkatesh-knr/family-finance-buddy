import { describe, expect, it } from 'vitest';
import { ENTITIES, NOT_EXPORTED, SHEETED, TEMPLATE_VERSION, headerOf, sheetColumns, type Row } from './entities.ts';
import { exportFixture as fixture } from './fixture.ts';
import { buildWorkbook, canonicalRow, readWorkbook, type ExportMeta, type SheetModel } from './workbook.ts';

const META: ExportMeta = {
  exportedAt: '2026-10-30T06:30:00.000Z',
  householdName: 'The Rao household',
  baseCurrency: 'INR',
  demo: false,
};

const sheetsFor = (workbook: { sheets: readonly SheetModel[] }) => workbook.sheets.map((sheet) => ({ name: sheet.name, rows: [sheet.headers, ...sheet.rows] }));

describe('the shape of the file', () => {
  it('has a sheet for every entity, uniquely named, within a spreadsheet’s limit, and an About sheet first', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    expect(workbook.sheets[0]?.name).toBe('About');
    const names = workbook.sheets.map((sheet) => sheet.name);
    expect(new Set(names).size).toBe(names.length);
    for (const entity of SHEETED) expect(names).toContain(entity.sheet);
    // Setup that is not the person's to edit here is not a sheet: settings, members, and the instrument a holding is.
    for (const absent of ['Household', 'Members', 'Instruments']) expect(names).not.toContain(absent);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(31);
  });

  it('writes the version, the household and when, so a file says what it is', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const about = Object.fromEntries((workbook.sheets[0]?.rows ?? []).map((row) => [row[0], row[1]]));
    expect(about['Template version']).toBe(TEMPLATE_VERSION);
    expect(about['Household']).toBe('The Rao household');
    expect(about['Base currency']).toBe('INR');
    expect(about['Exported at']).toBe('2026-10-30T06:30:00.000Z');
    expect(about['Sample figures']).toBe('No');
  });

  it('marks a demo household’s file as illustrative, so it cannot be mistaken for a real one', () => {
    const { workbook } = buildWorkbook(fixture(), { ...META, demo: true });
    const about = Object.fromEntries((workbook.sheets[0]?.rows ?? []).map((row) => [row[0], row[1]]));
    expect(about['Sample figures']).toMatch(/^Yes/);
  });

  it('writes an amount in major units with its currency beside it, not in minor units', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const expenses = workbook.sheets.find((sheet) => sheet.name === 'Expenses');
    const amount = expenses?.headers.indexOf('amount') ?? -1;
    expect(amount).toBeGreaterThan(-1);
    expect(expenses?.headers).not.toContain('amount_minor');
    expect(expenses?.rows[0]?.[amount]).toBe(1234567.89);
    expect(expenses?.rows[0]?.[(expenses?.headers.indexOf('currency') ?? -1)]).toBe('INR');
  });

  it('writes a withdrawal as a negative amount and a quantity with its eight places', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const payments = workbook.sheets.find((sheet) => sheet.name === 'PPF payments');
    const amount = payments?.headers.indexOf('amount') ?? -1;
    expect(payments?.rows.map((row) => row[amount])).toEqual([50000, -10000]);
    const holdings = workbook.sheets.find((sheet) => sheet.name === 'Holdings');
    expect(holdings?.rows[0]?.[holdings.headers.indexOf('quantity')]).toBe(1234.5678);
    // A holding’s cost is in its instrument’s currency, which is written beside it for the person reading.
    expect(holdings?.rows[0]?.[holdings.headers.indexOf('cost')]).toBe(150000);
    expect(holdings?.rows[0]?.[holdings.headers.indexOf('currency')]).toBe('INR');
  });

  it('writes a name beside every column that points at another record, so a person need not read an id', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const expenses = workbook.sheets.find((sheet) => sheet.name === 'Expenses');
    expect(expenses?.headers).toContain('member_name');
    expect(expenses?.headers).toContain('category_name');
    expect(expenses?.rows[0]?.[expenses.headers.indexOf('member_name')]).toBe('Venkatesh');
    expect(expenses?.rows[0]?.[expenses.headers.indexOf('category_name')]).toBe('Groceries');
    const holdings = workbook.sheets.find((sheet) => sheet.name === 'Holdings');
    // What the holding is, written beside it: its name and kind, from the instrument, not a sheet of their own.
    expect(holdings?.rows[0]?.[holdings.headers.indexOf('name')]).toBe('Nippon Nifty 50');
    expect(holdings?.rows[0]?.[holdings.headers.indexOf('kind')]).toBe('fund');
    expect(holdings?.headers).not.toContain('instrument_name');
  });

  it('shows an amount with the places its currency has, and never fewer than its rows carry', () => {
    const tables = fixture();
    const format = (name: string, header: string) => {
      const { workbook } = buildWorkbook(tables, META);
      const sheet = workbook.sheets.find((s) => s.name === name);
      return sheet?.formats[sheet.headers.indexOf(header)];
    };
    expect(format('Expenses', 'amount')).toBe('#,##0.00');
    tables['expense_txn'] = [{ ...(tables['expense_txn']?.[0] as Row), currency: 'JPY', amount_minor: '150000' }];
    expect(format('Expenses', 'amount')).toBe('#,##0');
    tables['expense_txn'] = [{ ...(tables['expense_txn']?.[0] as Row), currency: 'BHD', amount_minor: '1234' }];
    expect(format('Expenses', 'amount')).toBe('#,##0.000');
    tables['expense_txn'] = [];
    expect(format('Expenses', 'amount')).toBe('#,##0.00');
  });

  it('keeps text that looks like a formula as text, whole', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const expenses = workbook.sheets.find((sheet) => sheet.name === 'Expenses');
    expect(expenses?.rows[0]?.[expenses.headers.indexOf('payee')]).toBe('=SUM(A1:A9)');
  });

  it('marks the sheets the upload will not accept as read-only', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    expect(workbook.sheets.find((sheet) => sheet.name === 'Bond ratings')?.readOnly).toBe(true);
    // Reference data the app keeps is not in the file at all.
    const names = workbook.sheets.map((sheet) => sheet.name);
    for (const absent of ['Prices', 'Scheme rates', 'Tax rules', 'FX rates', 'Imports', 'Household']) expect(names).not.toContain(absent);
    expect(workbook.sheets.find((sheet) => sheet.name === 'Expenses')?.readOnly).toBe(false);
  });

  it('refuses a figure a cell cannot hold exactly instead of writing it rounded', () => {
    const tables = fixture();
    tables['holding'] = [{ ...(tables['holding']?.[0] as Row), quantity: '1234567.12345678901' }];
    const { problems } = buildWorkbook(tables, META);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ sheet: 'Holdings', row: 2, column: 'quantity' });
    expect(problems[0]?.message).toMatch(/significant digits/);
  });
});

describe('the round trip', () => {
  it('reads back exactly what was written', () => {
    const tables = fixture();
    const { workbook } = buildWorkbook(tables, META);
    const back = readWorkbook(sheetsFor(workbook));
    expect(back.problems).toEqual([]);
    // The entities with a sheet, and the instrument that is written inside the Holdings sheet.
    const inFile = ENTITIES.filter((entity) => entity.sheet !== null || ENTITIES.some((other) => other.joins?.entity === entity.key));
    for (const entity of inFile) {
      const written = (tables[entity.key] ?? []).map((row) => canonicalRow(entity, row));
      expect(back.tables[entity.key] ?? [], entity.key).toEqual(written);
    }
  });

  it('reads the same when the columns are in a different order, and when helper columns are removed or added', () => {
    const tables = fixture();
    const { workbook } = buildWorkbook(tables, META);
    const shuffled = sheetsFor(workbook).map((sheet) => {
      if (sheet.name === 'About') return sheet;
      const headers = [...(sheet.rows[0] ?? [])];
      const order = headers.map((_, index) => index).reverse();
      const rows = sheet.rows.map((row) => order.map((index) => row[index] ?? null));
      return { name: sheet.name, rows: rows.map((row) => [...row, 'a note of mine']) };
    });
    shuffled.forEach((sheet) => {
      if (sheet.name !== 'About' && sheet.rows[0] !== undefined) (sheet.rows[0] as unknown[])[sheet.rows[0].length - 1] = 'Notes';
    });
    const back = readWorkbook(shuffled);
    expect(back.problems).toEqual([]);
    expect(back.tables['expense_txn']).toEqual([canonicalRow(ENTITIES.find((e) => e.key === 'expense_txn')!, (tables['expense_txn'] as Row[])[0] as Row)]);
  });

  it('reads an amount a person retyped in Excel the way people type it', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const sheets = sheetsFor(workbook);
    const expenses = sheets.find((sheet) => sheet.name === 'Expenses');
    const amount = (expenses?.rows[0] ?? []).indexOf('amount');
    (expenses!.rows[1] as unknown[])[amount] = '₹2,50,000.50';
    const date = (expenses?.rows[0] ?? []).indexOf('txn_date');
    (expenses!.rows[1] as unknown[])[date] = new Date(Date.UTC(2026, 9, 28));
    const back = readWorkbook(sheets);
    expect(back.problems).toEqual([]);
    expect(back.tables['expense_txn']?.[0]).toMatchObject({ amount_minor: '25000050', txn_date: '2026-10-28' });
  });

  it('reads one instrument for the holdings that name it, and one for each holding that has its own', () => {
    const tables = fixture();
    const first = tables['holding']?.[0] as Row;
    // A second member's holding of the same fund: two holdings, one instrument.
    tables['holding'] = [...(tables['holding'] ?? []), { ...first, id: '00000000-0000-4000-8000-0000000000e9', folio_last4: '9999' }];
    const { workbook } = buildWorkbook(tables, META);
    const back = readWorkbook(sheetsFor(workbook));
    expect(back.problems).toEqual([]);
    expect(back.tables['holding']).toHaveLength(3);
    expect(back.tables['instrument']).toHaveLength(2);
  });

  it('reads a holding’s cost in the currency of its instrument', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const back = readWorkbook(sheetsFor(workbook));
    expect(back.tables['holding']?.[0]).toMatchObject({ cost_minor: '15000000', quantity: '1234.5678' });
  });
});

describe('a reference of the person\u2019s own, and the names written beside ids', () => {
  const CATEGORY = '00000000-0000-4000-8000-0000000000c1';

  it('writes a ref column beside the key of every sheet an upload takes, and not on the others', () => {
    const { workbook } = buildWorkbook(fixture(), META, { expense_category: { [CATEGORY]: 'CAT-1' } });
    const categories = workbook.sheets.find((sheet) => sheet.name === 'Categories');
    expect(categories?.headers.slice(0, 2)).toEqual(['id', 'ref']);
    expect(categories?.rows[0]?.[1]).toBe('CAT-1');
    const expenses = workbook.sheets.find((sheet) => sheet.name === 'Expenses');
    expect(expenses?.rows[0]?.[expenses.headers.indexOf('ref')]).toBeNull();
    expect(workbook.sheets.find((sheet) => sheet.name === 'Bond ratings')?.headers).not.toContain('ref');
  });

  it('reads the reference and the names back with the row, by the sheet row they are on', () => {
    const { workbook } = buildWorkbook(fixture(), META, { expense_category: { [CATEGORY]: 'CAT-1' } });
    const back = readWorkbook(sheetsFor(workbook));
    expect(back.problems).toEqual([]);
    expect(back.sheets['expense_category']?.[0]).toMatchObject({ sheetRow: 2, ref: 'CAT-1', values: { name: 'Groceries' } });
    expect(back.sheets['expense_txn']?.[0]?.names).toMatchObject({ member_id: 'Venkatesh', category_id: 'Groceries' });
    // The holding's sheet carries its instrument's name as a column of its own, so no second name is written beside the id.
    expect(back.sheets['holding']?.[0]?.values).toMatchObject({ name: 'Nippon Nifty 50', kind: 'fund' });
  });

  it('refuses a sheet that has lost its ref column, as a version-1 file has', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const sheets = sheetsFor(workbook).map((sheet) => {
      if (sheet.name !== 'Categories') return sheet;
      const drop = (sheet.rows[0] ?? []).indexOf('ref');
      return { name: sheet.name, rows: sheet.rows.map((row) => row.filter((_, index) => index !== drop)) };
    });
    const back = readWorkbook(sheets);
    expect(back.problems.some((problem) => problem.sheet === 'Categories' && problem.column === 'ref')).toBe(true);
  });

  it('reads the names a person typed to find a record, where the id is empty', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const sheets = sheetsFor(workbook);
    const expenses = sheets.find((sheet) => sheet.name === 'Expenses');
    const headers = expenses?.rows[0] ?? [];
    (expenses!.rows[1] as unknown[])[headers.indexOf('id')] = null;
    (expenses!.rows[1] as unknown[])[headers.indexOf('member_id')] = null;
    (expenses!.rows[1] as unknown[])[headers.indexOf('member_name')] = '  Venkatesh ';
    const back = readWorkbook(sheets);
    expect(back.sheets['expense_txn']?.[0]).toMatchObject({ values: { id: null, member_id: null }, names: { member_id: 'Venkatesh' } });
  });
});

describe('what the reader refuses, and says where', () => {
  it('names the sheet, the row and the column of a cell that is wrong, and goes on to read the rest', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const sheets = sheetsFor(workbook);
    const expenses = sheets.find((sheet) => sheet.name === 'Expenses');
    const headers = expenses?.rows[0] ?? [];
    (expenses!.rows[1] as unknown[])[headers.indexOf('amount')] = 'about a thousand';
    (expenses!.rows[1] as unknown[])[headers.indexOf('txn_date')] = '29/10/2026';
    const back = readWorkbook(sheets);
    expect(back.problems).toHaveLength(2);
    expect(back.problems.map((problem) => `${problem.sheet}!${String(problem.row)}!${problem.column}`).sort()).toEqual(['Expenses!2!amount', 'Expenses!2!txn_date']);
    expect(back.problems[0]?.message).toMatch(/not an amount|YYYY-MM-DD/);
    expect(back.tables['holding']).toHaveLength(2);
  });

  it('refuses an amount with no currency to read it in', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const sheets = sheetsFor(workbook);
    const expenses = sheets.find((sheet) => sheet.name === 'Expenses');
    (expenses!.rows[1] as unknown[])[(expenses?.rows[0] ?? []).indexOf('currency')] = null;
    const back = readWorkbook(sheets);
    expect(back.problems.some((problem) => problem.column === 'amount' && /currency/i.test(problem.message))).toBe(true);
  });

  it('refuses a sheet that has lost a column, instead of reading by position', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const sheets = sheetsFor(workbook).map((sheet) => {
      if (sheet.name !== 'Expenses') return sheet;
      const drop = (sheet.rows[0] ?? []).indexOf('payee');
      return { name: sheet.name, rows: sheet.rows.map((row) => row.filter((_, index) => index !== drop)) };
    });
    const back = readWorkbook(sheets);
    expect(back.problems.some((problem) => problem.sheet === 'Expenses' && problem.column === 'payee' && /no column/i.test(problem.message))).toBe(true);
  });

  it('refuses a workbook of another template version, or of none, and reads nothing from it', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const older = sheetsFor(workbook).map((sheet) => (sheet.name === 'About' ? { name: 'About', rows: sheet.rows.map((row) => (row[0] === 'Template version' ? ['Template version', 0] : row)) } : sheet));
    const refused = readWorkbook(older);
    expect(refused.problems[0]?.message).toContain(`version 0; this app reads version ${String(TEMPLATE_VERSION)}`);
    expect(refused.tables).toEqual({});
    const none = readWorkbook(sheetsFor(workbook).filter((sheet) => sheet.name !== 'About'));
    expect(none.problems[0]?.message).toMatch(/template version/i);
    expect(none.tables).toEqual({});
  });

  it('skips a row that is empty throughout and refuses a duplicated header', () => {
    const { workbook } = buildWorkbook(fixture(), META);
    const sheets = sheetsFor(workbook);
    const categories = sheets.find((sheet) => sheet.name === 'Categories');
    categories!.rows.push((categories!.rows[0] ?? []).map(() => null));
    expect(readWorkbook(sheets).tables['expense_category']).toHaveLength(1);
    categories!.rows[0] = [...(categories!.rows[0] ?? []), 'name'];
    expect(readWorkbook(sheets).problems.some((problem) => /twice/i.test(problem.message))).toBe(true);
  });
});

describe('the entity list', () => {
  it('names each column once, in a sheet whose headers are unique, and a money column’s currency exists', () => {
    for (const entity of SHEETED) {
      const columns = sheetColumns(entity);
      const keys = columns.map((column) => column.key);
      expect(new Set(keys).size, entity.key).toBe(keys.length);
      const headers = columns.map(headerOf);
      expect(new Set(headers).size, entity.key).toBe(headers.length);
      for (const column of columns) {
        if (column.kind !== 'money') continue;
        const source = column.currency;
        expect(source, `${entity.key}.${column.key}`).toBeDefined();
        const own = source !== undefined && 'via' in source ? source.via : source?.column;
        expect(keys, `${entity.key}.${column.key} currency`).toContain(own);
      }
      for (const key of entity.rowKey) expect(keys).toContain(key);
    }
  });

  it('points every reference at an entity that is in the list', () => {
    const known = new Set(ENTITIES.map((entity) => entity.key));
    for (const entity of ENTITIES) {
      for (const column of entity.columns) if (column.ref !== undefined) expect(known.has(column.ref), `${entity.key}.${column.key}`).toBe(true);
    }
  });

  it('never carries an account id, a credential or a raw statement payload in a column', () => {
    const forbidden = /^(created_by|voided_by|actor|auth_user_id|email|code_hash|ip_hash|payload|raw|source_row)$/;
    for (const entity of ENTITIES) {
      for (const column of entity.columns) expect(forbidden.test(column.key), `${entity.key}.${column.key}`).toBe(false);
    }
  });

  it('gives every left-out table a reason', () => {
    for (const [table, reason] of Object.entries(NOT_EXPORTED)) expect(reason.length, table).toBeGreaterThan(20);
  });
});
