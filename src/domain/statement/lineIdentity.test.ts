import { describe, expect, it } from 'vitest';
import type { StatementLine } from './common.ts';
import { lineKey, occurrences } from './lineIdentity.ts';

/** What identifies a statement line, so that a re-imported statement is recognised and two like lines are not taken for one (docs/design/spending-capture.md section 4). */
const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  date: '2026-10-05',
  valueDate: null,
  direction: 'debit',
  amountMinor: 50_000n,
  raw: 'SAMPLE SHOP',
  payee: null,
  upiReference: null,
  reference: null,
  balanceMinor: null,
  hint: null,
  ...over,
});

describe('numbering like lines', () => {
  it('numbers identical lines of a statement 1, 2, 3 in the order they come, so two like card swipes are two lines', () => {
    expect(occurrences([line(), line({ raw: 'OTHER' }), line(), line()])).toEqual([1, 1, 2, 3]);
  });

  it('counts a line as like another only by date, direction, amount and text', () => {
    expect(occurrences([line(), line({ amountMinor: 50_001n }), line({ date: '2026-10-06' }), line({ direction: 'credit' })])).toEqual([1, 1, 1, 1]);
  });

  it('is the same for the same statement read again, which is what recognises it', () => {
    const lines = [line(), line(), line({ raw: 'OTHER' })];
    expect(occurrences(lines)).toEqual(occurrences([...lines]));
  });
});

describe('the text a line is hashed from', () => {
  it('names the kind of statement, the date, the direction, the amount, the text and which of like lines it is', () => {
    expect(lineKey('hdfc_text', line(), 1)).toBe('hdfc_text|2026-10-05|debit|50000|SAMPLE SHOP|#1');
  });

  it('is the same however the statement spaced the text', () => {
    expect(lineKey('hdfc_text', line({ raw: '  SAMPLE   SHOP ' }), 1)).toBe(lineKey('hdfc_text', line(), 1));
  });

  it('differs by kind, so a Google Pay line and a bank line for one payment are two witnesses', () => {
    expect(lineKey('gpay_pdf', line(), 1)).not.toBe(lineKey('icici_savings_pdf', line(), 1));
  });

  it('differs by which of two like lines it is', () => {
    expect(lineKey('hdfc_text', line(), 1)).not.toBe(lineKey('hdfc_text', line(), 2));
  });
});
