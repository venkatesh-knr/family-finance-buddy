/**
 * What an import will write (docs/design/spending-capture.md section 4; docs/build-plan.md step 7): the matcher's proposal for each line, and what a person decided about it.
 *
 * Every row can be changed before anything is written. A suggestion (a near match) waits for a person, and the import cannot be committed until it has an answer. A skip that is a
 * guess from the text can be overruled; a skip the statement is sure of cannot; and a line that merges by its UPI reference cannot be made a second entry, which the database would
 * refuse in any case. Pure: proposals and decisions in, the writes out.
 */

import type { StatementLine } from './common.ts';
import { CREDIT_CATEGORIES, defaultVisibility, type CreditCategory } from '../credit.ts';
import type { Fill, MatchedRow, NewCredit, NewEntry, Proposal, SkipReason } from './match.ts';
import type { MovePair, NewMove } from './moves.ts';

export type Decision = 'create' | 'merge' | 'skip' | 'move';

/** What happens to a line if the person does nothing; null for a suggestion, which waits for them. */
export function defaultDecision(proposal: Proposal): Decision | null {
  switch (proposal.action) {
    case 'create':
    case 'credit':
      return 'create';
    case 'witness':
      return 'merge';
    case 'suggest':
      return null;
    case 'skip':
      // Money in that may be one the household already has waits for a person, as a near match does.
      return proposal.reason === 'credit-typed' ? null : 'skip';
  }
}

/** What a person may decide for a line, in the order a screen offers them. */
export function allowedDecisions(proposal: Proposal): readonly Decision[] {
  switch (proposal.action) {
    case 'create':
    case 'credit':
      return ['create', 'skip'];
    case 'witness':
      return ['merge', 'skip'];
    case 'suggest':
      return ['merge', 'create', 'skip'];
    case 'skip':
      return proposal.entry === undefined && proposal.credit === undefined ? ['skip'] : ['skip', 'create'];
  }
}

export type PlannedWrite =
  | { readonly kind: 'create'; readonly index: number; readonly line: StatementLine; readonly lineHash: string; readonly entry: NewEntry; readonly categoryId: string | null }
  | { readonly kind: 'credit'; readonly index: number; readonly line: StatementLine; readonly lineHash: string; readonly credit: NewCredit; readonly category: CreditCategory }
  | { readonly kind: 'witness'; readonly index: number; readonly line: StatementLine; readonly lineHash: string; readonly entryId: string; readonly fill: Fill }
  /** A move between two of the household's own accounts, made from the debit's line; the credit that is its other half writes nothing of its own. */
  | { readonly kind: 'move'; readonly index: number; readonly line: StatementLine; readonly lineHash: string; readonly move: NewMove };

export interface ImportPlan {
  readonly writes: readonly PlannedWrite[];
  /** The rows whose suggestion has no answer yet. */
  readonly undecided: readonly number[];
  readonly counts: { readonly create: number; readonly credit: number; readonly move: number; readonly witness: number; readonly skip: number; readonly undecided: number };
  /** Something to write, and every suggestion answered. */
  readonly canCommit: boolean;
  /** Every suggestion is answered and nothing would be written: a statement imported before, or one that is all left out. The screen says so rather than leaving a button off. */
  readonly nothingToWrite: boolean;
}

const isCreditCategory = (value: string | null | undefined): value is CreditCategory => value !== null && value !== undefined && (CREDIT_CATEGORIES as readonly string[]).includes(value);

/** Who can see a credit an import writes: private to whoever it came to, a refund the household's, and everything private when the person keeps the whole import private. */
export function creditVisibility(category: CreditCategory, importVisibility: 'household' | 'personal'): 'household' | 'personal' {
  return importVisibility === 'personal' ? 'personal' : defaultVisibility(category);
}

/**
 * How many of the credits to be written would be private. Only the member a credit belongs to can write one that is private (the table's policy), so an import for someone else cannot
 * write these: the screen says so and the repository refuses before anything is written, rather than failing part way.
 */
export function personalCredits(writes: readonly PlannedWrite[], importVisibility: 'household' | 'personal'): number {
  return writes.filter((write) => write.kind === 'credit' && creditVisibility(write.category, importVisibility) === 'personal').length;
}

/** What is decided for one row of the rows read together, and what else it may be. */
export interface ResolvedRow {
  /** What will happen now: what the person chose, or the default; null for a suggestion nobody has answered. */
  readonly decision: Decision | null;
  readonly allowed: readonly Decision[];
  /** For the debit of a move: the pair it is half of. */
  readonly move?: MovePair;
  /** For the credit that is the other half of a move that will be made: the pair. Such a line writes nothing of its own. */
  readonly partOf?: MovePair;
}

/**
 * What each row will do. A line in a move is offered the move, and takes it unless the person decides otherwise; the credit that is its other half goes with it, writing nothing of its
 * own while the move stands, and goes back to what it was when the person decides the debit is something else.
 */
export function resolveRows(rows: readonly MatchedRow[], decisions: ReadonlyMap<number, Decision>, moves: readonly MovePair[] = []): ResolvedRow[] {
  const debits = new Map(moves.map((pair) => [pair.debit, pair] as const));
  const credits = new Map(moves.map((pair) => [pair.credit, pair] as const));
  const plain = (index: number, proposal: Proposal, extra: readonly Decision[] = []): { decision: Decision | null; allowed: readonly Decision[] } => {
    const allowed = [...extra, ...allowedDecisions(proposal)];
    const asked = decisions.get(index);
    return { decision: asked !== undefined && allowed.includes(asked) ? asked : (extra[0] ?? defaultDecision(proposal)), allowed };
  };

  const out: ResolvedRow[] = rows.map((row, index) => {
    const pair = debits.get(index);
    return pair === undefined ? plain(index, row.proposal) : { ...plain(index, row.proposal, ['move']), move: pair };
  });
  rows.forEach((row, index) => {
    const pair = credits.get(index);
    if (pair === undefined) return;
    out[index] = out[pair.debit]?.decision === 'move' ? { decision: 'skip', allowed: ['skip'], partOf: pair } : plain(index, row.proposal);
  });
  return out;
}

/** `categories` is what a person chose for a row: an expense category's id for an expense, a credit category for money in. */
export function planImport(
  rows: readonly MatchedRow[],
  decisions: ReadonlyMap<number, Decision>,
  categories: ReadonlyMap<number, string | null> = new Map(),
  moves: readonly MovePair[] = [],
): ImportPlan {
  const writes: PlannedWrite[] = [];
  const undecided: number[] = [];
  let skip = 0;
  const resolved = resolveRows(rows, decisions, moves);

  rows.forEach((row, index) => {
    const here = resolved[index];
    if (here === undefined) return;
    const { decision } = here;
    const { proposal } = row;
    if (here.partOf !== undefined) {
      // The other half of a move writes nothing of its own: it is left out, as the move already stands for it.
      skip += 1;
    } else if (decision === null) {
      undecided.push(index);
    } else if (decision === 'move' && here.move !== undefined) {
      writes.push({ kind: 'move', index, line: row.line, lineHash: row.lineHash, move: here.move.move });
    } else if (decision === 'create' && (proposal.action === 'credit' || (proposal.action === 'skip' && proposal.credit !== undefined))) {
      const credit = proposal.action === 'credit' ? proposal.credit : (proposal as { credit: NewCredit }).credit;
      const chosen = categories.get(index);
      writes.push({ kind: 'credit', index, line: row.line, lineHash: row.lineHash, credit, category: isCreditCategory(chosen) ? chosen : credit.category });
    } else if (decision === 'create' && (proposal.action === 'create' || proposal.action === 'suggest' || proposal.action === 'skip') && 'entry' in proposal && proposal.entry !== undefined) {
      writes.push({ kind: 'create', index, line: row.line, lineHash: row.lineHash, entry: proposal.entry, categoryId: categories.get(index) ?? null });
    } else if (decision === 'merge' && (proposal.action === 'witness' || proposal.action === 'suggest')) {
      writes.push({ kind: 'witness', index, line: row.line, lineHash: row.lineHash, entryId: proposal.entryId, fill: proposal.fill });
    } else {
      skip += 1;
    }
  });

  const count = (kind: PlannedWrite['kind']): number => writes.filter((write) => write.kind === kind).length;
  return {
    writes,
    undecided,
    counts: { create: count('create'), credit: count('credit'), move: count('move'), witness: count('witness'), skip, undecided: undecided.length },
    canCommit: undecided.length === 0 && writes.length > 0,
    nothingToWrite: undecided.length === 0 && writes.length === 0,
  };
}

/** Why a line is not imported, in words a person can act on. A guess says so, and says what to do if it is wrong. */
export function skipWords(reason: SkipReason, sure: boolean, moneyIn = false): string {
  if (moneyIn && !sure) {
    if (reason === 'investment') return 'Looks like money back from an investment, which is not income. Add it if it is.';
    if (reason === 'own-transfer') return 'Looks like money from your own account, which is not income. Add it if it is.';
    if (reason === 'emi-principal') return 'Looks like a purchase turned into an EMI, not a refund. Add it if it is.';
    if (reason === 'emi-conversion') return 'Looks like a bill or a purchase the card turned into EMIs, which is not a refund. Add it if it is.';
  }
  switch (reason) {
    case 'already-imported':
      return 'Already imported from this statement.';
    case 'card-payment':
      return sure ? 'A card repayment. What it paid for was recorded when it was bought.' : 'Looks like a card repayment, which is not an expense. Import it if it is not.';
    case 'emi-principal':
      return 'The price of a purchase the card turned into an EMI, which was recorded when it was bought. The interest and tax on it are imported.';
    case 'money-in':
      return 'Money received on a UPI app. It is imported from the bank statement it arrives on.';
    case 'credit-typed':
      return 'Looks like money in you already have. Is it the same?';
    case 'loan-money':
      return 'Looks like a loan paid out to you, which is not income. Add it if it is.';
    case 'investment':
      return 'Looks like money put into an investment, which is a purchase to link in Holdings and not an expense. Import it if it is not.';
    case 'emi-conversion':
      return 'A bill or a purchase the card turned into EMIs, which is not a refund.';
    case 'move-recorded':
      return moneyIn ? 'Already recorded as a move between your own accounts. Add it as money in if it is not.' : 'Already recorded as a move between your own accounts. Add it as an expense if it is not.';
    case 'own-transfer':
      return sure ? 'A move between your own accounts, which is not spending.' : 'Looks like a move between your own accounts, which is not spending. Import it if it is not.';
  }
}
