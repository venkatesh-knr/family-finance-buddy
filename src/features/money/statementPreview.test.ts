import { describe, expect, it } from 'vitest';
import type { StatementLine } from '../../domain/statement/common.ts';
import type { ExistingEntry, MatchedRow, NewEntry, Proposal } from '../../domain/statement/match.ts';
import { decisionLabel, lineTitle, previewRows } from './statementPreview.ts';

/**
 * What the import's preview says of each line (docs/design/spending-capture.md section 4): what the statement printed in words a person can read, what the import will do, and what the
 * person may change it to. The suggestions that need an answer come first. The data is invented.
 */
const LINE: StatementLine = {
  date: '2026-10-05', valueDate: null, direction: 'debit', amountMinor: 22_400n, raw: 'UPI-SAMPLE SHOP-SHOP@OKBANK-ABCD0000001-200000000002-NOTE', payee: 'SAMPLE SHOP', upiReference: '200000000002',
  reference: null, balanceMinor: null, hint: null,
};
const ENTRY: NewEntry = { date: '2026-10-05', amountMinor: 22_400n, currency: 'INR', payee: 'SAMPLE SHOP', accountId: null, accountLast4: null, method: 'upi', upiRefLast4: '0002', upiRefHash: 'a'.repeat(64), sourceHash: 'h'.repeat(64), hint: null };
const row = (proposal: Proposal, line: Partial<StatementLine> = {}): MatchedRow => ({ line: { ...LINE, ...line }, lineHash: 'h'.repeat(64), proposal });
const EXISTING: ExistingEntry[] = [{ id: 'e1', date: '2026-10-04', amountMinor: 22_400n, currency: 'INR', payee: 'Typed shop', accountId: null, upiRefHash: null, witnessedBy: [] }];

describe('what a line is called', () => {
  it('is its payee when the statement gives one', () => {
    expect(lineTitle(LINE)).toBe('SAMPLE SHOP');
  });

  it('is what the bank printed when it names nobody, with any VPA taken out and the length kept short', () => {
    expect(lineTitle({ ...LINE, payee: null, raw: 'ACH D- SAMPLE FUND@PAYU-REF1234567890 MONTHLY INSTALMENT FOR THE FUND SAMPLE SAMPLE SAMPLE' })).not.toContain('@');
    expect(lineTitle({ ...LINE, payee: null, raw: 'x'.repeat(200) }).length).toBeLessThanOrEqual(61);
  });

  it('says so when there is nothing to call it', () => {
    expect(lineTitle({ ...LINE, payee: null, raw: '' })).toBe('No description');
  });
});

describe('the rows of the preview', () => {
  const rows = [
    row({ action: 'create', entry: ENTRY }),
    row({ action: 'witness', entryId: 'e1', fill: {} }),
    row({ action: 'suggest', entryId: 'e1', fill: {}, entry: ENTRY }),
    row({ action: 'skip', reason: 'card-payment', sure: false, entry: ENTRY }),
    row({ action: 'skip', reason: 'emi-principal', sure: true }),
    row({ action: 'skip', reason: 'already-imported', sure: true }),
  ];

  it('puts what needs an answer first, then what will be added, what will be merged, and what is left out', () => {
    expect(previewRows(rows, new Map(), EXISTING).map((r) => [r.index, r.group])).toEqual([
      [2, 'decide'],
      [0, 'add'],
      [1, 'merge'],
      [3, 'left'],
      [4, 'left'],
      [5, 'left'],
    ]);
  });

  it('says what each will do, and for a match which entry it is', () => {
    const out = previewRows(rows, new Map(), EXISTING);
    expect(out.find((r) => r.index === 0)?.doing).toBe('A new expense.');
    expect(out.find((r) => r.index === 1)?.doing).toContain('Typed shop');
    expect(out.find((r) => r.index === 2)?.doing).toContain('Looks like');
    expect(out.find((r) => r.index === 3)?.doing).toMatch(/Looks like a card repayment/);
  });

  it('offers each line only what it may be changed to, in words, with the default chosen', () => {
    const out = previewRows(rows, new Map(), EXISTING);
    expect(out.find((r) => r.index === 0)).toMatchObject({ decision: 'create', options: [{ value: 'create', label: 'Add as an expense' }, { value: 'skip', label: 'Leave out' }] });
    expect(out.find((r) => r.index === 2)).toMatchObject({ decision: null, options: [{ value: 'merge', label: 'It is the same payment: add to that entry' }, { value: 'create', label: 'It is a different payment: add as an expense' }, { value: 'skip', label: 'Leave out' }] });
    expect(out.find((r) => r.index === 4)?.options).toEqual([{ value: 'skip', label: 'Leave out' }]);
  });

  it('shows what the person chose in place of the default', () => {
    const out = previewRows(rows, new Map([[3, 'create' as const], [0, 'skip' as const]]), EXISTING);
    expect(out.find((r) => r.index === 3)?.decision).toBe('create');
    expect(out.find((r) => r.index === 3)?.group).toBe('add');
    expect(out.find((r) => r.index === 0)?.decision).toBe('skip');
    expect(out.find((r) => r.index === 0)?.group).toBe('left');
  });

  it('has a label for every decision', () => {
    expect(decisionLabel('create', false)).toBe('Add as an expense');
    expect(decisionLabel('merge', true)).toBe('It is the same payment: add to that entry');
    expect(decisionLabel('merge', false)).toBe('Add to the entry it matches');
    expect(decisionLabel('skip', false)).toBe('Leave out');
  });
});
