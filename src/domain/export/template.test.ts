import { describe, expect, it } from 'vitest';
import { COLUMN_RULES } from './rules.generated.ts';
import { TEMPLATE_VERSION } from './entities.ts';
import { buildTemplate } from './template.ts';
import { planUpload } from './plan.ts';
import { readWorkbook } from './workbook.ts';

const NOW = '2026-10-31T06:00:00.000Z';

describe('the blank template', () => {
  const { sheets } = buildTemplate(NOW);
  const asRead = sheets.map((sheet) => ({ name: sheet.name, rows: [[...sheet.headers], ...sheet.rows.map((row) => [...row])] }));

  it('carries the version and the instructions on its first sheet', () => {
    const about = sheets[0];
    expect(about?.name).toBe('About');
    const items = Object.fromEntries((about?.rows ?? []).map((row) => [row[0], row[1]]));
    expect(items['Template version']).toBe(TEMPLATE_VERSION);
    expect(String(items['Ref'])).toMatch(/upload the corrected file again/i);
    expect(String(items['Deleting'])).toMatch(/never deletes/i);
  });

  it('has a sheet for each kind of record an upload takes, and none that it does not', () => {
    const names = sheets.map((sheet) => sheet.name);
    for (const taken of ['Categories', 'Expenses', 'Budgets', 'Holdings', 'Readings', 'Lots', 'Liabilities', 'Insurance', 'Properties', 'PPF payments']) expect(names).toContain(taken);
    for (const refused of ['Bond ratings', 'Household', 'Members', 'Instruments']) expect(names).not.toContain(refused);
  });

  it('has a ref column and a name column beside every id a person would not know', () => {
    const expenses = sheets.find((sheet) => sheet.name === 'Expenses');
    expect(expenses?.headers.slice(0, 2)).toEqual(['id', 'ref']);
    expect(expenses?.headers).toContain('member_name');
    expect(expenses?.headers).toContain('category_name');
  });

  it('offers a dropdown of exactly the values the database allows', () => {
    const categories = sheets.find((sheet) => sheet.name === 'Categories');
    expect(categories?.lists[categories.headers.indexOf('nature')]).toEqual(COLUMN_RULES['expense_category']?.['nature']?.values);
    const holdings = sheets.find((sheet) => sheet.name === 'Holdings');
    expect(holdings?.lists[holdings.headers.indexOf('kind')]).toEqual(COLUMN_RULES['instrument']?.['kind']?.values);
    expect(holdings?.lists[holdings.headers.indexOf('kind')]).not.toContain('gold');
  });

  it('has example rows that show the shape and are ignored by the reader', () => {
    const expenses = sheets.find((sheet) => sheet.name === 'Expenses');
    expect(expenses?.rows).toHaveLength(1);
    expect(expenses?.rows[0]?.[expenses.headers.indexOf('ref')]).toMatch(/^EXAMPLE/);
    const read = readWorkbook(asRead);
    expect(read.problems).toEqual([]);
    expect(read.sheets['expense_txn']).toEqual([]);
    expect(read.sheets['holding']).toEqual([]);
  });

  it('plans nothing from an unfilled template, and a filled one is read like an export', () => {
    const read = readWorkbook(asRead);
    const plan = planUpload({ read, existing: {}, existingRefs: {}, newId: () => '00000000-0000-4000-8000-000000000001' });
    expect(plan.problems).toEqual([]);
    expect(plan.rows).toEqual([]);

    // A person fills in a category and an expense that names it, in the template itself.
    const filled = asRead.map((sheet) => ({ ...sheet, rows: sheet.rows.map((row) => [...row]) }));
    const add = (name: string, cells: Record<string, string | number | boolean>) => {
      const target = filled.find((sheet) => sheet.name === name);
      const headers = target?.rows[0] ?? [];
      target?.rows.push(headers.map((header) => cells[String(header)] ?? null));
    };
    add('Categories', { name: 'Gifts', nature: 'variable', ref: 'CAT-1' });
    add('Expenses', { category_name: 'Gifts', txn_date: '2026-10-31', amount: 500, currency: 'INR', ref: 'EXP-1', member_name: 'Venkatesh' });
    const filledRead = readWorkbook(filled);
    expect(filledRead.problems).toEqual([]);
    const members = [{ id: '00000000-0000-4000-8000-0000000000a1', display_name: 'Venkatesh' }];
    const filledPlan = planUpload({ read: filledRead, existing: { member: members }, existingRefs: {}, newId: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })() });
    expect(filledPlan.problems).toEqual([]);
    expect(filledPlan.rows.map((row) => `${row.action}:${row.entity}`)).toEqual(['create:expense_category', 'create:expense_txn']);
  });
});
