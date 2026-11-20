/**
 * What an import will write (docs/design/spending-capture.md section 4; docs/build-plan.md step 7): the matcher's proposal for each line, and what a person decided about it.
 *
 * Every row can be changed before anything is written. A suggestion (a near match) waits for a person, and the import cannot be committed until it has an answer. A skip that is a
 * guess from the text can be overruled; a skip the statement is sure of cannot; and a line that merges by its UPI reference cannot be made a second entry, which the database would
 * refuse in any case. Pure: proposals and decisions in, the writes out.
 */

import type { StatementLine } from './common.ts';
import { CREDIT_CATEGORIES, type CreditCategory } from '../credit.ts';
import type { Fill, MatchedRow, NewCredit, NewEntry, Proposal, SkipReason } from './match.ts';

export type Decision = 'create' | 'merge' | 'skip';

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
      return 'skip';
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
  | { readonly kind: 'witness'; readonly index: number; readonly line: StatementLine; readonly lineHash: string; readonly entryId: string; readonly fill: Fill };

export interface ImportPlan {
  readonly writes: readonly PlannedWrite[];
  /** The rows whose suggestion has no answer yet. */
  readonly undecided: readonly number[];
  readonly counts: { readonly create: number; readonly credit: number; readonly witness: number; readonly skip: number; readonly undecided: number };
  /** Something to write, and every suggestion answered. */
  readonly canCommit: boolean;
  /** Every suggestion is answered and nothing would be written: a statement imported before, or one that is all left out. The screen says so rather than leaving a button off. */
  readonly nothingToWrite: boolean;
}

const isCreditCategory = (value: string | null | undefined): value is CreditCategory => value !== null && value !== undefined && (CREDIT_CATEGORIES as readonly string[]).includes(value);

/** `categories` is what a person chose for a row: an expense category's id for an expense, a credit category for money in. */
export function planImport(rows: readonly MatchedRow[], decisions: ReadonlyMap<number, Decision>, categories: ReadonlyMap<number, string | null> = new Map()): ImportPlan {
  const writes: PlannedWrite[] = [];
  const undecided: number[] = [];
  let skip = 0;

  rows.forEach((row, index) => {
    const asked = decisions.get(index);
    const decision = asked !== undefined && allowedDecisions(row.proposal).includes(asked) ? asked : defaultDecision(row.proposal);
    const { proposal } = row;
    if (decision === null) {
      undecided.push(index);
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

  const create = writes.filter((write) => write.kind === 'create').length;
  const credit = writes.filter((write) => write.kind === 'credit').length;
  return {
    writes,
    undecided,
    counts: { create, credit, witness: writes.length - create - credit, skip, undecided: undecided.length },
    canCommit: undecided.length === 0 && writes.length > 0,
    nothingToWrite: undecided.length === 0 && writes.length === 0,
  };
}

/** Why a line is not imported, in words a person can act on. A guess says so, and says what to do if it is wrong. */
export function skipWords(reason: SkipReason, sure: boolean, moneyIn = false): string {
  if (moneyIn && !sure) {
    if (reason === 'investment') return 'Looks like money back from an investment, which is not income. Add it if it is.';
    if (reason === 'own-transfer') return 'Looks like money from your own account, which is not income. Add it if it is.';
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
      return 'Looks like money in you have already typed. Add it if it is not the same.';
    case 'investment':
      return 'Looks like money put into an investment, which is a purchase to link in Holdings and not an expense. Import it if it is not.';
    case 'own-transfer':
      return sure ? 'A move between your own accounts, which is not spending.' : 'Looks like a move between your own accounts, which is not spending. Import it if it is not.';
  }
}
