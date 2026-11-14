/**
 * The month close (docs/design/spending-capture.md sections 2 and 6; ledger-income.md section 4; the MonthClose board).
 *
 * Pure: the accounts, balances, credits and moves the caller may read are passed in, with what has been typed on the screen and not yet saved,
 * and nothing here reads a database or a clock. It assembles the domain's `closedMonthFigures` from them (`src/domain/money-month.ts`): an
 * account's opening is its balance on the last day of the month before and its closing its balance on the last day of the month, a statement
 * beating a typed figure for the same day. Spent is derived and never stored (SC-I1); the close stores balances. Money in is the ledger's:
 * credits and the transfers in, never typed beside the balances. An archived account is not in a close.
 */

import { addMonths } from '../../domain/accrual.ts';
import { isIncome } from '../../domain/credit.ts';
import { closedMonthFigures, type MonthFigures, type MonthHoldingMove } from '../../domain/money-month.ts';
import { money, parseAmountToMinor, type Money } from '../../lib/money.ts';
import type { Account, AccountBalance, Credit, Transfer } from '../../repo/types.ts';
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

/** What has been typed on the close screen and not saved: an account's closing balance, and its opening at the first close. */
export type TypedBalances = Readonly<Record<string, { readonly opening?: Money; readonly closing?: Money }>>;

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
  readonly typed: TypedBalances;
}

/** An account's balance on a day: a statement's beats a typed one. Null when none was recorded for that day. */
function balanceOn(balances: readonly AccountBalance[], accountId: string, day: string): Money | null {
  const here = balances.filter((b) => b.accountId === accountId && b.asAt === day);
  return (here.find((b) => b.source === 'statement') ?? here[0])?.balance ?? null;
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
  | { readonly status: 'figures'; readonly currencies: readonly MonthFigures[] }
  | { readonly status: 'not-ended' }
  /** The accounts with an opening or a closing balance still to be typed, in the order given. */
  | { readonly status: 'missing'; readonly missing: readonly string[] }
  | { readonly status: 'no-accounts' };

/** What the month came to, from the balances at its two ends and what the ledger knows; or what is still to be typed. */
export function closeFigures(input: CloseInput): CloseFigures {
  const accounts = inUse(input.accounts, input.month);
  if (accounts.length === 0) return { status: 'no-accounts' };
  const opensOn = lastDayOf(addMonths(`${input.month}-01`, -1).slice(0, 7));
  const closesOn = lastDayOf(input.month);

  const result = closedMonthFigures({
    month: input.month,
    today: input.today,
    accounts: accounts.map((account) => ({
      id: account.id,
      type: account.type,
      currency: account.currency,
      opening: input.typed[account.id]?.opening ?? balanceOn(input.balances, account.id, opensOn),
      closing: input.typed[account.id]?.closing ?? balanceOn(input.balances, account.id, closesOn),
    })),
    credits: input.credits
      .filter((credit) => !credit.isVoided)
      .map((credit) => ({ accountId: credit.accountId, category: credit.category, amount: credit.amount, date: credit.date })),
    transfers: input.transfers.filter((t) => !t.isVoided).map((t) => ({ fromId: t.fromAccountId, toId: t.toAccountId, amount: t.amount, date: t.date })),
    holdingMoves: input.holdingMoves ?? [],
    loanPayments: [],
  });
  if (result.ok) return { status: 'figures', currencies: result.currencies };
  if (result.reason === 'not-ended') return { status: 'not-ended' };
  return { status: 'missing', missing: result.missing };
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

  return inUse(input.accounts, input.month).map((account) => {
    const opening = input.typed[account.id]?.opening ?? balanceOn(input.balances, account.id, opensOn);
    const closing = input.typed[account.id]?.closing ?? balanceOn(input.balances, account.id, closesOn);
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

/** Whether a month has been closed: every account in use has a closing balance on its last day. Nothing in use is nothing closed from balances. */
export function isClosed(input: { readonly month: string; readonly accounts: readonly Account[]; readonly balances: readonly AccountBalance[] }): boolean {
  const used = inUse(input.accounts, input.month);
  if (used.length === 0) return false;
  const closesOn = lastDayOf(input.month);
  return used.every((account) => balanceOn(input.balances, account.id, closesOn) !== null);
}
