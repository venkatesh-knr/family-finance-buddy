/**
 * The month close (docs/design/spending-capture.md sections 2 and 6; ledger-income.md section 4; the MonthClose board).
 *
 * Pure: the accounts, balances, credits and moves the caller may read are passed in, with what has been typed on the screen and not yet saved,
 * and nothing here reads a database or a clock. It assembles the domain's `closedMonthFigures` from them (`src/domain/money-month.ts`): an
 * account's opening is its balance on the last day of the month before and its closing its balance on the last day of the month, a statement
 * beating a typed figure for the same day. Spent is derived and never stored (SC-I1); the close stores balances. Money in is the ledger's:
 * credits and the transfers in, never typed beside the balances. An archived account is not in a close.
 *
 * A card that closes on its statement date is the exception to "the last day of the month" (docs/design/card-cycles.md): its month is the cycle of its statement dated in the month,
 * worked out here from its balances (`cardCycles`). Every other account is as above, and a household with no such card has no cycle anywhere (CY-I1).
 */

import { addMonths } from '../../domain/accrual.ts';
import { isIncome } from '../../domain/credit.ts';
import { closedMonthFigures, type MonthFigures, type MonthHoldingMove, type MonthUnreadable } from '../../domain/money-month.ts';
import { addDays, type IsoDate } from '../../lib/dates.ts';
import { money, parseAmountToMinor, type Money } from '../../lib/money.ts';
import type { Account, AccountBalance, Budget, Credit, Transfer } from '../../repo/types.ts';
import { titleOf } from './accountRows.ts';

const MONTH_WORDS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The name of a month: October. */
export function monthWord(month: string): string {
  return MONTH_WORDS[Number(month.slice(5, 7)) - 1] ?? '';
}

/** The last calendar day of a month: 2026-10 is 2026-10-31. */
export function lastDayOf(month: string): string {
  const first = `${month}-01`;
  const next = addMonths(first, 1);
  const date = new Date(`${next}T00:00:00Z`);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

/** The month the prompt offers to close, from the 1st: the month before the one it is. */
export function monthToClose(today: string): string {
  return addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
}

/** The planning year a month falls in, named by the year it starts: April to March. */
export function planYearOf(month: string): number {
  const year = Number(month.slice(0, 4));
  return Number(month.slice(5, 7)) >= 4 ? year : year - 1;
}

/**
 * What a month is measured against, in a currency: the monthly plans of the categories in use, added. A yearly plan is not spread over twelve (the
 * Expenses screen does not either). Null when no monthly plan is set in that currency, which is not a plan of nothing.
 */
export function monthlyPlanned(
  budgets: readonly Budget[],
  categories: readonly { readonly id: string; readonly isArchived: boolean }[],
  currency: string,
): bigint | null {
  const used = new Set(categories.filter((category) => !category.isArchived).map((category) => category.id));
  const monthly = budgets.filter((budget) => budget.cadence === 'monthly' && used.has(budget.categoryId) && budget.planned.currency === currency);
  if (monthly.length === 0) return null;
  const firstOfEach = new Map<string, Budget>();
  for (const budget of monthly) if (!firstOfEach.has(budget.categoryId)) firstOfEach.set(budget.categoryId, budget);
  return [...firstOfEach.values()].reduce((total, budget) => total + budget.planned.minor, 0n);
}

/** A card's cycle for a month (card-cycles.md 2 and 3), worked out from its recorded dues, each of which is a statement's or a typed one. */
export type CardCycle =
  /** The statement dated in the month, and the balance before it: the window runs from the day after that balance to the statement. */
  | {
      readonly kind: 'cycle';
      readonly accountId: string;
      readonly from: IsoDate;
      readonly to: IsoDate;
      readonly opening: Money;
      readonly closing: Money;
      readonly emiConvertedMinor: bigint;
      readonly emiPrincipalMinor: bigint;
      /** Where the two dues came from, so a typed figure is never said to be a statement's. */
      readonly sources: { readonly opening: 'typed' | 'statement'; readonly closing: 'typed' | 'statement' };
    }
  /** The earliest statement in the app has no balance before it, so its cycle is left out: the card adds nothing that month. */
  | { readonly kind: 'first-left-out'; readonly accountId: string; readonly to: IsoDate; readonly closing: Money; readonly emiConvertedMinor: bigint; readonly emiPrincipalMinor: bigint }
  /** No statement is dated in the month and a later one shows that none was: its spending is in the later close, and the card adds nothing now. */
  | { readonly kind: 'none-this-month'; readonly accountId: string }
  /** The month waits for the statement dated in it. */
  | { readonly kind: 'waiting'; readonly accountId: string }
  /** An owner or a partner closed the month without the card, and the statement is still not in: the card adds nothing, and its payments count as spent. */
  | { readonly kind: 'closed-without'; readonly accountId: string };

/** The months an owner or a partner closed without a card (`close_without_card`), as the close reads them. A voided one is not passed. */
export type ClosedWithout = readonly { readonly accountId: string; readonly month: string }[];

/**
 * The choices to close a month without a card, as the close screen has them: those saved, with the cards the person chose to leave out on this screen added, and those they undid taken away
 * (card-cycles.md 2.4). Nothing here is written: the choices are saved with the close, so cancelling it leaves nothing behind (the owner, 23 November 2026).
 */
export function effectiveClosedWithout(input: {
  readonly saved: readonly { readonly id?: string; readonly accountId: string; readonly month: string }[];
  readonly month: string;
  readonly leaveOut: ReadonlySet<string>;
  readonly putBack: ReadonlySet<string>;
}): ClosedWithout {
  const kept = input.saved.filter((choice) => !(choice.month === input.month && input.putBack.has(choice.accountId))).map((choice) => ({ accountId: choice.accountId, month: choice.month }));
  const added = [...input.leaveOut]
    .filter((accountId) => !input.putBack.has(accountId) && !kept.some((choice) => choice.accountId === accountId && choice.month === input.month))
    .map((accountId) => ({ accountId, month: input.month }));
  return [...kept, ...added];
}

/** What has been typed on the close screen and not saved: an account's closing balance, and its opening at the first close. */
export type TypedBalances = Readonly<Record<string, { readonly opening?: Money; readonly closing?: Money }>>;

/** A payment on a loan, as the close reads it: the account it left, if one was named, the amount and the day. A voided one is not counted. */
export interface CloseLoanPayment {
  readonly accountId: string | null;
  readonly amount: Money;
  readonly date: string;
  readonly isVoided?: boolean;
}

export interface CloseInput {
  readonly month: string;
  /** The day it is asked. A month can be closed only once it has ended, in India. */
  readonly today: string;
  /** The accounts the caller may read. */
  readonly accounts: readonly Account[];
  readonly balances: readonly AccountBalance[];
  readonly credits: readonly Credit[];
  readonly transfers: readonly Transfer[];
  /** Money into holdings and out of them that names an account. The screen does not read these yet and passes none. */
  readonly holdingMoves?: readonly MonthHoldingMove[];
  /** The payments on loans (ledger-income.md section 4c). Those that name an account are paid to loans, and are not spent. */
  readonly loanPayments?: readonly CloseLoanPayment[];
  /** What the database adds of the money the caller cannot read, for an owner or a partner. None for anyone else. */
  readonly unreadable?: readonly MonthUnreadable[];
  readonly typed: TypedBalances;
  /** The months closed without a statement-date card, which that card's statement, when it arrives, supersedes (card-cycles.md 2.4). */
  readonly closedWithout?: ClosedWithout;
}

/** An account's balance on a day: a statement's beats a typed one. Null when none was recorded for that day. */
function balanceOn(balances: readonly AccountBalance[], accountId: string, day: string): Money | null {
  const here = balances.filter((b) => b.accountId === accountId && b.asAt === day);
  return (here.find((b) => b.source === 'statement') ?? here[0])?.balance ?? null;
}

const isStatementCard = (account: Account): boolean => account.type === 'card' && account.cycleEnds === 'statement';

/**
 * The dues of a statement-date card that the close reads: every statement's, and a typed one only in a month that has no statement's. One cycle, one figure (CY-I13): a typed 17 October and
 * a statement of 18 October are the same cycle, and the statement is used; the typed row is kept in the database and not read. One per day, a statement's beating a typed one.
 */
function cycleDues(balances: readonly AccountBalance[], accountId: string): AccountBalance[] {
  const own = balances.filter((b) => b.accountId === accountId);
  const statedMonths = new Set(own.filter((b) => b.source === 'statement').map((b) => b.asAt.slice(0, 7)));
  const read = own.filter((b) => b.source === 'statement' || !statedMonths.has(b.asAt.slice(0, 7)));
  const byDay = new Map<string, AccountBalance>();
  for (const b of read) {
    const held = byDay.get(b.asAt);
    if (held === undefined || (b.source === 'statement' && held.source !== 'statement')) byDay.set(b.asAt, b);
  }
  return [...byDay.values()].sort((a, b) => (a.asAt < b.asAt ? -1 : a.asAt > b.asAt ? 1 : 0));
}

/**
 * The cycle of each statement-date card for a month (card-cycles.md 2.2 to 2.4, 3): the statement dated in the month closes it, the balance before that opens it, and the window is the days
 * between. Pure; nothing is stored per window, so statements imported out of order are worked out the same.
 */
export function cardCycles(input: { readonly month: string; readonly accounts: readonly Account[]; readonly balances: readonly AccountBalance[]; readonly closedWithout?: ClosedWithout }): CardCycle[] {
  const lastDay = lastDayOf(input.month);
  return inUse(input.accounts, input.month)
    .filter(isStatementCard)
    .map((account): CardCycle => {
      const dues = cycleDues(input.balances, account.id);
      const inMonth = dues.filter((due) => due.asAt.slice(0, 7) === input.month);
      const closingRow = inMonth[inMonth.length - 1];
      if (closingRow === undefined) {
        if (dues.some((due) => due.asAt > lastDay)) return { kind: 'none-this-month', accountId: account.id };
        const without = (input.closedWithout ?? []).some((choice) => choice.accountId === account.id && choice.month === input.month);
        return without ? { kind: 'closed-without', accountId: account.id } : { kind: 'waiting', accountId: account.id };
      }
      const emiConvertedMinor = closingRow.emiConvertedMinor ?? 0n;
      const emiPrincipalMinor = closingRow.emiPrincipalMinor ?? 0n;
      const openingRow = dues.filter((due) => due.asAt < closingRow.asAt).pop();
      if (openingRow === undefined) {
        return { kind: 'first-left-out', accountId: account.id, to: closingRow.asAt, closing: closingRow.balance, emiConvertedMinor, emiPrincipalMinor };
      }
      return {
        kind: 'cycle',
        accountId: account.id,
        from: addDays(openingRow.asAt, 1),
        to: closingRow.asAt,
        opening: openingRow.balance,
        closing: closingRow.balance,
        emiConvertedMinor,
        emiPrincipalMinor,
        sources: { opening: openingRow.source, closing: closingRow.source },
      };
    });
}

/** A due typed at the close for a statement-date card: an amount, and the date on the statement (card-cycles.md 8.2). */
export interface TypedDue {
  readonly amount: string;
  readonly date: string;
}

/**
 * The balances that a due typed at the close makes: for each statement-date card with an amount and a date typed, a typed balance on the statement's date, which must fall in the month. It
 * is read as the card's cycle like any due, and a statement for the same cycle replaces it (CY-I13). What is wrong is said in words, by card; nothing typed makes nothing.
 */
export function typedDueBalances(input: { readonly month: string; readonly accounts: readonly Account[]; readonly typed: Readonly<Record<string, TypedDue>> }): {
  readonly balances: AccountBalance[];
  readonly problems: Record<string, string>;
  /** Which field each problem is about, so it is said under that one. */
  readonly fields: Record<string, 'amount' | 'date'>;
} {
  const balances: AccountBalance[] = [];
  const problems: Record<string, string> = {};
  const fields: Record<string, 'amount' | 'date'> = {};
  const used = inUse(input.accounts, input.month);
  for (const [accountId, due] of Object.entries(input.typed)) {
    const account = used.find((each) => each.id === accountId);
    if (account === undefined || !isStatementCard(account)) continue;
    if (due.amount.trim() === '' && due.date.trim() === '') continue;
    if (due.amount.trim() === '') {
      problems[accountId] = 'Type the amount due.';
      fields[accountId] = 'amount';
      continue;
    }
    const amount = parseBalance(due.amount, account.currency);
    if (!amount.ok) {
      problems[accountId] = amount.problem;
      fields[accountId] = 'amount';
      continue;
    }
    if (due.date.trim() === '') {
      problems[accountId] = 'Say the date on the statement.';
      fields[accountId] = 'date';
      continue;
    }
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(due.date) && !Number.isNaN(Date.parse(`${due.date}T00:00:00Z`)) && due.date.slice(0, 7) === input.month;
    if (!valid) {
      problems[accountId] = `The statement date must fall in ${monthWord(input.month)}.`;
      fields[accountId] = 'date';
      continue;
    }
    if (amount.balance === null) continue;
    balances.push({ id: `typed-due-${accountId}`, householdId: account.householdId, accountId, asAt: due.date, balance: amount.balance, source: 'typed', note: null });
  }
  return { balances, problems, fields };
}

/** The accounts in a month's close: those in use, and those archived in that month or after it (ledger-income.md section 1a). */
const inUse = (accounts: readonly Account[], month: string): Account[] =>
  accounts.filter((account) => !account.isArchived || (account.archivedOn !== undefined && account.archivedOn !== null && account.archivedOn.slice(0, 7) >= month));

/**
 * What was itemised in a month, per currency, as the figure it is compared with has it: the expenses that are not voided, less the month's refunds
 * (LI-I3). Without the refunds a purchase refunded into the same account would read as itemised and not spent.
 */
export function itemisedFigures(
  expenses: readonly { readonly amount: Money; readonly isVoided: boolean }[],
  credits: readonly Credit[],
  month: string,
): Map<string, bigint> {
  const by = new Map<string, bigint>();
  for (const expense of expenses) {
    if (!expense.isVoided) by.set(expense.amount.currency, (by.get(expense.amount.currency) ?? 0n) + expense.amount.minor);
  }
  for (const credit of credits) {
    if (credit.isVoided || isIncome(credit.category) || credit.date.slice(0, 7) !== month) continue;
    by.set(credit.amount.currency, (by.get(credit.amount.currency) ?? 0n) - credit.amount.minor);
  }
  return by;
}

export type CloseFigures =
  /** `cards` is each statement-date card's cycle for the month, and is absent for a household with none. */
  | { readonly status: 'figures'; readonly currencies: readonly MonthFigures[]; readonly cards?: readonly CardCycle[] }
  | { readonly status: 'not-ended' }
  /** The accounts with an opening or a closing balance still to be typed, in the order given; a statement-date card waits for its statement and is named here. */
  | { readonly status: 'missing'; readonly missing: readonly string[]; readonly cards?: readonly CardCycle[] }
  | { readonly status: 'no-accounts' };

/** An empty window: a card with nothing of this month counts none of its credits, legs or moves in it. */
const NO_DAYS = { from: '9999-12-31', to: '0000-01-01' } as const;

/** What the month came to, from the balances at its two ends and what the ledger knows; or what is still to be typed. */
export function closeFigures(input: CloseInput): CloseFigures {
  const accounts = inUse(input.accounts, input.month);
  if (accounts.length === 0) return { status: 'no-accounts' };
  const opensOn = lastDayOf(addMonths(`${input.month}-01`, -1).slice(0, 7));
  const closesOn = lastDayOf(input.month);
  // A currency in which no account is read has no honest figure, and is not drawn as a month of nothing.
  const readIn = new Set(accounts.map((account) => account.currency));
  const unreadable = (input.unreadable ?? []).filter((line) => readIn.has(line.currency) || line.outside !== 0n);

  const cards = cardCycles({ month: input.month, accounts, balances: input.balances, ...(input.closedWithout === undefined ? {} : { closedWithout: input.closedWithout }) });
  const cycleOf = new Map(cards.map((cycle) => [cycle.accountId, cycle] as const));
  // A card left out of the close takes nothing with it that is counted twice: what touches it is not read, so a payment to it is simply what the bank spent.
  const omitted = new Set(cards.filter((cycle) => cycle.kind === 'closed-without').map((cycle) => cycle.accountId));
  const inClose = accounts.filter((account) => !omitted.has(account.id));

  const result = closedMonthFigures({
    month: input.month,
    today: input.today,
    accounts: inClose.map((account) => {
      const cycle = cycleOf.get(account.id);
      if (cycle === undefined) {
        return {
          id: account.id,
          type: account.type,
          currency: account.currency,
          opening: input.typed[account.id]?.opening ?? balanceOn(input.balances, account.id, opensOn),
          closing: input.typed[account.id]?.closing ?? balanceOn(input.balances, account.id, closesOn),
        };
      }
      const base = { id: account.id, type: account.type, currency: account.currency };
      switch (cycle.kind) {
        case 'cycle':
          return { ...base, opening: cycle.opening, closing: cycle.closing, window: { from: cycle.from, to: cycle.to }, emiConvertedMinor: cycle.emiConvertedMinor, emiPrincipalMinor: cycle.emiPrincipalMinor };
        case 'first-left-out':
          // Opens from its own closing, so it adds nothing; its window is the month it ends in, which is as much as is known of it.
          return {
            ...base,
            opening: cycle.closing,
            closing: cycle.closing,
            window: { from: `${cycle.to.slice(0, 7)}-01`, to: cycle.to },
            emiConvertedMinor: cycle.emiConvertedMinor,
            emiPrincipalMinor: cycle.emiPrincipalMinor,
          };
        case 'none-this-month':
          return { ...base, opening: money(0n, account.currency), closing: money(0n, account.currency), window: NO_DAYS };
        default:
          return { ...base, opening: null, closing: null };
      }
    }),
    credits: input.credits
      .filter((credit) => !credit.isVoided && (credit.accountId === null || !omitted.has(credit.accountId)))
      .map((credit) => ({ accountId: credit.accountId, category: credit.category, amount: credit.amount, date: credit.date })),
    transfers: input.transfers
      .filter((t) => !t.isVoided && !omitted.has(t.fromAccountId) && !omitted.has(t.toAccountId))
      .map((t) => ({ fromId: t.fromAccountId, toId: t.toAccountId, amount: t.amount, date: t.date })),
    holdingMoves: (input.holdingMoves ?? []).filter((move) => !omitted.has(move.accountId)),
    loanPayments: (input.loanPayments ?? []).flatMap((payment) =>
      payment.isVoided === true || payment.accountId === null || omitted.has(payment.accountId) ? [] : [{ accountId: payment.accountId, amount: payment.amount, date: payment.date }],
    ),
    ...(unreadable.length === 0 ? {} : { unreadable }),
  });
  const cardsField = cards.length === 0 ? {} : { cards };
  if (result.ok) return { status: 'figures', currencies: result.currencies, ...cardsField };
  if (result.reason === 'not-ended') return { status: 'not-ended' };
  return { status: 'missing', missing: result.missing, ...cardsField };
}

export interface AccountStep {
  readonly accountId: string;
  readonly title: string;
  readonly type: Account['type'];
  readonly currency: string;
  readonly opening: Money | null;
  readonly closing: Money | null;
  /** The opening is not there and has to be typed: the first close asks for both. */
  readonly openingNeeded: boolean;
  readonly closingNeeded: boolean;
  /** What the ledger says came in: its credits and the transfers into it. Never typed beside the balances. */
  readonly moneyIn: bigint | null;
  /** What left the account, from the figures; null until both balances are there. */
  readonly left: bigint | null;
}

/** One row for each account in use: the closing balance as the only input, with opening, money in and what was left beside it. */
export function accountSteps(input: CloseInput): AccountStep[] {
  const figures = closeFigures(input);
  const lines = figures.status === 'figures' ? figures.currencies.flatMap((currency) => currency.left) : [];
  const opensOn = lastDayOf(addMonths(`${input.month}-01`, -1).slice(0, 7));
  const closesOn = lastDayOf(input.month);
  const cycleOf = new Map(
    cardCycles({ month: input.month, accounts: input.accounts, balances: input.balances, ...(input.closedWithout === undefined ? {} : { closedWithout: input.closedWithout }) }).map((cycle) => [cycle.accountId, cycle] as const),
  );

  return inUse(input.accounts, input.month).map((account) => {
    // A statement-date card's figures are its statements', never typed here (card-cycles.md 8.2).
    const cycle = cycleOf.get(account.id);
    const opening: Money | null =
      cycle === undefined
        ? (input.typed[account.id]?.opening ?? balanceOn(input.balances, account.id, opensOn))
        : cycle.kind === 'cycle'
          ? cycle.opening
          : cycle.kind === 'first-left-out'
            ? cycle.closing
            : cycle.kind === 'none-this-month'
              ? money(0n, account.currency)
              : null;
    const closing: Money | null =
      cycle === undefined
        ? (input.typed[account.id]?.closing ?? balanceOn(input.balances, account.id, closesOn))
        : cycle.kind === 'cycle' || cycle.kind === 'first-left-out'
          ? cycle.closing
          : cycle.kind === 'none-this-month'
            ? money(0n, account.currency)
            : null;
    const line = lines.find((each) => each.accountId === account.id);
    return {
      accountId: account.id,
      title: titleOf(account),
      type: account.type,
      currency: account.currency,
      opening,
      closing,
      openingNeeded: opening === null,
      closingNeeded: closing === null,
      moneyIn: line?.moneyInMinor ?? null,
      left: line?.leftMinor ?? null,
    };
  });
}

/** A balance typed at the close. A blank is not typed yet, which is not the same as nothing; zero is a balance. A minus sign is refused: a due is typed as what is owed. */
export function parseBalance(text: string, currency: string): { readonly ok: true; readonly balance: Money | null } | { readonly ok: false; readonly problem: string } {
  if (text.trim() === '') return { ok: true, balance: null };
  try {
    return { ok: true, balance: money(parseAmountToMinor(text, currency), currency) };
  } catch (error) {
    const said = error instanceof Error ? error.message : '';
    return { ok: false, problem: said.includes('decimal places') ? said : 'The balance is a number, such as 2,20,380, with no minus sign.' };
  }
}

/**
 * The latest month-end, going back a year from the month the prompt offers, on which an account in use has a balance: the day the cash reserve is as at
 * (the owner's board draws *from balances at 31 Oct · 3 of 4 accounts*). It does not need every account closed, so an account added since, or a partial close,
 * leaves the reserve where it was and lets the count say how many it covers. Null before a first close, and with no account in use.
 */
export function lastBalanceMonth(input: { readonly today: string; readonly accounts: readonly Account[]; readonly balances: readonly AccountBalance[] }): string | null {
  let month = monthToClose(input.today);
  for (let back = 0; back < 12; back += 1) {
    const closesOn = lastDayOf(month);
    // A statement-date card has a balance in a month when one is dated anywhere in it: its statement's.
    const has = (account: Account): boolean =>
      isStatementCard(account) ? input.balances.some((b) => b.accountId === account.id && b.asAt.slice(0, 7) === month) : balanceOn(input.balances, account.id, closesOn) !== null;
    if (inUse(input.accounts, month).some(has)) return month;
    month = addMonths(`${month}-01`, -1).slice(0, 7);
  }
  return null;
}

/** Whether Close October is offered: to someone who can record, once what the close needs has been read, while some account in use has no closing balance. */
export function offersClose(input: {
  readonly month: string;
  readonly accounts: readonly Account[];
  readonly balances: readonly AccountBalance[];
  readonly canRecord: boolean;
  /** The credits and moves have been read: money in read as nothing would make spent read low. */
  readonly moneyReady: boolean;
  readonly closedWithout?: ClosedWithout;
}): boolean {
  return (
    input.moneyReady &&
    input.canRecord &&
    input.accounts.some((account) => !account.isArchived) &&
    !isClosed({ month: input.month, accounts: input.accounts, balances: input.balances, ...(input.closedWithout === undefined ? {} : { closedWithout: input.closedWithout }) })
  );
}

/** Whether a month has been closed: every account in use has a closing balance on its last day. Nothing in use is nothing closed from balances. */
export function isClosed(input: { readonly month: string; readonly accounts: readonly Account[]; readonly balances: readonly AccountBalance[]; readonly closedWithout?: ClosedWithout }): boolean {
  const used = inUse(input.accounts, input.month);
  if (used.length === 0) return false;
  const closesOn = lastDayOf(input.month);
  // A statement-date card closes with its statement dated in the month (or has none to wait for, or was left out by an owner or a partner), never with a balance typed for the last day.
  const waiting = new Set(
    cardCycles({ month: input.month, accounts: used, balances: input.balances, ...(input.closedWithout === undefined ? {} : { closedWithout: input.closedWithout }) })
      .filter((cycle) => cycle.kind === 'waiting')
      .map((cycle) => cycle.accountId),
  );
  return used.every((account) => (isStatementCard(account) ? !waiting.has(account.id) : balanceOn(input.balances, account.id, closesOn) !== null));
}
