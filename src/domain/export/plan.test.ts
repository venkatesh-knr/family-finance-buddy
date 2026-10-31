import { describe, expect, it } from 'vitest';
import { ENTITIES, type Row } from './entities.ts';
import { exportFixture as fixture } from './fixture.ts';
import { planUpload, toApplyPayload, type UploadPlan } from './plan.ts';
import { buildWorkbook, canonicalRow, readWorkbook, type ExportMeta, type RefMap } from './workbook.ts';

const META: ExportMeta = { exportedAt: '2026-10-30T06:30:00.000Z', householdName: 'The Rao household', baseCurrency: 'INR', demo: false };

const MEMBER = '00000000-0000-4000-8000-0000000000a1';
const CATEGORY = '00000000-0000-4000-8000-0000000000c1';
const HOLDING = '00000000-0000-4000-8000-0000000000e1';
const PPF_HOLDING = '00000000-0000-4000-8000-0000000000e2';

type Sheets = { name: string; rows: (string | number | boolean | Date | null)[][] }[];

function sheetsOf(tables: Record<string, Row[]>, refs: RefMap = {}): Sheets {
  const { workbook, problems } = buildWorkbook(tables, META, refs);
  expect(problems).toEqual([]);
  return workbook.sheets.map((sheet) => ({ name: sheet.name, rows: [[...sheet.headers], ...sheet.rows.map((row) => [...row])] }));
}

/** Set one cell of a data row (0 is the first row under the headers), found by its header. */
function set(sheets: Sheets, sheet: string, row: number, header: string, value: string | number | boolean | Date | null): void {
  const target = sheets.find((candidate) => candidate.name === sheet);
  const at = target?.rows[0]?.indexOf(header) ?? -1;
  if (target === undefined || at < 0) throw new Error(`no ${header} on ${sheet}`);
  const line = target.rows[row + 1];
  if (line === undefined) throw new Error(`no row ${String(row)} on ${sheet}`);
  line[at] = value;
}

/** Append a row to a sheet, with the cells given by header and every other cell empty. */
function add(sheets: Sheets, sheet: string, cells: Record<string, string | number | boolean | null>): void {
  const target = sheets.find((candidate) => candidate.name === sheet);
  if (target === undefined) throw new Error(`no sheet ${sheet}`);
  const headers = target.rows[0] ?? [];
  target.rows.push(headers.map((header) => cells[String(header)] ?? null));
}

let counter = 0;
const newId = (): string => `99999999-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

function plan(sheets: Sheets, existing: Record<string, Row[]> = fixture(), existingRefs: RefMap = {}): UploadPlan {
  const read = readWorkbook(sheets);
  expect(read.problems, 'the workbook reads').toEqual([]);
  return planUpload({ read, existing, existingRefs, newId });
}

const messages = (result: UploadPlan): string[] => result.problems.map((problem) => `${problem.sheet}!${String(problem.row)}!${problem.column}: ${problem.message}`);

describe('a workbook that has not been edited', () => {
  it('has nothing to write, and says every row is the same as the household holds', () => {
    const result = plan(sheetsOf(fixture()));
    expect(result.problems).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.unchanged).toMatchObject({ expense_category: 1, expense_txn: 1, holding: 2, ppf_entry: 2 });
  });
});

describe('changing rows that exist', () => {
  it('writes only the rows that changed, and says which columns', () => {
    const sheets = sheetsOf(fixture());
    set(sheets, 'Expenses', 0, 'amount', 1500);
    set(sheets, 'Expenses', 0, 'payee', 'Tata Power');
    const result = plan(sheets);
    expect(result.problems).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ entity: 'expense_txn', action: 'update', sheetRow: 2 });
    expect(result.rows[0]?.changes.map((change) => change.column).sort()).toEqual(['amount', 'payee']);
    expect(result.rows[0]?.changes.find((change) => change.column === 'amount')).toMatchObject({ from: '1234567.89', to: '1500' });
    expect(result.rows[0]?.values).toMatchObject({ amount_minor: '150000', payee: 'Tata Power' });
  });

  it('does not count a number written another way, or a date Excel made, as a change', () => {
    const sheets = sheetsOf(fixture());
    set(sheets, 'Holdings', 0, 'quantity', 1234.5678);
    set(sheets, 'Holdings', 0, 'opened_on', new Date(Date.UTC(2024, 3, 1)));
    const result = plan(sheets);
    expect(result.rows).toEqual([]);
    expect(result.unchanged['holding']).toBe(2);
  });

  it('finds a row by its reference when the id is empty, and updates it instead of adding a copy', () => {
    const sheets = sheetsOf(fixture());
    set(sheets, 'Categories', 0, 'id', null);
    set(sheets, 'Categories', 0, 'ref', 'CAT-1');
    set(sheets, 'Categories', 0, 'name', 'Groceries and milk');
    const result = plan(sheets, fixture(), { expense_category: { [CATEGORY]: 'CAT-1' } });
    expect(result.problems).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ action: 'update', key: CATEGORY, ref: 'CAT-1' });
  });

  it('writes a reference onto an existing row that had none, though nothing else changed', () => {
    const sheets = sheetsOf(fixture());
    set(sheets, 'Categories', 0, 'ref', 'CAT-1');
    const result = plan(sheets);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ action: 'update', ref: 'CAT-1', changes: [] });
  });

  it('can change the instrument a holding is, written beside it, when it names it by id', () => {
    const sheets = sheetsOf(fixture());
    set(sheets, 'Holdings', 0, 'isin', 'INF204K01YY2');
    const result = plan(sheets);
    expect(result.problems).toEqual([]);
    expect(result.rows.map((row) => `${row.action}:${row.entity}`)).toEqual(['update:instrument']);
    expect(result.rows[0]?.changes).toEqual([{ money: false, column: 'isin', from: 'INF204K01XX1', to: 'INF204K01YY2' }]);
  });
});

describe('a name changed beside an id that was kept', () => {
  const OTHER = '00000000-0000-4000-8000-0000000000c2';
  function withFuel(): Record<string, Row[]> {
    const existing = fixture();
    existing['expense_category'] = [...(existing['expense_category'] ?? []), { ...(existing['expense_category']?.[0] as Row), id: OTHER, name: 'Fuel' }];
    return existing;
  }

  it('is what the person means: the row moves to that record, and the change says so by name', () => {
    const existing = withFuel();
    const sheets = sheetsOf(existing);
    set(sheets, 'Expenses', 0, 'category_name', 'Fuel');
    const result = plan(sheets, existing);
    expect(result.problems).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.values['category_id']).toBe(OTHER);
    expect(result.rows[0]?.changes).toEqual([{ money: false, column: 'category_id', from: 'Groceries', to: 'Fuel' }]);
  });

  it('is refused when it names nothing the household has, saying what the id was', () => {
    const sheets = sheetsOf(fixture());
    set(sheets, 'Expenses', 0, 'category_name', 'Fuell');
    expect(messages(plan(sheets))[0]).toMatch(/^Expenses!2!category_name: The id is Groceries and the name says Fuell, which no expense category is called/);
  });

  it('is refused on a row keyed by its holding, which is its identity: an account belongs to one holding', () => {
    const existing = fixture();
    existing['ppf_account'] = [{ holding_id: PPF_HOLDING, institution: 'SBI', account_last4: '1234', opening_date: '2026-03-31', opening_balance_minor: '10000000', currency: 'INR', note: null }];
    const sheets = sheetsOf(existing);
    set(sheets, 'PPF accounts', 0, 'holding_name', 'Nippon Nifty 50 (Venkatesh)');
    expect(messages(plan(sheets, existing))[0]).toMatch(/^PPF accounts!2!holding_name: The id is PPF \(Venkatesh\) and the name says Nippon Nifty 50 \(Venkatesh\)\. This row belongs to PPF \(Venkatesh\)/);
  });
});

describe('what the preview lists', () => {
  it('names each row to add, and writes the instrument a holding names once', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Categories', { name: 'Gifts', nature: 'variable', ref: 'CAT-3' });
    add(sheets, 'Holdings', { member_name: 'Venkatesh', name: 'HDFC Bank', kind: 'equity', currency: 'INR', exposure_currency: 'INR', quantity: 1, ref: 'H-1' });
    const result = plan(sheets);
    expect(result.rows.map((row) => `${row.entity}:${row.label ?? ''}`)).toEqual(['expense_category:Gifts', 'instrument:HDFC Bank', 'holding:HDFC Bank (Venkatesh)']);
  });

  it('refuses two holdings that say different things about the one instrument they share', () => {
    const sheets = sheetsOf(fixture());
    const second = (sheets.find((sheet) => sheet.name === 'Holdings')?.rows[2] ?? []) as (string | number | boolean | Date | null)[];
    const headers = sheets.find((sheet) => sheet.name === 'Holdings')?.rows[0] ?? [];
    // Both holdings now name the fund; one renames it and the other does not.
    second[headers.indexOf('instrument_id')] = '00000000-0000-4000-8000-0000000000d1';
    second[headers.indexOf('name')] = 'Nippon A';
    set(sheets, 'Holdings', 0, 'name', 'Nippon B');
    const found = messages(plan(sheets)).join('\n');
    expect(found).toMatch(/Holdings!3!name: This instrument is also on row 2, with a different name/);
  });
});

describe('adding rows', () => {
  it('finds the member and the category by the name written beside the empty id, and gives the row an id', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Expenses', { member_name: 'Venkatesh', category_name: ' groceries ', txn_date: '2026-10-31', amount: 642, currency: 'INR', payee: 'Swiggy', method: 'upi', visibility: 'household', ref: 'EXP-1' });
    const result = plan(sheets);
    expect(result.problems).toEqual([]);
    expect(result.warnings).toEqual([]);
    const created = result.rows.find((row) => row.action === 'create');
    expect(created).toMatchObject({ entity: 'expense_txn', sheetRow: 3, ref: 'EXP-1' });
    expect(created?.values).toMatchObject({ member_id: MEMBER, category_id: CATEGORY, amount_minor: '64200', payee: 'Swiggy' });
    expect(created?.key).toMatch(/^99999999-/);
    expect(created?.values['id']).toBe(created?.key);
  });

  it('warns about a new row with no reference, since the same file uploaded again would add it twice', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Expenses', { member_name: 'Venkatesh', txn_date: '2026-10-31', amount: 10, currency: 'INR' });
    const result = plan(sheets);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toMatch(/cannot be recognised/);
  });

  it('lets a new row point at another new row by its name, the parent first', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Categories', { name: 'Car insurance', nature: 'fixed', ref: 'CAT-2' });
    add(sheets, 'Expenses', { member_name: 'Venkatesh', category_name: 'Car insurance', txn_date: '2026-10-31', amount: 5000, currency: 'INR', ref: 'EXP-2' });
    const result = plan(sheets);
    expect(result.problems).toEqual([]);
    const category = result.rows.find((row) => row.entity === 'expense_category');
    const expense = result.rows.find((row) => row.entity === 'expense_txn' && row.action === 'create');
    expect(expense?.values['category_id']).toBe(category?.key);
    // Written parents before the rows that point at them.
    expect(result.rows.findIndex((row) => row.entity === 'expense_category')).toBeLessThan(result.rows.findIndex((row) => row.entity === 'expense_txn' && row.action === 'create'));
  });

  it('leaves out a blank where the database has a default, so a new row takes it, and writes null where there is none', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Categories', { name: 'Gifts', nature: 'variable', ref: 'CAT-3' });
    const created = plan(sheets).rows.find((row) => row.action === 'create');
    expect(created?.values).not.toHaveProperty('is_essential');
    expect(created?.values).not.toHaveProperty('status');
    expect(created?.values).toMatchObject({ name: 'Gifts', nature: 'variable', parent_id: null, archived_at: null });
  });

  it('adds a holding with a new instrument beside it, and one instrument for holdings that name the same one', () => {
    const sheets = sheetsOf(fixture());
    const cells = { member_name: 'Venkatesh', name: 'HDFC Bank', kind: 'equity', currency: 'INR', exposure_currency: 'INR', is_foreign_asset: false, quantity: 10, visibility: 'household', status: 'active' };
    add(sheets, 'Holdings', { ...cells, ref: 'H-1' });
    add(sheets, 'Holdings', { ...cells, quantity: 5, folio_last4: '4321', ref: 'H-2' });
    const result = plan(sheets);
    expect(result.problems).toEqual([]);
    const instruments = result.rows.filter((row) => row.entity === 'instrument');
    const holdings = result.rows.filter((row) => row.entity === 'holding');
    expect(instruments).toHaveLength(1);
    expect(holdings).toHaveLength(2);
    expect(holdings.map((row) => row.values['instrument_id'])).toEqual([instruments[0]?.key, instruments[0]?.key]);
    expect(result.rows.findIndex((row) => row.entity === 'instrument')).toBeLessThan(result.rows.findIndex((row) => row.entity === 'holding'));
  });

  it('puts a new holding under an instrument the household already has, found by name, kind and currency', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Holdings', { member_name: 'Venkatesh', name: 'nippon nifty 50', kind: 'fund', currency: 'INR', exposure_currency: 'INR', quantity: 3, folio_last4: '7777', ref: 'H-3' });
    const result = plan(sheets);
    expect(result.problems).toEqual([]);
    expect(result.rows.map((row) => `${row.action}:${row.entity}`)).toEqual(['create:holding']);
    expect(result.rows[0]?.values['instrument_id']).toBe('00000000-0000-4000-8000-0000000000d1');
  });

  it('puts the records under a holding by the holding’s name, new or old', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Readings', { holding_name: 'Nippon Nifty 50 (Venkatesh)', as_of_date: '2026-10-31', quantity: 1234.5678, value: 190000, currency: 'INR', source: 'manual', ref: 'R-1' });
    add(sheets, 'PPF payments', { holding_name: 'PPF (Venkatesh)', entry_date: '2026-10-31', amount: 25000, currency: 'INR', ref: 'P-1' });
    const result = plan(sheets);
    expect(result.problems).toEqual([]);
    expect(result.rows.find((row) => row.entity === 'valuation_snapshot')?.values['holding_id']).toBe(HOLDING);
    expect(result.rows.find((row) => row.entity === 'ppf_entry')?.values['holding_id']).toBe(PPF_HOLDING);
  });
});

describe('what the preview refuses, and where', () => {
  it('refuses an id that is not one of the household’s', () => {
    const sheets = sheetsOf(fixture());
    set(sheets, 'Categories', 0, 'id', '12345678-1234-4234-8234-123456789012');
    expect(messages(plan(sheets))).toEqual([expect.stringMatching(/^Categories!2!id: This id is not one of this household/)]);
  });

  it('refuses a name that finds nothing, and one that finds two', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Expenses', { member_name: 'Nobody', txn_date: '2026-10-31', amount: 10, currency: 'INR', ref: 'E-1' });
    expect(messages(plan(sheets))[0]).toMatch(/^Expenses!3!member_name: No member is called "Nobody"/);

    const existing = fixture();
    existing['expense_category'] = [
      ...(existing['expense_category'] ?? []),
      { ...(existing['expense_category']?.[0] as Row), id: '00000000-0000-4000-8000-0000000000c2' },
    ];
    const twice = sheetsOf(existing);
    add(twice, 'Expenses', { member_name: 'Venkatesh', category_name: 'Groceries', txn_date: '2026-10-31', amount: 10, currency: 'INR', ref: 'E-2' });
    expect(messages(plan(twice, existing))[0]).toMatch(/^Expenses!3!category_name: 2 expense category records are called "Groceries"/);
  });

  it('refuses an id written beside nothing: an id that points at no record', () => {
    const sheets = sheetsOf(fixture());
    set(sheets, 'Expenses', 0, 'member_id', '12345678-1234-4234-8234-123456789012');
    expect(messages(plan(sheets))[0]).toMatch(/^Expenses!2!member_id: There is no member with this id/);
  });

  it('refuses a value the database would, and a required value left empty, saying which and what is allowed', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Categories', { name: 'Bad', nature: 'sometimes', ref: 'C-9' });
    add(sheets, 'Categories', { nature: 'fixed', ref: 'C-10' });
    const found = messages(plan(sheets));
    expect(found).toContain('Categories!3!nature: "sometimes" is not one of: fixed, variable.');
    expect(found).toContain('Categories!4!name: This is required.');
  });

  it('refuses a new instrument whose kind is not one the app has, so no kind is invented by a file', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Holdings', { member_name: 'Venkatesh', name: 'Krugerrand', kind: 'gold', currency: 'INR', exposure_currency: 'INR', quantity: 1, ref: 'H-9' });
    expect(messages(plan(sheets)).join('\n')).toMatch(/Holdings!4!kind: "gold" is not one of: equity, etf, mutual_fund/);
  });

  it('refuses the same record twice in a file, and a reference that means two rows', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Categories', { id: CATEGORY, name: 'Again', nature: 'fixed' });
    expect(messages(plan(sheets))[0]).toMatch(/^Categories!3!id: This row is the same record as row 2/);

    const refs = sheetsOf(fixture());
    add(refs, 'Categories', { name: 'One', nature: 'fixed', ref: 'X' });
    add(refs, 'Categories', { name: 'Two', nature: 'fixed', ref: 'X' });
    expect(messages(plan(refs)).join('\n')).toMatch(/Categories!4!ref: The reference "X" is also on row 3/);
  });

  it('refuses a reference that already belongs to another row', () => {
    const OTHER = '00000000-0000-4000-8000-0000000000c2';
    const existing = fixture();
    existing['expense_category'] = [...(existing['expense_category'] ?? []), { ...(existing['expense_category']?.[0] as Row), id: OTHER, name: 'Fuel' }];
    const refs: RefMap = { expense_category: { [CATEGORY]: 'CAT-1' } };
    const sheets = sheetsOf(existing, refs);
    // The reference that is the first category's is written on the second.
    set(sheets, 'Categories', 0, 'ref', null);
    set(sheets, 'Categories', 1, 'ref', 'CAT-1');
    expect(messages(plan(sheets, existing, refs)).join('\n')).toMatch(/Categories!3!ref: The reference "CAT-1" already belongs to another expense category/);
  });

  it('says a parent must be above the rows under it, when a category names one that comes later', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Categories', { name: 'Child', nature: 'fixed', parent_name: 'Parent', ref: 'C-1' });
    add(sheets, 'Categories', { name: 'Parent', nature: 'fixed', ref: 'C-2' });
    expect(messages(plan(sheets)).join('\n')).toMatch(/A parent must be written above the rows under it/);
  });
});

describe('the payload the database takes', () => {
  it('is the rows to create and change, by sheet, with the row each came from and its reference', () => {
    const sheets = sheetsOf(fixture());
    add(sheets, 'Categories', { name: 'Gifts', nature: 'variable', ref: 'CAT-3' });
    set(sheets, 'Expenses', 0, 'payee', 'Changed');
    const payload = toApplyPayload(plan(sheets));
    expect(Object.keys(payload)).toEqual(['expense_category', 'expense_txn']);
    expect(payload['expense_category']?.[0]).toMatchObject({ sheet_row: 3, ref: 'CAT-3', values: { name: 'Gifts' } });
    expect(payload['expense_txn']?.[0]).toMatchObject({ sheet_row: 2, ref: null, values: { payee: 'Changed' } });
  });
});

describe('export, edit a hundred rows in Excel, upload, and land in the same state', () => {
  function household(rows: number): Record<string, Row[]> {
    const tables = fixture();
    const base = tables['expense_txn']?.[0] as Row;
    tables['expense_txn'] = Array.from({ length: rows }, (_, index) => ({
      ...base,
      id: `00000000-0000-4000-8000-${String(1000 + index).padStart(12, '0')}`,
      amount_minor: String(10000 + index * 100),
      payee: `Payee ${String(index)}`,
    }));
    return tables;
  }

  /** What the database would hold once these rows are written: each by its key, created or replaced column by column. */
  function applyTo(tables: Record<string, Row[]>, result: UploadPlan): Record<string, Row[]> {
    const next: Record<string, Row[]> = Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.map((row) => ({ ...row }))]));
    for (const row of result.rows) {
      const key = ENTITIES.find((entity) => entity.key === row.entity)?.rowKey[0] ?? 'id';
      const rows = (next[row.entity] ??= []);
      const at = rows.findIndex((candidate) => candidate[key] === row.key);
      if (at >= 0) rows[at] = { ...(rows[at] as Row), ...row.values };
      else rows.push({ ...row.values });
    }
    return next;
  }

  it('changes a hundred of a hundred and twenty and leaves twenty alone', () => {
    const tables = household(120);
    const sheets = sheetsOf(tables);
    for (let index = 0; index < 100; index += 1) {
      set(sheets, 'Expenses', index, 'amount', 200 + index);
      set(sheets, 'Expenses', index, 'note', `edited ${String(index)}`);
    }
    const result = plan(sheets, tables);
    expect(result.problems).toEqual([]);
    expect(result.rows).toHaveLength(100);
    expect(result.rows.every((row) => row.action === 'update' && row.entity === 'expense_txn')).toBe(true);
    expect(result.unchanged['expense_txn']).toBe(20);

    // Written, the household holds exactly those edits and nothing else has moved.
    const landed = applyTo(tables, result);
    const expense = ENTITIES.find((entity) => entity.key === 'expense_txn')!;
    expect(landed['expense_txn']).toHaveLength(120);
    expect(canonicalRow(expense, landed['expense_txn']?.[0] as Row)).toMatchObject({ amount_minor: '20000', note: 'edited 0' });
    expect(canonicalRow(expense, landed['expense_txn']?.[119] as Row)).toMatchObject({ amount_minor: String(10000 + 119 * 100) });
    expect(landed['holding']).toEqual(tables['holding']);

    // And exporting what landed and uploading that again has nothing left to write: a re-upload does not copy anything.
    const again = plan(sheetsOf(landed), landed);
    expect(again.rows).toEqual([]);
    expect(again.unchanged['expense_txn']).toBe(120);
  });

  it('uploads the same new rows twice and adds them once, because the reference leads to the row the first upload made', () => {
    const tables = fixture();
    const sheets = sheetsOf(tables);
    add(sheets, 'Categories', { name: 'Gifts', nature: 'variable', ref: 'CAT-3' });
    const first = plan(sheets, tables);
    expect(first.rows).toHaveLength(1);
    const landed = applyTo(tables, first);
    const refs: RefMap = { expense_category: { [first.rows[0]?.key ?? '']: 'CAT-3' } };

    // The same file, uploaded again: the household now holds the row and has its reference.
    const second = plan(sheets, landed, refs);
    expect(second.problems).toEqual([]);
    expect(second.rows).toHaveLength(0);
    expect(second.unchanged['expense_category']).toBe(2);
  });
});
