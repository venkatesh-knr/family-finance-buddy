import { describe, expect, it } from 'vitest';
import type { ParsedStatement, StatementLine } from './common.ts';
import { statedBalances as stated } from './statedBalance.ts';

const TODAY = '2026-12-15';
const statedBalances = (statement: ParsedStatement, today: string = TODAY) => stated(statement, today);

/**
 * The balances a statement states, which the month close reads for an account on the last day of a month (docs/design/spending-capture.md section 2; ledger-income.md
 * section 1a). A bank statement's running balance gives the balance at the end of any day it covers, so one that crosses a month end states the balance at that month end as well
 * as at its own last day. A card's balance is what is due on its statement date. Every figure here is invented.
 */
const line = (date: string, direction: 'debit' | 'credit', amountMinor: bigint, balanceMinor: bigint | null): StatementLine => ({
  date, valueDate: null, direction, amountMinor, raw: `${date} ${String(amountMinor)}`, payee: null, upiReference: null, reference: null, balanceMinor, hint: null,
});

const bank = (over: Partial<ParsedStatement> & { lines: readonly StatementLine[] }): ParsedStatement => ({
  kind: 'hdfc_delimited', accountType: 'bank', last4: '4321', periodStart: '2026-10-01', periodEnd: '2026-10-31', problems: [], ...over,
});

describe('a bank statement', () => {
  const lines = [
    line('2026-10-03', 'debit', 10_000n, 90_000n),
    line('2026-10-17', 'credit', 5_000n, 95_000n),
    line('2026-10-30', 'debit', 20_000n, 75_000n),
  ];

  it('states its closing balance on the last day of its period, and the opening balance on the day before it begins', () => {
    const out = statedBalances(bank({ lines }));
    expect(out).toContainEqual({ asAt: '2026-10-31', balanceMinor: 75_000n, basis: 'closing' });
    expect(out).toContainEqual({ asAt: '2026-09-30', balanceMinor: 100_000n, basis: 'opening' });
  });

  it('states nothing for a month end it does not cover, and nothing for a day that is not a month end, which the close and the cash reserve would mistake for one', () => {
    expect(statedBalances(bank({ lines, periodStart: '2026-10-05', periodEnd: '2026-10-20' }))).toEqual([]);
  });

  it('states nothing for a month that has not ended', () => {
    expect(statedBalances(bank({ lines }), '2026-10-31').map((entry) => entry.asAt)).toEqual(['2026-09-30']);
    expect(statedBalances(bank({ lines }), '2026-11-01').map((entry) => entry.asAt)).toEqual(['2026-09-30', '2026-10-31']);
  });

  it('states the balance at a month end in the middle of a statement that crosses it', () => {
    const crossing = [
      line('2026-10-20', 'debit', 1_000n, 49_000n),
      line('2026-11-02', 'debit', 4_000n, 45_000n),
    ];
    const out = statedBalances(bank({ lines: crossing, periodStart: '2026-10-15', periodEnd: '2026-11-10' }));
    expect(out).toEqual([{ asAt: '2026-10-31', balanceMinor: 49_000n, basis: 'month-end' }]);
  });

  it('works from the last line when the statement does not say its period', () => {
    expect(statedBalances(bank({ lines, periodStart: null, periodEnd: null }))).toEqual([]);
    const toTheEnd = [line('2026-10-30', 'debit', 20_000n, 75_000n), line('2026-10-31', 'credit', 1_000n, 76_000n)];
    expect(statedBalances(bank({ lines: toTheEnd, periodStart: null, periodEnd: null }))).toEqual([{ asAt: '2026-10-31', balanceMinor: 76_000n, basis: 'closing' }]);
  });

  it('states nothing when a line has no balance, since the running figure is then not the statement\'s own', () => {
    expect(statedBalances(bank({ lines: [line('2026-10-03', 'debit', 10_000n, null)] }))).toEqual([]);
  });

  it('states nothing when the lines are not in date order or the statement has problems', () => {
    expect(statedBalances(bank({ lines: [lines[2] as StatementLine, lines[0] as StatementLine] }))).toEqual([]);
    expect(statedBalances(bank({ lines, problems: ['line 2: not read'] }))).toEqual([]);
  });

  it('states nothing for a statement with no lines', () => {
    expect(statedBalances(bank({ lines: [] }))).toEqual([]);
  });

  it('reads the balance after the last of several lines on a day', () => {
    const same = [line('2026-10-31', 'debit', 1_000n, 9_000n), line('2026-10-31', 'debit', 2_000n, 7_000n)];
    const out = statedBalances(bank({ lines: same, periodStart: '2026-10-31', periodEnd: '2026-10-31' }));
    expect(out).toEqual([{ asAt: '2026-10-31', balanceMinor: 7_000n, basis: 'closing' }]);
  });
});

describe('a card statement', () => {
  const card = (due: bigint, over: Partial<ParsedStatement> = {}): ParsedStatement => ({
    kind: 'icici_card_pdf', accountType: 'card', last4: '9876', periodStart: '2026-09-15', periodEnd: '2026-10-14', problems: [], lines: [],
    card: { statementDate: '2026-10-14', paymentDueDate: '2026-11-01', previousBalanceMinor: 1_000n, totalDueMinor: due }, ...over,
  });

  const onMonthEnd = (due: bigint, over: Partial<ParsedStatement> = {}): ParsedStatement =>
    card(due, { periodStart: '2026-10-01', periodEnd: '2026-10-31', card: { statementDate: '2026-10-31', paymentDueDate: '2026-11-18', previousBalanceMinor: 1_000n, totalDueMinor: due }, ...over });

  it('states what is due when its statement is dated the last day of a month', () => {
    expect(statedBalances(onMonthEnd(35_050n))).toEqual([{ asAt: '2026-10-31', balanceMinor: 35_050n, basis: 'due' }]);
  });

  it('states nothing when its statement is dated mid-month, which is not a balance at a month end', () => {
    expect(statedBalances(card(35_050n))).toEqual([]);
  });

  it('keeps a card that is in credit as a negative figure', () => {
    expect(statedBalances(onMonthEnd(-2_500n))[0]?.balanceMinor).toBe(-2_500n);
  });

  it('falls back to the end of the period when the statement does not give its date', () => {
    const out = statedBalances(onMonthEnd(100n, { card: { statementDate: null, paymentDueDate: null, previousBalanceMinor: 0n, totalDueMinor: 100n } }));
    expect(out).toEqual([{ asAt: '2026-10-31', balanceMinor: 100n, basis: 'due' }]);
  });

  it('states nothing without the card\'s figures, or with problems', () => {
    expect(statedBalances(card(1n, { card: undefined as never }))).toEqual([]);
    expect(statedBalances(card(1n, { problems: ['x'] }))).toEqual([]);
  });
});

describe('a statement of neither kind of balance', () => {
  it('states nothing for a UPI app statement, which has no balance', () => {
    const gpay: ParsedStatement = { kind: 'gpay_pdf', accountType: 'bank', last4: null, periodStart: '2026-10-01', periodEnd: '2026-10-31', problems: [], lines: [line('2026-10-03', 'debit', 100n, null)] };
    expect(statedBalances(gpay)).toEqual([]);
  });
});
