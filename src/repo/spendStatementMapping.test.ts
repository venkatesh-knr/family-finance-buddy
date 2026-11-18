import { describe, expect, it } from 'vitest';
import { MalformedRowError } from '../lib/guards.ts';
import { toSpendStatement } from './spendStatementMapping.ts';

/** The mapping from a stated spend's row to the app's vocabulary (docs/design/spending-capture.md section 11.5). Money arrives as text, selected `::text`. */
const row = {
  id: 's-1',
  household_id: 'h-1',
  month: '2026-10-01',
  currency: 'INR',
  amount_minor: '8200000',
  note: 'Diwali month',
};

describe('a stated spend, from its row', () => {
  it('reads the amount as exact minor units of its own currency, and the month as YYYY-MM', () => {
    expect(toSpendStatement(row)).toEqual({ id: 's-1', householdId: 'h-1', month: '2026-10', amount: { minor: 8_200_000n, currency: 'INR' }, note: 'Diwali month' });
  });

  it('reads an amount too large for a double exactly', () => {
    expect(toSpendStatement({ ...row, amount_minor: '9007199254740993' }).amount.minor).toBe(9_007_199_254_740_993n);
  });

  it('reads a missing note as none', () => {
    expect(toSpendStatement({ ...row, note: null }).note).toBeNull();
  });

  it('refuses a row that is not a first of a month, an amount that is not exact, and a missing currency', () => {
    expect(() => toSpendStatement({ ...row, month: '2026-10-15' })).toThrow(MalformedRowError);
    expect(() => toSpendStatement({ ...row, amount_minor: 8_200_000.5 })).toThrow(MalformedRowError);
    expect(() => toSpendStatement({ ...row, currency: undefined })).toThrow(MalformedRowError);
    expect(() => toSpendStatement(null)).toThrow(MalformedRowError);
  });
});
