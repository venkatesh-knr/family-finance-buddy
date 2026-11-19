import { describe, expect, it } from 'vitest';
import type { ParsedStatement, StatementLine } from '../domain/statement/common.ts';
import { sha256Hex } from './hash.ts';
import { hashStatement } from './statementHash.ts';

/** Hashing a statement's lines on the device (docs/design/spending-capture.md section 4; SC-I8): a hash for each line, and for its UPI reference a hash and its last four. */
const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  date: '2026-10-05',
  valueDate: null,
  direction: 'debit',
  amountMinor: 22_400n,
  raw: 'UPI/SAMPLE CAFE/x@tmb/snacks/BANK/200000000002/ICI1',
  payee: 'SAMPLE CAFE',
  upiReference: '200000000002',
  reference: null,
  balanceMinor: null,
  hint: null,
  ...over,
});
const statement = (lines: StatementLine[]): ParsedStatement => ({ kind: 'icici_savings_pdf', accountType: 'bank', last4: '4321', periodStart: null, periodEnd: null, lines, problems: [] });

describe('hashing a statement', () => {
  it('gives each line a 64-digit hash, and a line with a reference a hash of the reference and its last four, never the reference', async () => {
    const [first] = await hashStatement(statement([line()]));
    expect(first?.lineHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first?.refHash).toBe(await sha256Hex('200000000002'));
    expect(first?.refLast4).toBe('0002');
    const stored = JSON.stringify({ hash: first?.lineHash, ref: first?.refHash, last4: first?.refLast4 });
    expect(stored).not.toContain('200000000002');
  });

  it('has none for a line with no reference', async () => {
    const [first] = await hashStatement(statement([line({ upiReference: null })]));
    expect(first).toMatchObject({ refHash: null, refLast4: null });
  });

  it('gives two like lines two hashes, and the same statement read again the same hashes', async () => {
    const lines = [line({ upiReference: null }), line({ upiReference: null })];
    const once = await hashStatement(statement(lines));
    const again = await hashStatement(statement(lines));
    expect(once[0]?.lineHash).not.toBe(once[1]?.lineHash);
    expect(once.map((h) => h.lineHash)).toEqual(again.map((h) => h.lineHash));
  });

  it('gives a Google Pay line and a bank line for one payment different line hashes and the same reference hash', async () => {
    const bank = await hashStatement(statement([line()]));
    const gpay = await hashStatement({ ...statement([line({ raw: 'Paid to SAMPLE CAFE' })]), kind: 'gpay_pdf' });
    expect(gpay[0]?.lineHash).not.toBe(bank[0]?.lineHash);
    expect(gpay[0]?.refHash).toBe(bank[0]?.refHash);
  });
});
