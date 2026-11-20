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
  /**
   * The days this account's month runs over, first and last inclusive, where it is not the calendar month: a card that closes on its statement date is counted over the cycle
   * of its statement ending in the month (docs/design/card-cycles.md 2.2). Its credits, the transfer legs that reach or leave it, its holding moves and its loan payments are counted
   * in it. Absent, the account is counted over the calendar month, which is every account of a household with no such card (CY-I1).
   */
  readonly window?: { readonly from: IsoDate; readonly to: IsoDate };
  /** A card's cycle: what was converted to EMI plans in it, and the principal of the instalments billed in it (card-cycles.md 4a). Absent is none. */
  readonly emiConvertedMinor?: bigint;
  readonly emiPrincipalMinor?: bigint;
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

/**
 * What the database adds for a currency that the caller cannot read: other members' private credits and the entries of their private holdings. Every
 * account is read, so none is hidden. Totals only, as `household_private_close` returns them, worked out so that the rest of the month is the same as
 * when everything is read.
 */
export interface MonthUnreadable {
  readonly currency: string;
  /** The money into an account that the caller cannot see (a private credit; proceeds of a private holding), which raised what left it. */
  readonly left: bigint;
  readonly outside: bigint;
  readonly refunds: bigint;
  readonly cameIn: bigint;
  /** Money paid into holdings that the caller's own screen does not add (LI-I30). Absent is none. */
  readonly intoHoldings?: bigint;
  /** Money taken out of holdings and paid into an account, likewise. It is already in `left`. Absent is none. */
  readonly outOfHoldings?: bigint;
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
  /** What the caller cannot read, summed by the database; none for a household with nothing private. */
  readonly unreadable?: readonly MonthUnreadable[];
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
    /** Present only when it is not zero. */
    readonly paymentsInTransit?: bigint;
  };
  /**
   * Card payments in transit (card-cycles.md 7): what left a bank account in this month's window and reached a statement-date card in its next window, less what reached one in this
   * month's window and left in the month before. Zero for a household with no statement-date card, and with card payments skipped. Over consecutive months it telescopes.
   */
  readonly paymentsInTransit: bigint;
  /** Saved less (invested + paid to loans + cash reserve change + card payments in transit). Nothing but zero is right. */
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
  const currencies = [...new Set([...input.accounts.map((a) => a.currency), ...outsideCurrencies, ...(input.unreadable ?? []).map((u) => u.currency)])].sort(byCurrency);
  return { ok: true, currencies: currencies.map((currency) => figuresFor(input, currency)) };
}

function figuresFor(input: MonthInput, currency: string): MonthFigures {
  const accounts = input.accounts.filter((a) => a.currency === currency);
  const mine = new Set(accounts.map((a) => a.id));
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  // A date is in an account's month when it is in its window, or in the calendar month where it has none.
  const within = (accountId: string, date: IsoDate): boolean => {
    const window = byId.get(accountId)?.window;
    return window === undefined ? inMonth(input.month, date) : date >= window.from && date <= window.to;
  };
  const credits = input.credits.filter(
    (c) => c.amount.currency === currency && (c.accountId === null ? inMonth(input.month, c.date) : mine.has(c.accountId) && within(c.accountId, c.date)),
  );
  // A transfer has two legs, each counted in the window of its own account (CY-I2).
  const outLegs = input.transfers.filter((t) => t.amount.currency === currency && mine.has(t.fromId) && within(t.fromId, t.date));
  const inLegs = input.transfers.filter((t) => t.amount.currency === currency && mine.has(t.toId) && within(t.toId, t.date));
  const moves = input.holdingMoves.filter((m) => mine.has(m.accountId) && m.amount.currency === currency && within(m.accountId, m.date));
  const loans = input.loanPayments.filter((p) => mine.has(p.accountId) && p.amount.currency === currency && within(p.accountId, p.date));

  const left: AccountLeft[] = accounts.map((account) => {
    const moneyIn = sum([
      ...credits.filter((c) => c.accountId === account.id).map((c) => c.amount.minor),
      ...inLegs.filter((t) => t.toId === account.id).map((t) => t.amount.minor),
      ...moves.filter((m) => m.accountId === account.id && m.direction === 'out').map((m) => m.amount.minor),
    ]);
    const opening = account.opening?.minor ?? 0n;
    const closing = account.closing?.minor ?? 0n;
    // A card's cycle is what the card did: its purchases, charges, interest and fees, plus what was converted to EMI plans (counted as spent in the cycle it was converted) less the
    // principal of instalments billed (a purchase counted when it was converted, repaid now), card-cycles.md 4a.
    const emi = (account.emiConvertedMinor ?? 0n) - (account.emiPrincipalMinor ?? 0n);
    const leftMinor = account.type === 'card' ? closing - opening + moneyIn + emi : opening + moneyIn - closing;
    return { accountId: account.id, moneyInMinor: moneyIn, leftMinor };
  });

  const hidden = (input.unreadable ?? []).filter((u) => u.currency === currency);
  const cameIn = sum(credits.filter((c) => isIncome(c.category)).map((c) => c.amount.minor)) + sum(hidden.map((u) => u.cameIn));
  const refunds = sum(credits.filter((c) => !isIncome(c.category)).map((c) => c.amount.minor)) + sum(hidden.map((u) => u.refunds));
  const ownTransfers = sum(outLegs.map((t) => t.amount.minor));
  const putIntoHoldings = sum(moves.filter((m) => m.direction === 'into').map((m) => m.amount.minor)) + sum(hidden.map((u) => u.intoHoldings ?? 0n));
  const takenOutOfHoldings = sum(moves.filter((m) => m.direction === 'out').map((m) => m.amount.minor)) + sum(hidden.map((u) => u.outOfHoldings ?? 0n));
  // What was paid on loans from an account, which is not spent; and, for a card, its EMI plans: the principal billed less what was converted. The first is taken off spent. The second is
  // already in the card's left, so it is not: it is only the split's paid to loans (a conversion is borrowing, shown as a minus).
  const loanPayments = sum(loans.map((p) => p.amount.minor));
  const cardEmi = sum(accounts.map((a) => (a.emiPrincipalMinor ?? 0n) - (a.emiConvertedMinor ?? 0n)));
  const paidToLoans = loanPayments + cardEmi;
  const leftTotal = sum(left.map((l) => l.leftMinor)) + sum(hidden.map((u) => u.left));
  const outside = sum(credits.filter((c) => c.accountId === null).map((c) => c.amount.minor)) + sum(hidden.map((u) => u.outside));

  const spent = leftTotal + outside - ownTransfers - putIntoHoldings - refunds - loanPayments;
  const saved = cameIn - spent;
  const invested = putIntoHoldings - takenOutOfHoldings;
  const cashReserveChange = sum(
    accounts.map((a) => {
      const change = (a.closing?.minor ?? 0n) - (a.opening?.minor ?? 0n);
      return a.type === 'card' ? -change : change;
    }),
  );
  // A move between two of the household's accounts is counted once as out of one and once as into the other. Where the two legs fall in different windows (a payment made after a card's
  // statement date), one is counted in this month and the other in the next, and the difference is what is in transit between them. Only a move with both accounts read is considered, so
  // a leg that is simply missing still shows as a gap.
  const paymentsInTransit = sum(
    input.transfers
      .filter((t) => t.amount.currency === currency && mine.has(t.fromId) && mine.has(t.toId))
      .map((t) => (within(t.fromId, t.date) ? t.amount.minor : 0n) - (within(t.toId, t.date) ? t.amount.minor : 0n)),
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
    split: { spent, invested, paidToLoans, toCashReserve: cashReserveChange, ...(paymentsInTransit === 0n ? {} : { paymentsInTransit }) },
    paymentsInTransit,
    gapMinor: saved - (invested + paidToLoans + cashReserveChange + paymentsInTransit),
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
