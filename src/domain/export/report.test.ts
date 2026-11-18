import { describe, expect, it } from 'vitest';
import { COLUMN_RULES } from './rules.generated.ts';
import { INR_WHOLE, REPORT_SHEETS, buildReport, type ReportCell, type ReportSheet, type ReportValue } from './report.ts';
import { MEMBER_A, REPORT_META, reportFixture } from './reportFixture.ts';
import { WORD_TABLES } from './reportWords.ts';

/**
 * The report (docs/design/export-redesign.md section 2; XR-I1 to XR-I3): sheets and fields a person reads, only live records, a word for every code, formulas
 * for what a person would work out, and a Read me that says what is and is not in the file.
 */

const build = (tables = reportFixture()) => buildReport(tables, REPORT_META);
const sheetOf = (report: ReturnType<typeof build>, name: string): ReportSheet => {
  const found = report.sheets.find((sheet) => sheet.name === name);
  if (found === undefined) throw new Error(`no ${name} sheet`);
  return found;
};
const at = (sheet: ReportSheet, row: number, col: number): ReportCell | undefined => sheet.cells.find((cell) => cell.row === row && cell.col === col);
const valueAt = (sheet: ReportSheet, row: number, col: number): ReportValue | undefined => at(sheet, row, col)?.value;
const headersOf = (sheet: ReportSheet): string[] => sheet.cells.filter((cell) => cell.row === 1 && cell.style === 'header').map((cell) => String(cell.value));
const column = (sheet: ReportSheet, col: number): ReportValue[] => sheet.cells.filter((cell) => cell.col === col && cell.row > 1).map((cell) => cell.value);
const allText = (report: ReturnType<typeof build>): string[] => report.sheets.flatMap((sheet) => sheet.cells.flatMap((cell) => (typeof cell.value === 'string' ? [cell.value] : [])));

describe('the shape of the report', () => {
  it('writes the sheets in the order of the design, Read me first, and leaves none out for a household that has one of everything', () => {
    const report = build();
    expect(report.sheets.map((sheet) => sheet.name)).toEqual([...REPORT_SHEETS]);
    expect(report.leftOut).toEqual([]);
  });

  it('gives every data sheet a frozen first row and a filter over its table, and none to Read me and Summary', () => {
    for (const sheet of build().sheets) {
      if (sheet.tab === 'overview') {
        expect(sheet.freeze).toBe(false);
        expect(sheet.filter).toBeNull();
      } else {
        expect(sheet.freeze, sheet.name).toBe(true);
        expect(sheet.filter?.toCol, sheet.name).toBeGreaterThan(0);
      }
    }
  });

  it('writes the headers of the design for each sheet', () => {
    const report = build();
    expect(headersOf(sheetOf(report, 'Spending')).slice(0, 10)).toEqual(['Date', 'Month', 'Who', 'Category', 'Paid to', 'How paid', 'Amount', 'Currency', 'Note', 'Private']);
    expect(headersOf(sheetOf(report, 'Investments'))).toEqual(['Name', 'Type', 'Whose', 'Units', 'Invested', 'Latest value', 'Value as at', 'Gain', 'Gain %', 'Kept for', 'Held abroad', 'Currency']);
    expect(headersOf(sheetOf(report, 'Purchases and sales'))).toEqual(['Date', 'Investment', 'Whose', 'What happened', 'Units', 'Amount', 'Currency', 'Note']);
    expect(headersOf(sheetOf(report, 'Value history'))).toEqual(['Investment', 'Whose', 'Date', 'Units', 'Value', 'Currency', 'How', 'Note']);
    expect(headersOf(sheetOf(report, 'Deposits'))).toEqual(['Deposit', 'Bank', 'Principal', 'Interest rate', 'Started', 'Matures', 'Interest added', 'Account', 'Currency']);
    expect(headersOf(sheetOf(report, 'Property'))).toEqual(['Property', 'Type', 'Whose', 'Bought on', 'Price paid', 'Stamp duty', 'Registration', 'Total cost', 'Your share', 'You live in it', 'Currency']);
    expect(headersOf(sheetOf(report, 'Money in'))).toEqual(['Date', 'What it is', 'Whose', 'Into account', 'From', 'Amount', 'Currency', 'Private']);
    expect(headersOf(sheetOf(report, 'Loans'))).toEqual(['Loan', 'Type', 'Whose', 'EMI', 'Paid', 'Outstanding', 'As on', 'Paid so far']);
    expect(headersOf(sheetOf(report, 'Accounts'))).toEqual(['Account', 'Type', 'Whose', 'Balance', 'As on']);
    expect(headersOf(sheetOf(report, 'Monthly plan'))).toEqual(['Category', 'Per month', 'Per year', 'Currency', 'Financial year']);
  });
});

describe('XR-I1 — the report shows a person’s figures, not the database', () => {
  it('has no header that is an id, a ref or ends in _id, on any sheet', () => {
    for (const sheet of build().sheets) {
      for (const header of sheet.cells.filter((cell) => cell.style === 'header').map((cell) => String(cell.value))) {
        expect(header, `${sheet.name}: ${header}`).not.toMatch(/(^|[\s_])(id|ref)$|_id$/i);
      }
    }
  });

  it('holds no value from a code list anywhere: a person reads Card, UPI, Half-yearly and Yes, never card, upi, half_yearly or true', () => {
    const codes = new Set<string>(['true', 'false', 'TRUE', 'FALSE', 'personal', 'household', 'active', 'archived', 'lapsed']);
    for (const { entity, column: col } of WORD_TABLES) for (const value of COLUMN_RULES[entity]?.[col]?.values ?? []) if (value !== 'other') codes.add(value);
    for (const text of allText(build())) expect(codes.has(text), `a cell reads ${text}`).toBe(false);
  });

  it('leaves out a removed expense, a removed credit, an archived holding and everything under it, a lapsed policy and a closed loan', () => {
    const text = allText(build()).join('\n');
    for (const absent of ['A removed entry', 'A removed credit', 'An old fund', 'archived holding', 'A lapsed policy', 'Closed loan']) expect(text, absent).not.toContain(absent);
  });

  it('writes the words: How paid, What happened, How, Interest added and Paid', () => {
    const report = build();
    expect(column(sheetOf(report, 'Spending'), 6)).toEqual(['Card', 'UPI', 'Card', 'Cash', 'Auto-debit']);
    expect(column(sheetOf(report, 'Purchases and sales'), 4)).toEqual(['Sold', 'Bonus units', 'Bought']);
    expect(column(sheetOf(report, 'Value history'), 7)).toContain('Fetched price');
    expect(valueAt(sheetOf(report, 'Deposits'), 2, 7)).toBe('Quarterly');
    expect(column(sheetOf(report, 'Insurance'), 8)).toEqual(['Yearly', 'Monthly']);
  });

  it('merges kind, scheme and retirement type into one Type, and shows no units for a deposit or a retirement scheme', () => {
    const investments = sheetOf(build(), 'Investments');
    expect(column(investments, 2)).toEqual(['ETF', 'Fixed deposit (FD)', 'Mutual fund', 'NPS']);
    expect(investments.cells.filter((cell) => cell.col === 4 && cell.row > 1).map((cell) => [cell.row, cell.value])).toEqual([[2, 12.5], [4, 600]]);
  });

  it('marks the reader’s own private entries Yes, and leaves the column blank for the household’s', () => {
    expect(sheetOf(build(), 'Spending').cells.filter((cell) => cell.col === 10 && cell.row > 1).map((cell) => [cell.row, cell.value])).toEqual([[5, 'Yes']]);
    expect(column(sheetOf(build(), 'Money in'), 8)).toEqual(['Yes']);
  });

  it('shows an uncategorised expense as Not filed, newest first', () => {
    const spending = sheetOf(build(), 'Spending');
    expect(column(spending, 4)).toEqual(['Groceries', 'Fuel', 'Groceries', 'Groceries', 'Not filed']);
    expect((valueAt(spending, 2, 1) as Date).toISOString()).toBe('2026-10-28T00:00:00.000Z');
    expect((valueAt(spending, 2, 2) as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('XR-I2 — Read me lists exactly the sheets that are in the file, and those left out', () => {
  const readMeRows = (report: ReturnType<typeof build>): Map<string, string> => {
    const sheet = sheetOf(report, 'Read me');
    const map = new Map<string, string>();
    for (const cell of sheet.cells) if (cell.col === 1 && typeof cell.value === 'string') map.set(cell.value, String(valueAt(sheet, cell.row, 2) ?? ''));
    return map;
  };

  it('says whose it is and when, in India', () => {
    const rows = readMeRows(build());
    expect(rows.get('Household')).toBe('The Rao household');
    expect(rows.get('Made on')).toBe('17 November 2026');
    expect(rows.has('Sample figures')).toBe(false);
  });

  it('names every sheet it holds, and says nothing is left out, when everything is recorded', () => {
    const rows = readMeRows(build());
    for (const name of REPORT_SHEETS.filter((candidate) => candidate !== 'Read me')) expect(rows.has(name), name).toBe(true);
    expect(rows.has('Not in this file')).toBe(false);
  });

  it('leaves out a sheet with nothing in it, and says so with the words nothing recorded yet', () => {
    const everything = reportFixture();
    const only = { member: everything['member'] ?? [], expense_txn: everything['expense_txn'] ?? [], expense_category: everything['expense_category'] ?? [] };
    const report = build(only);
    expect(report.sheets.map((sheet) => sheet.name)).toEqual(['Read me', 'Summary', 'Spending']);
    const rows = readMeRows(report);
    expect(rows.has('Spending')).toBe(true);
    expect(rows.has('Investments')).toBe(false);
    expect(rows.get('Not in this file')).toBe(
      'Money in, monthly plan, investments, purchases and sales, value history, deposits, insurance, loans, property and accounts: nothing recorded yet. A sheet appears once there is something in it.',
    );
  });

  it('says Sample figures on Read me and on Summary for a demo household', () => {
    const report = buildReport(reportFixture(), { ...REPORT_META, demo: true });
    expect(readMeRows(report).get('Sample figures')).toMatch(/^Yes/);
    expect(String(valueAt(sheetOf(report, 'Summary'), 2, 1))).toContain('Sample figures');
  });
});

describe('XR-I3 — gains and totals are formulas, and the Summary is built from the sheets', () => {
  it('writes Gain, Gain % and Total cost as formulas, and Invested and Latest value as numbers', () => {
    const report = build();
    const investments = sheetOf(report, 'Investments');
    for (let row = 2; row <= 5; row += 1) {
      const r = String(row);
      expect(valueAt(investments, row, 8)).toEqual({ formula: `IF(OR(E${r}="",F${r}=""),"",F${r}-E${r})` });
      expect(valueAt(investments, row, 9)).toEqual({ formula: `IF(OR(E${r}="",E${r}=0,F${r}=""),"",(F${r}-E${r})/E${r})` });
    }
    expect(valueAt(investments, 4, 5)).toBe(90000);
    expect(valueAt(investments, 4, 6)).toBe(224000);
    expect(valueAt(sheetOf(report, 'Property'), 2, 8)).toEqual({ formula: 'SUM(E2:G2)' });
  });

  it('groups amounts in lakhs and crores and keeps them numbers', () => {
    expect(at(sheetOf(build(), 'Investments'), 4, 6)?.format).toBe(INR_WHOLE);
    expect(INR_WHOLE).toContain('##\\,##\\,##0');
    expect(at(sheetOf(build(), 'Spending'), 2, 7)?.format).toContain('0.00');
  });

  it('builds the Summary from SUMIFS over the Investments and Spending sheets, per rupee type and per month', () => {
    const summary = sheetOf(build(), 'Summary');
    expect(valueAt(summary, 4, 1)).toBe('Investments by type (INR)');
    expect(summary.cells.filter((cell) => cell.col === 1 && cell.row >= 5 && cell.row <= 7).map((cell) => cell.value)).toEqual(['Fixed deposit (FD)', 'Mutual fund', 'NPS']);
    expect(valueAt(summary, 5, 2)).toEqual({ formula: 'SUMIFS(Investments!$E:$E,Investments!$B:$B,$A5,Investments!$L:$L,"INR")' });
    expect(valueAt(summary, 5, 3)).toEqual({ formula: 'SUMIFS(Investments!$F:$F,Investments!$B:$B,$A5,Investments!$L:$L,"INR")' });
    expect(valueAt(summary, 8, 2)).toEqual({ formula: 'SUM(B5:B7)' });
    // Dollar holdings are on their own sheet and are never added to the rupee total.
    expect(summary.cells.some((cell) => cell.value === 'Holdings in other currencies are on the Investments sheet and are not added here.')).toBe(true);
    const monthBlock = summary.blocks.find((block) => block.key === 'spending-by-month');
    expect(monthBlock).toBeDefined();
    const first = monthBlock?.firstRow ?? 0;
    expect(valueAt(summary, first, 2)).toEqual({ formula: `SUMIFS(Spending!$G:$G,Spending!$B:$B,$A${String(first)},Spending!$H:$H,"INR")` });
    expect(valueAt(summary, first, 3)).toEqual({ formula: "SUMIFS('Monthly plan'!$B:$B,'Monthly plan'!$D:$D,\"INR\")" });
  });

  it('works the Summary’s sums out to the same figures as the sheets hold, per currency', () => {
    // The formulas are evaluated here the way SUMIFS would, over the sheets' own cells, and held to the household's own sums.
    const investments = sheetOf(build(), 'Investments');
    const rows = new Map<number, Record<number, ReportValue>>();
    for (const cell of investments.cells) {
      const row = rows.get(cell.row) ?? {};
      row[cell.col] = cell.value;
      rows.set(cell.row, row);
    }
    const sumInr = (valueColumn: number, type: string): number =>
      [...rows.entries()]
        .filter(([row, cells]) => row > 1 && cells[2] === type && cells[12] === 'INR')
        .reduce((total, [, cells]) => total + (typeof cells[valueColumn] === 'number' ? (cells[valueColumn] as number) : 0), 0);
    expect(sumInr(5, 'Mutual fund')).toBe(90000);
    expect(sumInr(6, 'Mutual fund')).toBe(224000);
    expect(sumInr(5, 'Fixed deposit (FD)')).toBe(300000);
    // The dollar ETF is in no rupee sum.
    expect(sumInr(5, 'ETF')).toBe(0);
  });

  it('keeps every dollar row out of the rupee blocks, and ranks the rupee categories largest first', () => {
    const spending = sheetOf(build(), 'Spending');
    expect(column(spending, 8)).toContain('USD');
    const byCategory = spending.blocks.find((block) => block.key === 'by-category');
    expect(byCategory?.firstCol).toBe(12);
    expect(valueAt(spending, 2, 13)).toEqual({ formula: 'SUMIFS($G:$G,$D:$D,L2,$H:$H,"INR")' });
    expect(column(spending, 12)).toEqual(['Groceries', 'Fuel', 'Not filed']);
  });
});

describe('what each sheet says of a record', () => {
  it('Loans: paid so far is the payments not voided, and the closed loan is not there', () => {
    const loans = sheetOf(build(), 'Loans');
    expect(valueAt(loans, 2, 1)).toBe('Home loan');
    expect(valueAt(loans, 2, 4)).toBe(32000);
    expect(valueAt(loans, 2, 8)).toBe(32000);
    expect(valueAt(loans, 3, 1)).toBeUndefined();
  });

  it('Accounts: a card’s balance is what is owed, as a minus, and the latest balance wins', () => {
    const accounts = sheetOf(build(), 'Accounts');
    expect(valueAt(accounts, 2, 1)).toBe('HDFC savings ••4821');
    expect(valueAt(accounts, 2, 4)).toBe(220380);
    expect(valueAt(accounts, 3, 1)).toBe('ICICI card ••1188');
    expect(valueAt(accounts, 3, 4)).toBe(-12200);
  });

  it('Insurance: a policy with no member covers the Family, and the number shows its last four', () => {
    const insurance = sheetOf(build(), 'Insurance');
    expect(valueAt(insurance, 2, 5)).toBe('Venkatesh');
    expect(valueAt(insurance, 3, 5)).toBe('Family');
    expect(valueAt(insurance, 2, 4)).toBe('••9012');
    expect(headersOf(insurance)).not.toContain('Premiums end');
  });

  it('Monthly plan: a category’s month and year sit side by side, in a financial year written 2026-27', () => {
    const plan = sheetOf(build(), 'Monthly plan');
    expect(valueAt(plan, 2, 1)).toBe('Fuel');
    expect(valueAt(plan, 2, 2)).toBe(6000);
    expect(valueAt(plan, 2, 3)).toBe(72000);
    expect(valueAt(plan, 2, 5)).toBe('2026-27');
    expect(valueAt(plan, 3, 3)).toBeUndefined();
  });

  it('Deposits: the rate is a percentage, the latest renewal wins, and the account shows its last four', () => {
    const tables = reportFixture();
    tables['deposit_renewal'] = [
      { id: 'r', holding_id: '00000000-0000-4000-8000-0000000000e2', start_date: '2027-07-04', maturity_date: '2028-07-04', principal_minor: '31000000', currency: 'INR', rate_pct: '7', compounding: 'yearly', note: null },
    ];
    const deposits = sheetOf(build(tables), 'Deposits');
    expect(valueAt(deposits, 2, 4)).toBe(0.07);
    expect(valueAt(deposits, 2, 3)).toBe(310000);
    expect(valueAt(deposits, 2, 7)).toBe('Yearly');
    expect(valueAt(deposits, 2, 8)).toBe('••4521');
  });

  it('Purchases and sales: a bonus has units and no amount', () => {
    const bonus = sheetOf(build(), 'Purchases and sales').cells.filter((cell) => cell.row === 3);
    expect(bonus.find((cell) => cell.col === 4)?.value).toBe('Bonus units');
    expect(bonus.find((cell) => cell.col === 6)).toBeUndefined();
    expect(bonus.find((cell) => cell.col === 5)?.value).toBe(60);
  });

  it('uses a member’s name for Whose, never an id', () => {
    expect(column(sheetOf(build(), 'Investments'), 3)).toContain('Meera');
    expect(allText(build()).some((text) => text === MEMBER_A)).toBe(false);
  });
});
