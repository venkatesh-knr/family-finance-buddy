/**
 * The month's money: came in, spent and saved (docs/design/ledger-income.md section 4; docs/design/spending-capture.md section 2).
 *
 * An open month shows what has come in and what is spent so far, and no saved: after the close (LI-I7). A closed month derives spent
 * from the accounts' balances and what the app knows, and never from the sum of entries, and nothing here is stored (SC-I1):
 *
 *   money in (an account) = its credits, the transfers into it, and holding take-outs paid into it
 *   left (a bank account) = opening + money in − closing
 *   left (a card)         = due at the end − due at the start + money in (its payments and its refunds)
 *   outside = credits with no account (accounts are optional): money that came in, or was refunded, outside the accounts added
 *   spent = Σ left + outside − own transfers out − money into holdings − refunds − paid to loans
 *   saved = came in − spent
 *         = net invested + paid to loans + the change in the cash reserve, to the paisa (LI-I23)
 *
 * A credit with no account is in came in as any credit is, and is added to spent as money outside the tracked accounts, the way cash is
 * when withdrawn; a refund with no account is in refunds, so its two parts cancel in spent. Saved is unchanged by either (LI-I6).
 * With no accounts at all there is nothing to close from balances, and the month is worked out from what was entered, elsewhere.
 * The last line follows from the others by algebra and is not checked against them, so a gap means a bug: `gapMinor` is there to say so.
 * Every account of the household must be covered, because a move between two of them appears once as an outflow and once as money in.
 * Money, dates and months are as everywhere: integer minor units, IST calendar days, `YYYY-MM`, one currency at a time (LI-I5). Pure.
 */

import type { IsoDate } from '../lib/dates.ts';
import type { Money } from '../lib/money.ts';
import { addMonths } from './accrual.ts';
import { cameInByCurrency, isIncome, type CreditCategory, type CreditLike } from './credit.ts';

export interface MonthAccount {
  readonly id: string;
  /** A savings or current account is a bank account; a card's balance is the amount due, positive. */
  readonly type: 'savings' | 'current' | 'card';
  readonly currency: string;
  /** The balance at the start of the month: last month's closing. Null where it has not been entered. */
  readonly opening: Money | null;
  readonly closing: Money | null;
}

export interface MonthCredit {
  /** The account it was credited to, or null for money that came in outside the accounts added. */
  readonly accountId: string | null;
  readonly category: CreditCategory;
  readonly amount: Money;
  readonly date: IsoDate;
}

export interface MonthTransfer {
  readonly fromId: string;
  readonly toId: string;
  readonly amount: Money;
  readonly date: IsoDate;
}

export interface MonthHoldingMove {
  readonly accountId: string;
  /** `into`: paid into a holding from the account. `out`: a take-out paid into the account. */
  readonly direction: 'into' | 'out';
  readonly amount: Money;
  readonly date: IsoDate;
}

/** A loan EMI debit: all of it, principal and interest, on its own line of the split. */
export interface MonthLoanPayment {
  readonly accountId: string;
  readonly amount: Money;
  readonly date: IsoDate;
}

export interface MonthInput {
  readonly month: string;
  /** The day it is asked. A month can be closed only once it has ended, in India. */
  readonly today: IsoDate;
  readonly accounts: readonly MonthAccount[];
  readonly credits: readonly MonthCredit[];
  readonly transfers: readonly MonthTransfer[];
  readonly holdingMoves: readonly MonthHoldingMove[];
  readonly loanPayments: readonly MonthLoanPayment[];
}

export interface AccountLeft {
  readonly accountId: string;
  readonly moneyInMinor: bigint;
  readonly leftMinor: bigint;
}

export interface MonthFigures {
  readonly currency: string;
  readonly cameIn: bigint;
  readonly refunds: bigint;
  /** Credits with no account, of every category: added to spent, and in came in or refunds as their category says. */
  readonly outside: bigint;
  readonly left: readonly AccountLeft[];
  readonly leftTotal: bigint;
  readonly ownTransfers: bigint;
  readonly putIntoHoldings: bigint;
  readonly takenOutOfHoldings: bigint;
  readonly paidToLoans: bigint;
  readonly spent: bigint;
  readonly saved: bigint;
  /** Money put into holdings less money taken out of them. */
  readonly invested: bigint;
  /** The change in what is in savings and current accounts less what is due on cards. */
  readonly cashReserveChange: bigint;
  readonly split: {
    readonly spent: bigint;
    readonly invested: bigint;
    readonly paidToLoans: bigint;
    readonly toCashReserve: bigint;
  };
  /** Saved less (invested + paid to loans + cash reserve change). Nothing but zero is right. */
  readonly gapMinor: bigint;
}

export type ClosedMonth =
  | { readonly ok: true; readonly currencies: readonly MonthFigures[] }
  | { readonly ok: false; readonly reason: 'not-ended'; readonly missing: readonly string[] }
  | { readonly ok: false; readonly reason: 'missing-balances'; readonly missing: readonly string[] };

const inMonth = (month: string, date: IsoDate): boolean => date.slice(0, 7) === month;
const byCurrency = (a: string, b: string): number => (a === b ? 0 : a === 'INR' ? -1 : b === 'INR' ? 1 : a < b ? -1 : 1);
const sum = (values: readonly bigint[]): bigint => values.reduce((total, value) => total + value, 0n);

export function closedMonthFigures(input: MonthInput): ClosedMonth {
  const firstOfNext = addMonths(`${input.month}-01`, 1);
  if (input.today < firstOfNext) return { ok: false, reason: 'not-ended', missing: [] };

  const missing = input.accounts.filter((a) => a.opening === null || a.closing === null).map((a) => a.id);
  if (missing.length > 0) return { ok: false, reason: 'missing-balances', missing };

  // Money that came in outside the accounts is a month of its own in a currency none of them is in. With no accounts there is no close.
  const outsideCurrencies = input.accounts.length === 0 ? [] : input.credits.filter((c) => c.accountId === null && inMonth(input.month, c.date)).map((c) => c.amount.currency);
  const currencies = [...new Set([...input.accounts.map((a) => a.currency), ...outsideCurrencies])].sort(byCurrency);
  return { ok: true, currencies: currencies.map((currency) => figuresFor(input, currency)) };
}

function figuresFor(input: MonthInput, currency: string): MonthFigures {
  const accounts = input.accounts.filter((a) => a.currency === currency);
  const mine = new Set(accounts.map((a) => a.id));
  const credits = input.credits.filter(
    (c) => (c.accountId === null || mine.has(c.accountId)) && c.amount.currency === currency && inMonth(input.month, c.date),
  );
  const transfers = input.transfers.filter((t) => t.amount.currency === currency && inMonth(input.month, t.date) && (mine.has(t.fromId) || mine.has(t.toId)));
  const moves = input.holdingMoves.filter((m) => mine.has(m.accountId) && m.amount.currency === currency && inMonth(input.month, m.date));
  const loans = input.loanPayments.filter((p) => mine.has(p.accountId) && p.amount.currency === currency && inMonth(input.month, p.date));

  const left: AccountLeft[] = accounts.map((account) => {
    const moneyIn = sum([
      ...credits.filter((c) => c.accountId === account.id).map((c) => c.amount.minor),
      ...transfers.filter((t) => t.toId === account.id).map((t) => t.amount.minor),
      ...moves.filter((m) => m.accountId === account.id && m.direction === 'out').map((m) => m.amount.minor),
    ]);
    const opening = account.opening?.minor ?? 0n;
    const closing = account.closing?.minor ?? 0n;
    const leftMinor = account.type === 'card' ? closing - opening + moneyIn : opening + moneyIn - closing;
    return { accountId: account.id, moneyInMinor: moneyIn, leftMinor };
  });

  const cameIn = sum(credits.filter((c) => isIncome(c.category)).map((c) => c.amount.minor));
  const refunds = sum(credits.filter((c) => !isIncome(c.category)).map((c) => c.amount.minor));
  const ownTransfers = sum(transfers.filter((t) => mine.has(t.fromId)).map((t) => t.amount.minor));
  const putIntoHoldings = sum(moves.filter((m) => m.direction === 'into').map((m) => m.amount.minor));
  const takenOutOfHoldings = sum(moves.filter((m) => m.direction === 'out').map((m) => m.amount.minor));
  const paidToLoans = sum(loans.map((p) => p.amount.minor));
  const leftTotal = sum(left.map((l) => l.leftMinor));
  const outside = sum(credits.filter((c) => c.accountId === null).map((c) => c.amount.minor));

  const spent = leftTotal + outside - ownTransfers - putIntoHoldings - refunds - paidToLoans;
  const saved = cameIn - spent;
  const invested = putIntoHoldings - takenOutOfHoldings;
  const cashReserveChange = sum(
    accounts.map((a) => {
      const change = (a.closing?.minor ?? 0n) - (a.opening?.minor ?? 0n);
      return a.type === 'card' ? -change : change;
    }),
  );

  return {
    currency,
    cameIn,
    refunds,
    outside,
    left,
    leftTotal,
    ownTransfers,
    putIntoHoldings,
    takenOutOfHoldings,
    paidToLoans,
    spent,
    saved,
    invested,
    cashReserveChange,
    split: { spent, invested, paidToLoans, toCashReserve: cashReserveChange },
    gapMinor: saved - (invested + paidToLoans + cashReserveChange),
  };
}

export interface OpenMonthFigures {
  readonly currency: string;
  readonly cameIn: bigint;
  readonly refunds: bigint;
  /** What has been itemised so far, less the refunds: the figure the screen labels as so far. */
  readonly spentSoFar: bigint;
  /** Never shown for an open month: after the close (LI-I7). */
  readonly saved: null;
}

/** An open month: what has come in, and what is spent so far. Saved is not shown until the close. */
export function openMonthFigures(input: {
  readonly month: string;
  readonly credits: readonly (CreditLike & { readonly accountId?: string })[];
  readonly itemised: readonly Money[];
}): OpenMonthFigures[] {
  const credited = new Map(cameInByCurrency(input.credits, input.month).map((line) => [line.currency, line] as const));
  const itemised = new Map<string, bigint>();
  for (const spend of input.itemised) itemised.set(spend.currency, (itemised.get(spend.currency) ?? 0n) + spend.minor);

  const currencies = [...new Set([...credited.keys(), ...itemised.keys()])].sort(byCurrency);
  return currencies.map((currency) => {
    const line = credited.get(currency);
    const refunds = line?.refunds ?? 0n;
    return { currency, cameIn: line?.cameIn ?? 0n, refunds, spentSoFar: (itemised.get(currency) ?? 0n) - refunds, saved: null };
  });
}
