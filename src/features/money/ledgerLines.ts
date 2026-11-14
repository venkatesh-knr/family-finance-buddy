/**
 * The ledger's lines for money in and money moved (docs/design/ledger-income.md section 1; the MoneyLedger board).
 *
 * Pure: the accounts and members are passed in, and nothing here reads a database or a clock. A line is a name, a second line (the category,
 * whose it is, the account, who sees it), a signed amount and one word for what it does to the month. Direction is a sign and a word, with
 * an arrow beside them, and never a colour alone (LI-I16): money in is `+` and *came in* or, for a refund, *takes away from spent*; a move
 * has no sign and says *moved · not spent*.
 */

import { CREDIT_LABEL, ledgerWord } from '../../domain/credit.ts';
import { formatMoney } from '../../lib/money.ts';
import type { Account, Credit, Member, Transfer } from '../../repo/types.ts';
import { titleOf } from './accountRows.ts';

export type LedgerFilter = 'all' | 'in' | 'out' | 'moved';
export const LEDGER_FILTERS: readonly { readonly id: LedgerFilter; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'In' },
  { id: 'out', label: 'Out' },
  { id: 'moved', label: 'Moved' },
];

export type LedgerKind = 'spending' | 'credit' | 'move';

/** The kinds of line each filter shows: In is money in, Out is spending, Moved is money moved between the household's own accounts. */
export function kindsFor(filter: LedgerFilter): readonly LedgerKind[] {
  switch (filter) {
    case 'all':
      return ['spending', 'credit', 'move'];
    case 'in':
      return ['credit'];
    case 'out':
      return ['spending'];
    case 'moved':
      return ['move'];
  }
}

export interface LedgerContext {
  readonly accounts: readonly Account[];
  readonly members: readonly Member[];
  readonly viewerMemberId: string;
  readonly privacy: boolean;
}

export interface LedgerLine {
  readonly title: string;
  readonly sub: string;
  /** A private credit carries a lock. */
  readonly private: boolean;
  /** The figure with its sign, or without one for a move. */
  readonly amount: string;
  /** What the line does to the month. A voided line does nothing to it, and says so. */
  readonly word: string;
  readonly voided: boolean;
  /** The whole line as one sentence, for a screen reader: the name, the second line, the figure and the word. */
  readonly name: string;
}

/** What a line of spending does to the month: a minus sign and *spent*, or, voided, that it is not counted. */
export function spendingWord(voided: boolean): { readonly sign: '−'; readonly word: string } {
  return { sign: '−', word: voided ? VOIDED_WORD : ledgerWord('spending').word };
}

const VOIDED_WORD = 'voided · not counted';

/** One line of money in. */
export function creditLine(credit: Credit, context: LedgerContext): LedgerLine {
  const label = CREDIT_LABEL[credit.category];
  const named = credit.payer !== null && credit.payer !== '';
  const owner = context.members.find((member) => member.id === credit.memberId);
  const account = credit.accountId === null ? null : (context.accounts.find((each) => each.id === credit.accountId) ?? null);
  const isPrivate = credit.visibility === 'personal';
  const several = context.members.filter((member) => !member.isArchived).length > 1;

  const parts: string[] = [];
  if (named) parts.push(label);
  if (several) parts.push(owner?.displayName ?? 'a member');
  parts.push(credit.accountId === null ? 'no account' : account === null ? 'an account' : titleOf(account));
  if (isPrivate) parts.push(credit.memberId === context.viewerMemberId ? 'only you see this row' : 'only its owner sees this row');

  const { word: said, sign } = ledgerWord(credit.category === 'refund' ? 'refund' : 'income');
  const word = credit.isVoided ? VOIDED_WORD : said;
  const title = named ? (credit.payer as string) : label;
  const sub = parts.join(' · ');
  const amount = `${sign}${formatMoney(credit.amount, { privacy: context.privacy })}`;
  return { title, sub, private: isPrivate, amount, word, voided: credit.isVoided, name: `${title}, ${sub}, ${amount}, ${word}` };
}

/** One move between the household's own accounts, a card payment among them: neither money in nor spent. */
export function transferLine(transfer: Transfer, context: LedgerContext): LedgerLine {
  const from = context.accounts.find((each) => each.id === transfer.fromAccountId) ?? null;
  const to = context.accounts.find((each) => each.id === transfer.toAccountId) ?? null;
  const name = (account: Account | null): string => (account === null ? 'another account' : titleOf(account));
  const word = transfer.isVoided ? VOIDED_WORD : ledgerWord('move').word;
  const title = to !== null && to.type === 'card' ? `${to.name} payment` : 'Moved between accounts';
  const sub = `${name(from)} → ${name(to)}`;
  const amount = formatMoney(transfer.amount, { privacy: context.privacy });
  return { title, sub, private: false, amount, word, voided: transfer.isVoided, name: `${title}, ${sub}, ${amount}, ${word}` };
}

/** Newest first. Entries of one day keep the order they were given in. */
export function mergeByDate<T extends { readonly date: string }>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.date === b.entry.date ? a.index - b.index : a.entry.date < b.entry.date ? 1 : -1))
    .map(({ entry }) => entry);
}
