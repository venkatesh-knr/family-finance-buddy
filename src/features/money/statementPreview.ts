/**
 * What the import's preview says of each line (docs/design/spending-capture.md section 4; the Money screen's *Import a statement*).
 *
 * Pure: the matcher's rows, what the person has decided so far and the entries the household already has in; for each line, what it is called, what the import will do with it, what it
 * may be changed to, and which part of the list it is in. What needs an answer comes first, then what will be added, what will be merged into an entry that is already there, and what
 * is left out; the last is folded on the screen, since it is mostly what is not spending and the person need only look at it if something is missing.
 */

import { formatShortDate, type IsoDate } from '../../lib/dates.ts';
import type { StatementLine } from '../../domain/statement/common.ts';
import type { ExistingEntry, MatchedRow } from '../../domain/statement/match.ts';
import type { MovePair } from '../../domain/statement/moves.ts';
import type { CardNote } from '../../domain/statement/statedBalance.ts';
import { resolveRows, skipWords, type Decision } from '../../domain/statement/plan.ts';

/** `guess`: left out because it looks like something that is not spending, which is a guess and may be wrong, so it is shown apart from what is left out for certain. */
export type PreviewGroup = 'decide' | 'guess' | 'add' | 'merge' | 'left';

export interface PreviewRow {
  /** The row's place in the statement, which a decision is kept by. */
  readonly index: number;
  readonly date: IsoDate;
  readonly title: string;
  readonly amountMinor: bigint;
  readonly direction: 'debit' | 'credit';
  readonly doing: string;
  /** What will happen now: what the person chose, or the default; null for a suggestion nobody has answered. */
  readonly decision: Decision | null;
  readonly options: readonly { readonly value: Decision; readonly label: string }[];
  readonly group: PreviewGroup;
  /** Money in, to be added as a credit, and not an expense: what the row's category choice offers, and what its words say. */
  readonly moneyIn: boolean;
}

const TITLE_LENGTH = 60;

/** What a line is called: its payee, or what the bank printed with any VPA taken out (a VPA is often a phone number) and the length kept short. */
export function lineTitle(line: StatementLine): string {
  if (line.payee !== null && line.payee.trim() !== '') return line.payee.trim();
  const printed = line.raw
    .split(/\s+/)
    .filter((word) => word !== '' && !word.includes('@'))
    .join(' ');
  if (printed === '') return 'No description';
  return printed.length > TITLE_LENGTH ? `${printed.slice(0, TITLE_LENGTH)}…` : printed;
}

/** A decision in words. A suggestion asks whether it is the same payment, so its two answers say so. */
export function decisionLabel(decision: Decision, suggestion: boolean, moneyIn = false): string {
  switch (decision) {
    case 'create':
      return moneyIn ? (suggestion ? 'It is different: add as money in' : 'Add as money in') : suggestion ? 'It is a different payment: add as an expense' : 'Add as an expense';
    case 'merge':
      return suggestion ? 'It is the same payment: add to that entry' : 'Add to the entry it matches';
    case 'skip':
      return moneyIn && suggestion ? 'It is the same: leave it out' : 'Leave out';
    case 'move':
      return 'Add as a move between your accounts';
  }
}

/** What the preview says of a card statement's figures (card-cycles.md 5), in words. The money, the day and the month are formatted by the caller, as the screen does everywhere. */
export function cardNoteWords(note: CardNote, format: { readonly amount: (minor: bigint) => string; readonly date: (day: IsoDate) => string; readonly month: (day: IsoDate) => string }): string {
  switch (note.kind) {
    case 'closes':
      return `Amount due ${format.amount(note.dueMinor)} on ${format.date(note.asAt)}. It closes ${format.month(note.asAt)} for this card.`;
    case 'gives-nothing':
      return `Amount due ${format.amount(note.dueMinor)}, dated ${format.date(note.asAt)}: not a month end, so it gives the close nothing. Does this card’s bill close mid-month?`;
    case 'replaces-typed':
      return `You typed ${format.amount(note.typedMinor)} due on ${format.date(note.typedAsAt)} for this card. This statement says ${format.amount(note.dueMinor)} on ${format.date(note.asAt)} and will be used in its place.${
        note.differenceMinor > 0n ? ` They differ by ${format.amount(note.differenceMinor)}.` : ''
      }`;
  }
}

const GROUP_ORDER: readonly PreviewGroup[] = ['decide', 'guess', 'add', 'merge', 'left'];

const groupOf = (decision: Decision | null, guessedSkip: boolean): PreviewGroup =>
  decision === null ? 'decide' : decision === 'create' || decision === 'move' ? 'add' : decision === 'merge' ? 'merge' : guessedSkip ? 'guess' : 'left';

export function previewRows(rows: readonly MatchedRow[], decisions: ReadonlyMap<number, Decision>, existing: readonly ExistingEntry[], moves: readonly MovePair[] = []): PreviewRow[] {
  const resolved = resolveRows(rows, decisions, moves);
  const entryOf = (id: string): ExistingEntry | undefined => existing.find((entry) => entry.id === id);
  const named = (entry: ExistingEntry | undefined): string =>
    entry === undefined ? 'an entry you have' : `${entry.payee ?? 'an entry'}, ${formatShortDate(entry.date)}`;

  const out = rows.map((row, index): PreviewRow => {
    const { proposal } = row;
    const here = resolved[index];
    const allowed = here?.allowed ?? [];
    const decision = here?.decision ?? null;
    const moneyIn = proposal.action === 'credit' || (proposal.action === 'skip' && proposal.credit !== undefined);
    // A near match waits for a person, and says which answer is which.
    const suggestion = proposal.action === 'suggest' || (proposal.action === 'skip' && proposal.reason === 'credit-typed');
    const doing =
      here?.partOf !== undefined
        ? 'The other half of the move above: the same money arriving in one of your accounts. It is counted once, as a move, and is not money in.'
        : here?.move !== undefined && decision === 'move'
          ? `A move from ••${here.move.move.fromLast4} to ••${here.move.move.toLast4}: the other statement shows the same amount arriving. It is added as a move between your own accounts, which is not spending and not income.`
          : proposal.action === 'create'
        ? 'A new expense.'
        : proposal.action === 'credit'
          ? 'Money in. It is added to the Money screen as money in, not as spending.'
          : proposal.action === 'witness'
          ? `This payment is already an entry (${named(entryOf(proposal.entryId))}). This statement is added to it, and nothing is doubled.`
          : proposal.action === 'suggest'
            ? `Looks like ${named(entryOf(proposal.entryId))}, which you already have. Is it the same payment?`
            : skipWords(proposal.reason, proposal.sure, moneyIn);
    return {
      index,
      date: row.line.date,
      title: lineTitle(row.line),
      amountMinor: row.line.amountMinor,
      direction: row.line.direction,
      doing,
      decision,
      options: allowed.map((value) => ({ value, label: decisionLabel(value, suggestion, moneyIn) })),
      group: groupOf(decision, proposal.action === 'skip' && !proposal.sure && here?.partOf === undefined),
      moneyIn,
    };
  });

  return [...out].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.index - b.index);
}
