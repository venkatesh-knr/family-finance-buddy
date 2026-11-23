import { describe, expect, it } from 'vitest';
import type { ParsedStatement, StatementLine } from './common.ts';
import { balanceWrites, cardNotes, statedBalances as stated, type StatedBalance } from './statedBalance.ts';

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

  it('CY-I15 — a month-end card’s due dated a month end carries what it converted and the principal of its instalments, as a statement-date card’s does', () => {
    const lines = [line('2026-10-02', 'credit', 6_000_000n, null), line('2026-10-05', 'debit', 500_000n, null), line('2026-10-05', 'debit', 66_000n, null)].map((each, at) => ({
      ...each,
      raw: ['EMI CONVERSION CREDIT SAMPLE SHOP', 'PRINCIPAL AMOUNT AMORTIZATION SAMPLE SHOP', 'INTEREST AMOUNT AMORTIZATION SAMPLE SHOP'][at] as string,
    }));
    expect(statedBalances(onMonthEnd(2_864_000n, { lines }))).toEqual([
      { asAt: '2026-10-31', balanceMinor: 2_864_000n, basis: 'due', emiConvertedMinor: 6_000_000n, emiPrincipalMinor: 500_000n },
    ]);
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

/**
 * A card that closes on its statement date (docs/design/card-cycles.md sections 3 and 5; CY-I10). It states what is due on its statement date, and what was due at the start of the
 * period on the day before the period begins, whatever day of the month either is. A card that closes at month end is as it always was. Every figure here is invented.
 */
describe('a card that closes on its statement date', () => {
  const card = (over: Partial<ParsedStatement> = {}, figures: Partial<NonNullable<ParsedStatement['card']>> = {}): ParsedStatement => ({
    kind: 'axis_card_pdf',
    accountType: 'card',
    last4: '9012',
    periodStart: '2026-10-18',
    periodEnd: '2026-11-17',
    card: { statementDate: '2026-11-17', paymentDueDate: '2026-12-05', previousBalanceMinor: 2_020_000n, totalDueMinor: 2_864_000n, ...figures },
    lines: [],
    problems: [],
    ...over,
  });

  it('CY-I10 — records its due on its statement date and its previous balance on the day before its period, from the statement only', () => {
    expect(stated(card(), TODAY, 'statement')).toEqual([
      { asAt: '2026-10-17', balanceMinor: 2_020_000n, basis: 'opening' },
      { asAt: '2026-11-17', balanceMinor: 2_864_000n, basis: 'due' },
    ]);
  });

  it('CY-I10 — and nothing at all when the card closes at month end and the statement is dated mid-month, as before', () => {
    expect(stated(card(), TODAY, 'month_end')).toEqual([]);
    expect(stated(card(), TODAY)).toEqual([]);
  });

  it('CY-I10 — a month-end card dated on a month end records its due and nothing else, as before', () => {
    const out = stated(card({ periodStart: '2026-10-01', periodEnd: '2026-10-31' }, { statementDate: '2026-10-31' }), TODAY, 'month_end');
    expect(out).toEqual([{ asAt: '2026-10-31', balanceMinor: 2_864_000n, basis: 'due' }]);
  });

  it('dates the previous balance one month before the statement when the statement does not print its period and no earlier statement is recorded, clamped to the month', () => {
    const icici = (statementDate: string, lines: StatementLine[] = []): ParsedStatement => card({ kind: 'icici_card_pdf', periodStart: null, periodEnd: statementDate, lines }, { statementDate });
    expect(stated(icici('2026-11-18'), TODAY, 'statement')[0]).toEqual({ asAt: '2026-10-18', balanceMinor: 2_020_000n, basis: 'opening' });
    expect(stated(icici('2026-03-31'), TODAY, 'statement')[0]).toEqual({ asAt: '2026-02-28', balanceMinor: 2_020_000n, basis: 'opening' });
  });

  it('is not moved by a line dated before the period: a late-posted purchase under its transaction date is no evidence of where the period began', () => {
    const icici = card({ kind: 'icici_card_pdf', periodStart: null, periodEnd: '2026-11-18', lines: [line('2026-10-17', 'debit', 100n, null)] }, { statementDate: '2026-11-18' });
    expect(stated(icici, TODAY, 'statement')[0]).toEqual({ asAt: '2026-10-18', balanceMinor: 2_020_000n, basis: 'opening' });
  });

  it('dates the previous balance on the day of the card’s earlier statement when one is recorded, so a statement a day early or late for a holiday does not shift a window', () => {
    const icici = card({ kind: 'icici_card_pdf', periodStart: null, periodEnd: '2026-11-18' }, { statementDate: '2026-11-18' });
    expect(stated(icici, TODAY, 'statement', { previousDue: '2026-10-17' })[0]).toEqual({ asAt: '2026-10-17', balanceMinor: 2_020_000n, basis: 'opening' });
    // A printed period still wins: it is the statement's own word.
    expect(stated(card(), TODAY, 'statement', { previousDue: '2026-10-16' })[0]?.asAt).toBe('2026-10-17');
  });

  it('states nothing for a statement that did not add up, or one dated after today', () => {
    expect(stated(card({ problems: ['a line is wrong'] }), TODAY, 'statement')).toEqual([]);
    expect(stated(card(), '2026-11-16', 'statement')).toEqual([{ asAt: '2026-10-17', balanceMinor: 2_020_000n, basis: 'opening' }]);
  });

  it('CY-I15 — carries what the cycle converted to EMIs and the principal of the instalments it billed, with its due', () => {
    const lines = [
      line('2026-11-02', 'credit', 6_000_000n, null),
      line('2026-11-05', 'debit', 500_000n, null),
      line('2026-11-05', 'debit', 66_000n, null),
    ].map((each, at) => ({
      ...each,
      raw: ['EMI CONVERSION CREDIT SAMPLE SHOP', 'PRINCIPAL AMOUNT AMORTIZATION SAMPLE SHOP', 'INTEREST AMOUNT AMORTIZATION SAMPLE SHOP'][at] as string,
    }));
    const out = stated(card({ lines }), TODAY, 'statement');
    expect(out.find((entry) => entry.basis === 'due')).toEqual({ asAt: '2026-11-17', balanceMinor: 2_864_000n, basis: 'due', emiConvertedMinor: 6_000_000n, emiPrincipalMinor: 500_000n });
    expect(out.find((entry) => entry.basis === 'opening')).toEqual({ asAt: '2026-10-17', balanceMinor: 2_020_000n, basis: 'opening' });
  });

  it('CY-I15 — counts only the lines the person left as EMI lines: a conversion credit added as a refund is not also a conversion', () => {
    const lines = [line('2026-11-02', 'credit', 6_000_000n, null), line('2026-11-05', 'debit', 500_000n, null)].map((each, at) => ({
      ...each,
      raw: ['EMI CONVERSION CREDIT SAMPLE SHOP', 'PRINCIPAL AMOUNT AMORTIZATION SAMPLE SHOP'][at] as string,
    }));
    const out = stated(card({ lines }), TODAY, 'statement', { countsAsEmi: (each) => each.direction === 'debit' });
    expect(out.find((entry) => entry.basis === 'due')).toEqual({ asAt: '2026-11-17', balanceMinor: 2_864_000n, basis: 'due', emiPrincipalMinor: 500_000n });
  });
});

describe('what is written of a statement’s balances (CY-I10, card-cycles.md 2.1)', () => {
  const due = (asAt: string, balanceMinor: bigint, emi = 0n): StatedBalance => ({ asAt, balanceMinor, basis: 'due', ...(emi > 0n ? { emiConvertedMinor: emi } : {}) });
  const opening = (asAt: string, balanceMinor: bigint): StatedBalance => ({ asAt, balanceMinor, basis: 'opening' });

  /** The database's rule, as the import applies it: one row per day for a statement, a later write replacing an earlier except where it is only an opening and the day is already stated. */
  const store = (statements: readonly (readonly StatedBalance[])[]): Map<string, StatedBalance> => {
    const held = new Map<string, StatedBalance>();
    for (const stated of statements) for (const write of balanceWrites(stated, new Set(held.keys()))) held.set(write.asAt, write);
    return held;
  };

  const october = [opening('2026-09-18', 2_020_000n), due('2026-10-18', 2_864_000n, 6_000_000n)];
  const november = [opening('2026-10-18', 2_864_000n), due('2026-11-18', 2_240_000n)];

  it('CY-I10 — a next statement’s opening never replaces the due the previous statement stated for that day, with its EMI figures: oldest first', () => {
    expect(store([october, november]).get('2026-10-18')).toEqual(due('2026-10-18', 2_864_000n, 6_000_000n));
  });

  it('CY-I10 — and the order does not matter: the same rows come out whichever statement is imported first', () => {
    expect(store([november, october])).toEqual(store([october, november]));
    expect(store([november, october]).get('2026-10-18')).toEqual(due('2026-10-18', 2_864_000n, 6_000_000n));
  });

  it('writes everything else a statement states, and only leaves out an opening whose day is already stated', () => {
    expect(balanceWrites(november, new Set())).toEqual(november);
    expect(balanceWrites(november, new Set(['2026-10-18']))).toEqual([due('2026-11-18', 2_240_000n)]);
    expect(balanceWrites(november, new Set(['2026-11-18']))).toEqual(november);
  });
});

describe('what the preview says of a card statement (card-cycles.md section 5)', () => {
  const statement: ParsedStatement = {
    kind: 'axis_card_pdf',
    accountType: 'card',
    last4: '9012',
    periodStart: '2026-09-18',
    periodEnd: '2026-10-17',
    card: { statementDate: '2026-10-17', paymentDueDate: '2026-11-05', previousBalanceMinor: 2_020_000n, totalDueMinor: 2_864_000n },
    lines: [],
    problems: [],
  };

  it('says a statement-date card’s statement closes its month', () => {
    expect(cardNotes(statement, 'statement', [])).toEqual([{ kind: 'closes', asAt: '2026-10-17', dueMinor: 2_864_000n }]);
  });

  it('says a month-end card’s mid-month statement gives the close nothing, which is when the switch is offered', () => {
    expect(cardNotes(statement, 'month_end', [])).toEqual([{ kind: 'gives-nothing', asAt: '2026-10-17', dueMinor: 2_864_000n }]);
  });

  it('says a month-end card’s statement dated on a month end closes that month', () => {
    const onTheLastDay: ParsedStatement = { ...statement, card: { ...statement.card!, statementDate: '2026-10-31' } };
    expect(cardNotes(onTheLastDay, 'month_end', [])).toEqual([{ kind: 'closes', asAt: '2026-10-31', dueMinor: 2_864_000n }]);
  });

  it('CY-I13 — says a due that was typed for the same cycle is replaced by the statement, whatever day it was dated, and by how much they differ', () => {
    const typed = [{ asAt: '2026-10-17', balanceMinor: 2_900_000n }];
    expect(cardNotes(statement, 'statement', typed)).toEqual([
      { kind: 'closes', asAt: '2026-10-17', dueMinor: 2_864_000n },
      { kind: 'replaces-typed', typedAsAt: '2026-10-17', typedMinor: 2_900_000n, asAt: '2026-10-17', dueMinor: 2_864_000n, differenceMinor: 36_000n },
    ]);
    const another = cardNotes({ ...statement, card: { ...statement.card!, statementDate: '2026-10-18' } }, 'statement', typed);
    expect(another[1]).toMatchObject({ kind: 'replaces-typed', typedAsAt: '2026-10-17', asAt: '2026-10-18', differenceMinor: 36_000n });
  });

  it('CY-I13 — says a due typed in the month before the cycle is replaced too, since the statement’s previous balance is a statement’s due for that day', () => {
    const notes = cardNotes({ ...statement, periodStart: '2026-10-18', periodEnd: '2026-11-17', card: { ...statement.card!, statementDate: '2026-11-17' } }, 'statement', [{ asAt: '2026-10-17', balanceMinor: 2_900_000n }]);
    expect(notes).toEqual([
      { kind: 'closes', asAt: '2026-11-17', dueMinor: 2_864_000n },
      { kind: 'replaces-typed', typedAsAt: '2026-10-17', typedMinor: 2_900_000n, asAt: '2026-10-17', dueMinor: 2_020_000n, differenceMinor: 880_000n },
    ]);
  });

  it('does not say a due typed for another month is replaced, and says nothing for a month-end card’s typed due', () => {
    expect(cardNotes(statement, 'statement', [{ asAt: '2026-08-31', balanceMinor: 1n }])).toHaveLength(1);
    expect(cardNotes(statement, 'month_end', [{ asAt: '2026-10-17', balanceMinor: 1n }])).toHaveLength(1);
  });

  it('says nothing of a bank statement, or a card statement with no figures or a problem', () => {
    expect(cardNotes({ ...statement, accountType: 'bank' }, 'statement', [])).toEqual([]);
    const { card: _card, ...without } = statement;
    expect(cardNotes(without, 'statement', [])).toEqual([]);
    expect(cardNotes({ ...statement, problems: ['wrong'] }, 'statement', [])).toEqual([]);
  });
});
