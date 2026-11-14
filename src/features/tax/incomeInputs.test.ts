import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { TaxInputRecord } from '../../repo/types.ts';
import { figuresInForce, inputTexts, parseBusiness, parseIncome, rowsToSave, salarySourceInForce, stillToPay } from './incomeInputs.ts';

/**
 * The Tax screen's typed income (docs/design/ledger-income.md section 8; the TaxIncomeInputs board): gross salary from the payslip or Form 16,
 * a business or professional net profit, other income at slab rates, and tax deducted so far. Every figure is optional, a Form 16 figure
 * is its own row and is the one in force, and the payslip figure stays beside it.
 */

const inr = (rupees: number) => money(BigInt(rupees) * 100n, 'INR');

const row = (patch: Partial<TaxInputRecord>): TaxInputRecord => ({
  id: 'i-1',
  householdId: 'h-1',
  memberId: 'm-1',
  taxYear: '2026-27',
  head: 'salary',
  amount: inr(2_280_000),
  tds: null,
  source: 'payslip',
  typedBy: 'u-1',
  updatedOn: '2026-04-14',
  ...patch,
});

describe('parseIncome — an amount typed', () => {
  it('is nothing for nothing, and the amount for an amount', () => {
    expect(parseIncome('').amount).toEqual(inr(0));
    expect(parseIncome('22,80,000').amount).toEqual(inr(2_280_000));
    expect(parseIncome('1800000').error).toBeNull();
  });

  it('is an error for what is not an amount, and not nothing', () => {
    expect(parseIncome('about a lakh').error).not.toBeNull();
  });
});

describe('parseBusiness — a net profit, never a loss', () => {
  it('LI-I19 — reads a profit like any amount', () => {
    expect(parseBusiness('12,00,000')).toEqual({ amount: inr(1_200_000), error: null });
    expect(parseBusiness('')).toEqual({ amount: inr(0), error: null });
  });

  it('LI-I19 — refuses a loss by name, and says what to do', () => {
    const loss = parseBusiness('-50000');
    expect(loss.error).toMatch(/loss/i);
    expect(loss.error).toMatch(/not modelled|not entered/i);
  });
});

describe('figuresInForce — what the estimate uses', () => {
  it('uses the payslip figure for salary, the typed one for business and for other income', () => {
    const figures = figuresInForce(
      [row({}), row({ id: 'i-2', head: 'business', source: 'typed', amount: inr(500_000) }), row({ id: 'i-3', head: 'other_sources', source: 'typed', amount: inr(80_000) })],
      'm-1',
      '2026-27',
    );
    expect(figures.salary).toMatchObject({ amount: inr(2_280_000), source: 'payslip', payslip: null });
    expect(figures.business).toEqual(inr(500_000));
    expect(figures.other).toEqual(inr(80_000));
  });

  it('LI-I11 — uses the Form 16 figure once there is one, and keeps the payslip figure to say what it was', () => {
    const figures = figuresInForce([row({}), row({ id: 'i-2', source: 'form16', amount: inr(2_300_000) })], 'm-1', '2026-27');
    expect(figures.salary).toMatchObject({ amount: inr(2_300_000), source: 'form16', payslip: inr(2_280_000) });
  });

  it('says on what day the figure in force was typed, which is the source pill’s date', () => {
    const figures = figuresInForce([row({}), row({ id: 'i-2', source: 'form16', amount: inr(2_300_000), updatedOn: '2027-06-12' })], 'm-1', '2026-27');
    expect(figures.salary?.on).toBe('2027-06-12');
    expect(figuresInForce([row({})], 'm-1', '2026-27').salary?.on).toBe('2026-04-14');
  });

  it('takes the tax deducted from the row in force, and from the other if that one has none', () => {
    const both = figuresInForce([row({ tds: inr(100_000) }), row({ id: 'i-2', source: 'form16', amount: inr(2_300_000), tds: inr(120_000) })], 'm-1', '2026-27');
    expect(both.salary?.tds).toEqual(inr(120_000));
    const fallback = figuresInForce([row({ tds: inr(100_000) }), row({ id: 'i-2', source: 'form16', amount: inr(2_300_000), tds: null })], 'm-1', '2026-27');
    expect(fallback.salary?.tds).toEqual(inr(100_000));
  });

  it('reads only the member and the year it is asked for, and has nothing for what is not typed', () => {
    const figures = figuresInForce([row({ memberId: 'm-2' }), row({ id: 'i-9', taxYear: '2025-26' })], 'm-1', '2026-27');
    expect(figures).toEqual({ salary: null, business: null, other: null });
  });
});

describe('salarySourceInForce — where Save writes the salary', () => {
  it('LI-I11 — is the Form 16 row once there is one, so that a later edit takes effect and is not written under a figure that is not used', () => {
    expect(salarySourceInForce(figuresInForce([row({}), row({ id: 'i-2', source: 'form16', amount: inr(2_300_000) })], 'm-1', '2026-27'))).toBe('form16');
  });

  it('is the payslip row until then, and when nothing is typed', () => {
    expect(salarySourceInForce(figuresInForce([row({})], 'm-1', '2026-27'))).toBe('payslip');
    expect(salarySourceInForce({ salary: null, business: null, other: null })).toBe('payslip');
  });
});

describe('inputTexts — what the fields open with', () => {
  it('writes each figure in force as the person typed it, and an empty field for what is not there', () => {
    const texts = inputTexts(
      figuresInForce([row({ tds: inr(250_000) }), row({ id: 'i-2', head: 'business', source: 'typed', amount: inr(500_000) })], 'm-1', '2026-27'),
    );
    expect(texts).toEqual({ salary: '2280000.00', business: '500000.00', other: '', tds: '250000.00' });
  });

  it('is all empty when nothing is typed', () => {
    expect(inputTexts({ salary: null, business: null, other: null })).toEqual({ salary: '', business: '', other: '', tds: '' });
  });
});

describe('rowsToSave — what a Save writes', () => {
  const ctx = { householdId: 'h-1', memberId: 'm-1', taxYear: '2026-27' };

  it('writes the salary as a payslip figure, the profit and the other income as typed ones, and the tax on the salary row', () => {
    const made = rowsToSave({ ...ctx, salary: '22,80,000', business: '5,00,000', other: '80,000', tds: '2,50,000', salarySource: 'payslip' });
    expect(made.error).toBeNull();
    expect(made.rows.map((r) => [r.head, r.source, r.amount.minor, r.tds?.minor ?? null])).toEqual([
      ['salary', 'payslip', 228_000_000n, 25_000_000n],
      ['business', 'typed', 50_000_000n, null],
      ['other_sources', 'typed', 8_000_000n, null],
    ]);
  });

  it('LI-I11 — writes the salary as a Form 16 figure of its own when it is corrected from Form 16', () => {
    const made = rowsToSave({ ...ctx, salary: '23,00,000', business: '', other: '', tds: '', salarySource: 'form16' });
    expect(made.rows.map((r) => [r.head, r.source])).toEqual([['salary', 'form16']]);
  });

  it('writes nothing for a field left empty: every input is optional', () => {
    expect(rowsToSave({ ...ctx, salary: '', business: '', other: '', tds: '', salarySource: 'payslip' })).toEqual({ rows: [], error: null });
  });

  it('refuses an amount that is not one, a loss, and tax with no salary to have been taken from, each in words, and writes none', () => {
    expect(rowsToSave({ ...ctx, salary: 'a lot', business: '', other: '', tds: '', salarySource: 'payslip' }).error).not.toBeNull();
    expect(rowsToSave({ ...ctx, salary: '', business: '-1', other: '', tds: '', salarySource: 'payslip' }).error).toMatch(/loss/i);
    const tdsOnly = rowsToSave({ ...ctx, salary: '', business: '', other: '', tds: '1000', salarySource: 'payslip' });
    expect(tdsOnly.error).toMatch(/salary/i);
    expect(tdsOnly.rows).toEqual([]);
  });
});

describe('stillToPay — the estimate less the tax already deducted', () => {
  it('is the total less the tax so far, and nothing below nothing', () => {
    expect(stillToPay(inr(300_000), inr(250_000))).toEqual(inr(50_000));
    expect(stillToPay(inr(300_000), inr(300_000))).toEqual(inr(0));
  });

  it('says it was overpaid by the difference, shown as a negative, rather than hiding it', () => {
    expect(stillToPay(inr(300_000), inr(350_000))).toEqual(inr(-50_000));
  });

  it('is nothing when there is no total, or no tax typed', () => {
    expect(stillToPay(null, inr(1))).toBeNull();
    expect(stillToPay(inr(1), null)).toBeNull();
  });
});
