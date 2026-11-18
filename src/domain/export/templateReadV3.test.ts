import { describe, expect, it } from 'vitest';
import { planUpload, toApplyPayload } from './plan.ts';
import { isTemplateV3, readTemplateV3 } from './templateReadV3.ts';
import { TEMPLATE_SHEETS, TRADE_CHOICES, INVESTMENT_TYPES, rowKey, type TemplateSheet } from './templateV3.ts';
import type { Row } from './entities.ts';
import type { ReadSheet } from './workbook.ts';
import { COLUMN_RULES } from './rules.generated.ts';

/**
 * Reading a filled version 3 template (docs/design/export-redesign.md section 3; XR-I8, XR-I9, XR-I10): words become codes, names are written beside ids, the
 * row key becomes the ref, the example and the empty rows are skipped, and what is read plans into the same rows a version 2 file of the same things would.
 */

const MEMBER = '00000000-0000-4000-8000-0000000000a1';
const CATEGORY = '00000000-0000-4000-8000-0000000000c1';
const TEMPLATE_ID = 'TPL-7F3A';

const date = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/** A sheet as the file reader hands it over: the headers, the example, the keys, and the filled rows put in place of the first keys. */
function sheetOf(spec: TemplateSheet, filled: readonly (readonly (string | number | Date | null)[])[]): ReadSheet {
  const width = spec.columns.length;
  const rows: (string | number | Date | null)[][] = [
    ['Row key', ...spec.columns.map((column) => column.header)],
    ['EXAMPLE', ...spec.columns.map((column, i) => (i === 0 ? 'An example' : (spec.example[column.header] as string | number | undefined) ?? null))],
  ];
  for (let n = 1; n <= 12; n += 1) {
    const fill = filled[n - 1];
    rows.push([rowKey(spec.prefix, n), ...(fill === undefined ? Array<null>(width).fill(null) : [...fill, ...Array<null>(Math.max(0, width - fill.length)).fill(null)])]);
  }
  return { name: spec.name, rows };
}

const howToFill: ReadSheet = { name: 'How to fill', rows: [['Family Finance Buddy · add your data'], [`Template version 3 · id ${TEMPLATE_ID}`]] };
const spec = (name: string): TemplateSheet => TEMPLATE_SHEETS.find((sheet) => sheet.name === name) as TemplateSheet;

/** A household's existing rows: one member, one category. */
const existing = (): Record<string, Row[]> => ({
  member: [{ id: MEMBER, display_name: 'Venkatesh' }],
  expense_category: [{ id: CATEGORY, name: 'Groceries', parent_id: null, nature: 'variable', is_essential: 'true', sort_order: '1', status: 'active', archived_at: null }],
});

const counter = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
};

describe('telling a version 3 template from a version 2 file', () => {
  it('knows it by the How to fill sheet and its marker, and not a version 2 file with its About sheet', () => {
    expect(isTemplateV3([howToFill])).toBe(true);
    expect(isTemplateV3([{ name: 'About', rows: [['Template version', 2]] }])).toBe(false);
    expect(isTemplateV3([{ name: 'How to fill', rows: [['No marker here']] }])).toBe(false);
  });

  it('refuses a workbook that is not a version 3 template, in words', () => {
    const read = readTemplateV3([{ name: 'About', rows: [['Template version', 2]] }], { investments: [] });
    expect(read.problems[0]?.message).toMatch(/version 3 template/);
  });
});

describe('XR-I10 — the example row and an empty row are never uploaded', () => {
  it('skips the example, and every row whose visible cells are empty, though its key is there', () => {
    const read = readTemplateV3([howToFill, sheetOf(spec('Spending'), [[date('2026-10-31'), 642.5, null, 'Groceries', 'Venkatesh', 'Big Basket', 'UPI']])], { investments: [] });
    expect(read.problems).toEqual([]);
    expect(read.sheets['expense_txn']).toHaveLength(1);
    expect(read.sheets['expense_txn']?.[0]?.sheetRow).toBe(3);
  });
});

describe('reading each sheet', () => {
  it('Spending: words become codes, the currency is INR when empty, Private becomes personal, and names sit beside the ids', () => {
    const read = readTemplateV3(
      [howToFill, sheetOf(spec('Spending'), [[date('2026-10-31'), 642.5, null, 'Groceries', 'Venkatesh', 'Big Basket', 'UPI', null, 'Weekly shop', 'Yes']])],
      { investments: [] },
    );
    const row = read.sheets['expense_txn']?.[0];
    expect(row?.values).toMatchObject({ txn_date: '2026-10-31', amount_minor: '64250', currency: 'INR', method: 'upi', payee: 'Big Basket', note: 'Weekly shop', visibility: 'personal' });
    expect(row?.names).toEqual({ member_id: 'Venkatesh', category_id: 'Groceries' });
    expect(row?.ref).toBe(`${TEMPLATE_ID}:SP-0001`);
  });

  it('Monthly plan: one budget for each of Per month and Per year that is filled, the financial year as its first year', () => {
    const read = readTemplateV3([howToFill, sheetOf(spec('Monthly plan'), [['Groceries', 18000, 120000, '2026-27']])], { investments: [] });
    expect(read.sheets['budget']?.map((row) => [row.values['cadence'], row.values['planned_minor'], row.values['fy'], row.ref])).toEqual([
      ['monthly', '1800000', '2026', `${TEMPLATE_ID}:PL-0001:month`],
      ['yearly', '12000000', '2026', `${TEMPLATE_ID}:PL-0001:year`],
    ]);
  });

  it('Investments: Type becomes kind, scheme and retirement type; a deposit has one unit; Latest value becomes a reading', () => {
    const read = readTemplateV3(
      [
        howToFill,
        sheetOf(spec('Investments'), [
          ['Demo Flexi Cap Fund', 'Mutual fund', 'Venkatesh', 1500.5, 90000, date('2025-09-27'), 224000, date('2026-08-31'), 'Nothing in particular', 'No'],
          ['Bank FD', 'Fixed deposit (FD)', 'Venkatesh', null, 300000, null, null, null, 'Emergency'],
        ]),
      ],
      { investments: [] },
    );
    const [fund, deposit] = read.sheets['holding'] ?? [];
    expect(fund?.values).toMatchObject({ name: 'Demo Flexi Cap Fund', kind: 'mutual_fund', scheme: null, quantity: '1500.5', cost_minor: '9000000', opened_on: '2025-09-27', earmark: 'none', is_foreign_asset: 'false', currency: 'INR' });
    expect(deposit?.values).toMatchObject({ kind: 'deposit', scheme: 'fd', quantity: '1', earmark: 'emergency' });
    expect(read.sheets['valuation_snapshot']).toHaveLength(1);
    expect(read.sheets['valuation_snapshot']?.[0]).toMatchObject({ names: { holding_id: 'Demo Flexi Cap Fund (Venkatesh)' }, values: { as_of_date: '2026-08-31', value_minor: '22400000', quantity: '1500.5', source: 'manual' } });
  });

  it('Purchases and sales: Bought is a lot and Sold is a disposal, and a bonus with no amount is accepted', () => {
    const read = readTemplateV3(
      [
        howToFill,
        sheetOf(spec('Purchases and sales'), [
          [date('2026-04-15'), 'Demo Flexi Cap Fund (Venkatesh)', 'Bought', 600, 90000],
          [date('2026-09-10'), 'Demo Flexi Cap Fund (Venkatesh)', 'Sold', 100, 37000],
          [date('2026-06-01'), 'Demo Flexi Cap Fund (Venkatesh)', 'Bonus units', 60, null],
        ]),
      ],
      { investments: ['Demo Flexi Cap Fund (Venkatesh)'] },
    );
    expect(read.problems).toEqual([]);
    expect(read.sheets['lot']?.map((row) => [row.values['kind'], row.values['cost_minor'], row.values['quantity']])).toEqual([['purchase', '9000000', '600'], ['bonus', '0', '60']]);
    expect(read.sheets['disposal']?.map((row) => [row.values['kind'], row.values['proceeds_minor']])).toEqual([['sale', '3700000']]);
    expect(read.sheets['lot']?.[0]?.names).toEqual({ holding_id: 'Demo Flexi Cap Fund (Venkatesh)' });
  });

  it('asks for an amount on a purchase, and says which word is not in the list', () => {
    const read = readTemplateV3(
      [howToFill, sheetOf(spec('Purchases and sales'), [[date('2026-04-15'), 'X (Venkatesh)', 'Bought', 6, null], [date('2026-04-16'), 'X (Venkatesh)', 'Gave away', 1, 10]])],
      { investments: [] },
    );
    expect(read.problems.map((p) => [p.row, p.column])).toEqual([[3, 'Amount'], [4, 'What happened * ▾']]);
    expect(read.problems[1]?.message).toContain('"Gave away" is not one of');
  });

  it('every word in the Purchases and sales list maps to a lot or a disposal, and every investment type to a kind', () => {
    expect(TRADE_CHOICES.map((choice) => choice.code.table).sort()).toEqual(['disposal', 'disposal', 'disposal', 'disposal', 'disposal', 'lot', 'lot', 'lot', 'lot', 'lot', 'lot']);
    for (const { code } of TRADE_CHOICES) expect(COLUMN_RULES[code.table]?.['kind']?.values).toContain(code.kind);
    for (const { code } of INVESTMENT_TYPES) {
      expect(COLUMN_RULES['instrument']?.['kind']?.values).toContain(code.kind);
      if (code.scheme !== null) expect(COLUMN_RULES['instrument']?.['scheme']?.values).toContain(code.scheme);
      if (code.retirement !== null) expect(COLUMN_RULES['instrument']?.['retirement_type']?.values).toContain(code.retirement);
    }
  });

  it('XR-I8 — a name that means two of the household’s investments stops the preview and says so', () => {
    const read = readTemplateV3(
      [howToFill, sheetOf(spec('Purchases and sales'), [[date('2026-04-15'), 'Twin Fund (Venkatesh)', 'Bought', 6, 600]])],
      { investments: ['Twin Fund (Venkatesh)', 'Twin Fund (Venkatesh)'] },
    );
    expect(read.problems).toHaveLength(1);
    expect(read.problems[0]?.message).toContain('is two of your investments');
  });

  it('Deposits: found by the name on Investments, whether it is in this file or already in the household, and refused when it means two', () => {
    const sheets = [
      howToFill,
      sheetOf(spec('Investments'), [['Bank FD', 'Fixed deposit (FD)', 'Venkatesh', null, 300000]]),
      sheetOf(spec('Deposits'), [
        ['Bank FD', 'Demo Bank', 300000, 6.5, date('2026-07-04'), date('2027-07-04'), 'Quarterly', '4521'],
        ['Older FD', 'Demo Bank', 100000, 7, date('2025-07-04'), date('2026-07-04'), 'Yearly', null],
        ['Both FD', 'Demo Bank', 100000, 7, date('2025-07-04'), date('2026-07-04'), 'Yearly', null],
      ]),
    ];
    const read = readTemplateV3(sheets, { investments: ['Older FD (Venkatesh)', 'Both FD (Venkatesh)', 'Both FD (Meera)'] });
    expect(read.sheets['fixed_income_terms']?.map((row) => row.names['holding_id'])).toEqual(['Bank FD (Venkatesh)', 'Older FD (Venkatesh)']);
    expect(read.sheets['fixed_income_terms']?.[0]?.values).toMatchObject({ rate_pct: '6.5', compounding: 'quarterly', account_last4: '4521', principal_minor: '30000000' });
    expect(read.problems.map((p) => p.message)).toEqual(['"Both FD" is more than one investment: Both FD (Venkatesh) and Both FD (Meera). Rename one so this file can tell them apart.']);
  });

  it('Money in: is not taken by an upload yet, and says where to add it', () => {
    const read = readTemplateV3([howToFill, sheetOf(spec('Money in'), [[date('2026-11-01'), 142000, null, 'Salary', 'Venkatesh']])], { investments: [] });
    expect(read.problems[0]?.message).toContain('does not take money in yet');
  });
});

describe('XR-I9 — a filled version 3 template uploads to the rows a version 2 file of the same things would, and uploading it twice changes nothing', () => {
  const filled = () =>
    readTemplateV3(
      [
        howToFill,
        sheetOf(spec('Spending'), [[date('2026-10-31'), 642.5, null, 'Groceries', 'Venkatesh', 'Big Basket', 'UPI']]),
        sheetOf(spec('Monthly plan'), [['Groceries', 18000, null, '2026-27']]),
        sheetOf(spec('Investments'), [['Demo Flexi Cap Fund', 'Mutual fund', 'Venkatesh', 600, 90000, date('2026-04-15'), null, null, null, 'No']]),
        sheetOf(spec('Purchases and sales'), [[date('2026-04-15'), 'Demo Flexi Cap Fund (Venkatesh)', 'Bought', 600, 90000]]),
      ],
      { investments: [] },
    );

  it('plans without problems, and every created row carries the template’s id in its ref', () => {
    const read = filled();
    expect(read.problems).toEqual([]);
    const plan = planUpload({ read, existing: existing(), existingRefs: {}, newId: counter() });
    expect(plan.problems).toEqual([]);
    const created = plan.rows.filter((row) => row.action === 'create');
    expect(created.map((row) => row.entity).sort()).toEqual(['budget', 'expense_txn', 'holding', 'instrument', 'lot']);
    for (const row of created.filter((candidate) => candidate.entity !== 'instrument')) expect(row.ref).toMatch(new RegExp(`^${TEMPLATE_ID}:`));
  });

  it('plans the same rows as the equivalent version 2 rows: the values the database takes are the same', () => {
    const plan = planUpload({ read: filled(), existing: existing(), existingRefs: {}, newId: counter() });
    const payload = toApplyPayload(plan);
    expect(payload['expense_txn']?.[0]?.values).toMatchObject({ member_id: MEMBER, category_id: CATEGORY, txn_date: '2026-10-31', amount_minor: '64250', currency: 'INR', payee: 'Big Basket', method: 'upi', visibility: 'household' });
    expect(payload['budget']?.[0]?.values).toMatchObject({ category_id: CATEGORY, fy: '2026', cadence: 'monthly', planned_minor: '1800000', currency: 'INR' });
    expect(payload['holding']?.[0]?.values).toMatchObject({ member_id: MEMBER, quantity: '600', cost_minor: '9000000', opened_on: '2026-04-15', earmark: 'none' });
    const holdingId = plan.rows.find((row) => row.entity === 'holding')?.key;
    expect(payload['lot']?.[0]?.values).toMatchObject({ holding_id: holdingId, acquired_on: '2026-04-15', quantity: '600', cost_minor: '9000000', kind: 'purchase', currency: 'INR' });
  });

  it('changes nothing the second time: the same file, against what the first upload made, plans no row', () => {
    const first = planUpload({ read: filled(), existing: existing(), existingRefs: {}, newId: counter() });
    // What the database holds after the first upload: its rows with their ids, and the references the upload recorded.
    const tables: Record<string, Row[]> = existing();
    const refs: Record<string, Record<string, string>> = {};
    for (const row of first.rows) {
      (tables[row.entity] ??= []).push({ id: row.key, ...row.values } as Row);
      if (row.ref !== null) (refs[row.entity] ??= {})[row.key] = row.ref;
    }
    const second = planUpload({ read: filled(), existing: tables, existingRefs: refs, newId: counter() });
    expect(second.problems).toEqual([]);
    expect(second.rows.filter((row) => row.action === 'create')).toEqual([]);
    expect(second.rows.filter((row) => row.action === 'update' && row.changes.length > 0)).toEqual([]);
  });
});
