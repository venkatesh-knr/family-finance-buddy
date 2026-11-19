import { describe, expect, it } from 'vitest';
import { MalformedRowError } from '../lib/guards.ts';
import { toExistingEntry } from './statementImportMapping.ts';

/** An entry as matching needs it, from its row and the kinds of statement that have witnessed it (docs/design/spending-capture.md section 4). Money arrives as text, selected `::text`. */
const row = {
  id: 'e-1',
  member_id: 'm-1',
  txn_date: '2026-10-05',
  amount_minor: '22400',
  currency: 'INR',
  payee: 'Typed shop',
  account_id: 'a-1',
  upi_ref_hash: 'a'.repeat(64),
};

describe('an entry as matching needs it', () => {
  it('reads the amount as exact paise, with its member and the kinds of statement that have witnessed it', () => {
    expect(toExistingEntry(row, ['gpay_pdf'])).toEqual({
      entry: { id: 'e-1', date: '2026-10-05', amountMinor: 22_400n, currency: 'INR', payee: 'Typed shop', accountId: 'a-1', upiRefHash: 'a'.repeat(64), witnessedBy: ['gpay_pdf'] },
      memberId: 'm-1',
    });
  });

  it('reads an entry with no payee, account or reference as having none', () => {
    const out = toExistingEntry({ ...row, payee: null, account_id: null, upi_ref_hash: null }, []);
    expect(out.entry).toMatchObject({ payee: null, accountId: null, upiRefHash: null, witnessedBy: [] });
  });

  it('reads an amount too large for a double exactly', () => {
    expect(toExistingEntry({ ...row, amount_minor: '9007199254740993' }, []).entry.amountMinor).toBe(9_007_199_254_740_993n);
  });

  it('refuses a row that is not an entry, an amount that is not exact, and a date that is not one', () => {
    expect(() => toExistingEntry(null, [])).toThrow(MalformedRowError);
    expect(() => toExistingEntry({ ...row, amount_minor: 224.5 }, [])).toThrow(MalformedRowError);
    expect(() => toExistingEntry({ ...row, txn_date: 'soon' }, [])).toThrow(MalformedRowError);
  });

  it('keeps only kinds of statement it knows, and each once', () => {
    expect(toExistingEntry(row, ['gpay_pdf', 'gpay_pdf', 'a_format_nobody_parses']).entry.witnessedBy).toEqual(['gpay_pdf']);
  });
});
