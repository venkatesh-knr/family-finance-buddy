import { describe, expect, it } from 'vitest';
import type { StatementLine } from '../../domain/statement/common.ts';
import type { ExistingEntry, MatchedRow, NewCredit, NewEntry, Proposal } from '../../domain/statement/match.ts';
import { findMoves } from '../../domain/statement/moves.ts';
import { decisionLabel, lineTitle, previewRows } from './statementPreview.ts';

/**
 * What the import's preview says of each line (docs/design/spending-capture.md section 4): what the statement printed in words a person can read, what the import will do, and what the
 * person may change it to. The suggestions that need an answer come first. The data is invented.
 */
const LINE: StatementLine = {
  date: '2026-10-05', valueDate: null, direction: 'debit', amountMinor: 22_400n, raw: 'UPI-SAMPLE SHOP-SHOP@OKBANK-ABCD0000001-200000000002-NOTE', payee: 'SAMPLE SHOP', upiReference: '200000000002',
  reference: null, balanceMinor: null, hint: null,
};
const ENTRY: NewEntry = { date: '2026-10-05', amountMinor: 22_400n, currency: 'INR', payee: 'SAMPLE SHOP', accountId: null, accountLast4: null, method: 'upi', upiRefLast4: '0002', upiRefHash: 'a'.repeat(64), sourceHash: 'h'.repeat(64), hint: null, note: null };
const row = (proposal: Proposal, line: Partial<StatementLine> = {}): MatchedRow => ({ line: { ...LINE, ...line }, lineHash: 'h'.repeat(64), proposal });
const EXISTING: ExistingEntry[] = [{ id: 'e1', date: '2026-10-04', amountMinor: 22_400n, currency: 'INR', payee: 'Typed shop', accountId: null, upiRefHash: null, witnessedBy: [] }];

const CREDIT: NewCredit = { date: '2026-10-05', amountMinor: 4_500_000n, currency: 'INR', payer: 'EMPLOYER', accountId: null, accountLast4: null, category: 'salary', sourceHash: 'c'.repeat(64) };

describe('money in', () => {
  const credit = (proposal: Proposal) => row(proposal, { direction: 'credit', amountMinor: 4_500_000n, payee: 'EMPLOYER', raw: 'SALARY CREDIT' });

  it('is a row to add, said as money in, and can be left out', () => {
    const [out] = previewRows([credit({ action: 'credit', credit: CREDIT })], new Map(), []);
    expect(out).toMatchObject({ group: 'add', decision: 'create', moneyIn: true });
    expect(out?.doing).toMatch(/money in/i);
    expect(out?.options).toEqual([
      { value: 'create', label: 'Add as money in' },
      { value: 'skip', label: 'Leave out' },
    ]);
  });

  it('that is a guess it is not money in is left out apart from the sure ones, in words about money in, and can be added after all', () => {
    const [out] = previewRows([credit({ action: 'skip', reason: 'investment', sure: false, credit: CREDIT })], new Map(), []);
    expect(out).toMatchObject({ group: 'guess', decision: 'skip', moneyIn: true });
    expect(out?.doing).toBe('Looks like money back from an investment, which is not income. Add it if it is.');
    expect(out?.options.map((option) => option.label)).toEqual(['Leave out', 'Add as money in']);
  });

  it('that may be one the household already has waits for an answer, in the decide group, and says which answer is which', () => {
    const [out] = previewRows([credit({ action: 'skip', reason: 'credit-typed', sure: false, credit: CREDIT })], new Map(), []);
    expect(out).toMatchObject({ group: 'decide', decision: null, moneyIn: true });
    expect(out?.doing).toBe('Looks like money in you already have. Is it the same?');
    expect(out?.options.map((option) => option.label)).toEqual(['It is the same: leave it out', 'It is different: add as money in']);
  });

  it('an expense is not money in', () => {
    expect(previewRows([row({ action: 'create', entry: ENTRY })], new Map(), [])[0]?.moneyIn).toBe(false);
  });
});

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

  it('puts what needs an answer first, then what was left out as a guess, what will be added, what will be merged, and what is left out for certain', () => {
    expect(previewRows(rows, new Map(), EXISTING).map((r) => [r.index, r.group])).toEqual([
      [2, 'decide'],
      [3, 'guess'],
      [0, 'add'],
      [1, 'merge'],
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

  it('keeps a skip that is only a guess apart from the sure ones, since it is the one that may be wrong', () => {
    const out = previewRows(rows, new Map(), EXISTING);
    expect(out.find((r) => r.index === 3)?.group).toBe('guess');
    expect(out.find((r) => r.index === 4)?.group).toBe('left');
    expect(out.find((r) => r.index === 5)?.group).toBe('left');
  });

  it('has a label for every decision', () => {
    expect(decisionLabel('create', false)).toBe('Add as an expense');
    expect(decisionLabel('merge', true)).toBe('It is the same payment: add to that entry');
    expect(decisionLabel('merge', false)).toBe('Add to the entry it matches');
    expect(decisionLabel('skip', false)).toBe('Leave out');
  });
});

describe('a move between the household’s own accounts, across statements read together', () => {
  const debit = row({ action: 'create', entry: { ...ENTRY, accountLast4: '1111' } }, { upiReference: null, payee: null, raw: 'NEFT DR-ANOTHER BANK' });
  const credit = row({ action: 'credit', credit: { ...CREDIT, category: 'other_income', accountLast4: '2222' } }, { direction: 'credit', amountMinor: 22_400n, payee: null, raw: 'NEFT CR-FROM BANK' });
  const moves = findMoves([
    { row: debit, bank: true },
    { row: credit, bank: true },
  ]);

  it('is offered on the debit, which names both accounts, and the credit that is its other half is folded away, saying it is counted once', () => {
    const out = previewRows([debit, credit], new Map(), [], moves);
    const first = out.find((entry) => entry.index === 0);
    const second = out.find((entry) => entry.index === 1);
    expect(first).toMatchObject({ group: 'add', decision: 'move' });
    expect(first?.doing).toContain('••1111 to ••2222');
    expect(first?.options.map((option) => option.label)).toEqual(['Add as a move between your accounts', 'Add as an expense', 'Leave out']);
    expect(second).toMatchObject({ group: 'left', decision: 'skip', options: [{ value: 'skip', label: 'Leave out' }] });
    expect(second?.doing).toMatch(/counted once, as a move/);
  });

  it('puts both lines back to what they were when the person says the pair is not a move', () => {
    const out = previewRows([debit, credit], new Map([[0, 'create' as const]]), [], moves);
    expect(out.find((entry) => entry.index === 0)).toMatchObject({ group: 'add', decision: 'create' });
    expect(out.find((entry) => entry.index === 1)).toMatchObject({ group: 'add', decision: 'create', moneyIn: true });
  });

  it('says in words that a credit already recorded as a move is not money in', () => {
    const [out] = previewRows([row({ action: 'skip', reason: 'move-recorded', sure: false, credit: CREDIT }, { direction: 'credit' })], new Map(), []);
    expect(out).toMatchObject({ group: 'guess', decision: 'skip', moneyIn: true });
    expect(out?.doing).toBe('Already recorded as a move between your own accounts. Add it as money in if it is not.');
  });
});
