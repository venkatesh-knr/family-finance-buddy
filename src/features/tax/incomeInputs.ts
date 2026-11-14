/**
 * The Tax screen's typed income (docs/design/ledger-income.md section 8; the TaxIncomeInputs board).
 *
 * Gross salary from the payslip or Form 16, a business or professional net profit, other income at slab rates, and the tax deducted so far.
 * Every figure is optional, and the estimate covers what is typed. A Form 16 figure is its own row and is the one in force, with the payslip
 * figure kept beside it. None of it is derived from the Salary credits in Money, which are take-home (LI-I11). Pure: what is typed goes in
 * as text and comes out as figures or as words about what is wrong.
 */

import { minorUnitExponent, money, parseAmountToMinor, type Money } from '../../lib/money.ts';
import type { NewTaxInput, TaxInputRecord } from '../../repo/types.ts';

/** A rupee amount typed in, as money: zero for empty, and an error for what is not an amount. */
export function parseIncome(text: string): { readonly amount: Money; readonly error: string | null } {
  if (text.trim() === '') return { amount: money(0n, 'INR'), error: null };
  try {
    return { amount: money(parseAmountToMinor(text, 'INR'), 'INR'), error: null };
  } catch (error) {
    return { amount: money(0n, 'INR'), error: error instanceof Error ? error.message : 'That is not an amount.' };
  }
}

/** A net profit. A loss is refused by name and not guessed at: the estimate does not model one (LI-I19). */
export function parseBusiness(text: string): { readonly amount: Money; readonly error: string | null } {
  if (/^\s*[-−–]/.test(text)) {
    return {
      amount: money(0n, 'INR'),
      error: 'A business loss is not entered here: the estimate does not model one. Type the profit for the year, or leave this empty.',
    };
  }
  return parseIncome(text);
}

export interface SalaryInForce {
  readonly amount: Money;
  readonly source: 'payslip' | 'form16';
  /** For a Form 16 figure: what the payslip said, kept beside it. */
  readonly payslip: Money | null;
  readonly tds: Money | null;
  /** The day it was last typed or corrected, for the source pill: *From payslip · 14 Apr 2026*. */
  readonly on: string;
}

export interface FiguresInForce {
  readonly salary: SalaryInForce | null;
  readonly business: Money | null;
  readonly other: Money | null;
}

/**
 * What the estimate uses for one member and year: the Form 16 salary if there is one, otherwise the payslip's (with the payslip's kept to
 * say what it was); the typed business profit and other income. The tax deducted is the row in force's, or the other's if that has none.
 */
export function figuresInForce(records: readonly TaxInputRecord[], memberId: string, taxYear: string): FiguresInForce {
  const mine = records.filter((record) => record.memberId === memberId && record.taxYear === taxYear);
  const pick = (head: string, source: string): TaxInputRecord | undefined => mine.find((record) => record.head === head && record.source === source);

  const form16 = pick('salary', 'form16');
  const payslip = pick('salary', 'payslip') ?? pick('salary', 'typed');
  const inForce = form16 ?? payslip;
  const salary: SalaryInForce | null =
    inForce === undefined
      ? null
      : {
          amount: inForce.amount,
          source: form16 === undefined ? 'payslip' : 'form16',
          payslip: form16 !== undefined && payslip !== undefined ? payslip.amount : null,
          tds: inForce.tds ?? (form16 !== undefined ? (payslip?.tds ?? null) : null),
          on: inForce.updatedOn,
        };

  return {
    salary,
    business: pick('business', 'typed')?.amount ?? null,
    other: pick('other_sources', 'typed')?.amount ?? null,
  };
}

/**
 * Where Save writes the salary: the Form 16 row once there is one, so that an edit after a correction takes effect, and the payslip row
 * until then. Writing under a figure that is not the one in force would be saved, said so, and never used.
 */
export function salarySourceInForce(figures: FiguresInForce): 'payslip' | 'form16' {
  return figures.salary?.source ?? 'payslip';
}

/** Minor units back into something a person can edit: 228000000 is "2280000.00". */
function plain(value: Money): string {
  const exponent = minorUnitExponent(value.currency);
  const digits = value.minor.toString().padStart(exponent + 1, '0');
  return exponent === 0 ? digits : `${digits.slice(0, digits.length - exponent)}.${digits.slice(digits.length - exponent)}`;
}

export interface InputTexts {
  readonly salary: string;
  readonly business: string;
  readonly other: string;
  readonly tds: string;
}

/** What the fields open with: each figure in force as it was typed, and an empty field for what is not there. */
export function inputTexts(figures: FiguresInForce): InputTexts {
  return {
    salary: figures.salary === null ? '' : plain(figures.salary.amount),
    business: figures.business === null ? '' : plain(figures.business),
    other: figures.other === null ? '' : plain(figures.other),
    tds: figures.salary?.tds === null || figures.salary === null ? '' : plain(figures.salary.tds as Money),
  };
}

/**
 * What a Save writes: the salary as a payslip figure, or as a Form 16 figure of its own when it is corrected from Form 16; the profit and
 * the other income as typed ones; the tax so far on the salary's row. An empty field writes nothing, so a figure is corrected by typing it
 * again. Anything that cannot be read, a loss, or tax with no salary to have come off, is refused in words and nothing is written.
 */
export function rowsToSave(input: {
  readonly householdId: string;
  readonly memberId: string;
  readonly taxYear: string;
  readonly salary: string;
  readonly business: string;
  readonly other: string;
  readonly tds: string;
  readonly salarySource: 'payslip' | 'form16';
}): { readonly rows: readonly NewTaxInput[]; readonly error: string | null } {
  const salary = parseIncome(input.salary);
  const business = parseBusiness(input.business);
  const other = parseIncome(input.other);
  const tds = parseIncome(input.tds);
  const bad = [salary.error, business.error, other.error, tds.error].find((error) => error !== null);
  if (bad !== undefined && bad !== null) return { rows: [], error: bad };
  if (input.tds.trim() !== '' && input.salary.trim() === '') {
    return { rows: [], error: 'The tax deducted so far is typed with the salary it was taken from. Type the salary too, or leave this empty.' };
  }

  const base = { householdId: input.householdId, memberId: input.memberId, taxYear: input.taxYear } as const;
  const rows: NewTaxInput[] = [];
  if (input.salary.trim() !== '') {
    rows.push({ ...base, head: 'salary', amount: salary.amount, source: input.salarySource, ...(input.tds.trim() === '' ? {} : { tds: tds.amount }) });
  }
  if (input.business.trim() !== '') rows.push({ ...base, head: 'business', amount: business.amount, source: 'typed' });
  if (input.other.trim() !== '') rows.push({ ...base, head: 'other_sources', amount: other.amount, source: 'typed' });
  return { rows, error: null };
}

/** The estimate less the tax already deducted. Negative when more was taken than the estimate says is due, shown as it is. Null with no total or no tax typed. */
export function stillToPay(total: Money | null, tds: Money | null): Money | null {
  if (total === null || tds === null) return null;
  return money(total.minor - tds.minor, total.currency);
}
