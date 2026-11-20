/**
 * Moves between the household's own accounts, across the statements read together (docs/design/ledger-income.md sections 1 and 12; docs/build-plan.md step 7).
 *
 * A move between two of the household's own accounts is one `account_transfer`, neither income nor spent. On two bank statements it shows twice, as a debit on one and a credit on the
 * other, and imported as it stands it would read as an expense and as income, each wrong and each counted. So when statements are read together, a debit on one bank account and a credit
 * of the same amount on another, a day apart at most, are offered as one move. It is a guess from amount and date and is **offered**: the person can make the two lines what they
 * looked like instead, or leave them out. Pure: rows in, pairs out.
 *
 * Only bank statements are paired. A card's purchase and a card's refund are the lines a bank's debit and credit of the same amount would most easily be mistaken for, and a UPI app's
 * statement is a witness to payments the bank statement has. Money in that says what it is (salary, interest, a refund) is not a move, and a line that is already an entry, a suggestion
 * or left out for certain is not touched. A line that was guessed to be a move to oneself, on either side, is taken, since pairing it with its other half is better evidence than the guess.
 */

import type { IsoDate } from "../../lib/dates.ts";
import { pairOwnTransfers, type MatchedRow } from "./match.ts";

/** A move between two of the household's own accounts, made from the debit's line. */
export interface NewMove {
  readonly date: IsoDate;
  readonly amountMinor: bigint;
  readonly currency: "INR";
  readonly fromLast4: string;
  readonly toLast4: string;
  /** The hash of the debit's line, which recognises that line when its statement is imported again. */
  readonly sourceHash: string;
}

/** A debit and the credit that is its other half, by their place in the rows read together. */
export interface MovePair {
  readonly debit: number;
  readonly credit: number;
  readonly move: NewMove;
}

/** A row of a statement, and whether that statement is of a bank account (and not a card or a UPI app). */
export interface FlatRow {
  readonly row: MatchedRow;
  readonly bank: boolean;
}

/** The last four of the account a row would be written to, when the row could be one side of a move; null when it could not. */
function debitSide(row: MatchedRow): string | null {
  const { proposal } = row;
  if (row.line.direction !== "debit") return null;
  if (proposal.action === "create") return proposal.entry.accountLast4;
  if (
    proposal.action === "skip" &&
    !proposal.sure &&
    proposal.reason === "own-transfer" &&
    proposal.entry !== undefined
  )
    return proposal.entry.accountLast4;
  return null;
}

function creditSide(row: MatchedRow): string | null {
  const { proposal } = row;
  if (row.line.direction !== "credit") return null;
  if (proposal.action === "credit")
    return proposal.credit.category === "other_income"
      ? proposal.credit.accountLast4
      : null;
  if (
    proposal.action === "skip" &&
    !proposal.sure &&
    proposal.reason === "own-transfer" &&
    proposal.credit !== undefined
  )
    return proposal.credit.accountLast4;
  return null;
}

export function findMoves(rows: readonly FlatRow[]): MovePair[] {
  const sides: { id: string; account: string; line: MatchedRow["line"] }[] = [];
  rows.forEach((flat, index) => {
    if (!flat.bank) return;
    const account = debitSide(flat.row) ?? creditSide(flat.row);
    if (account !== null)
      sides.push({ id: String(index), account, line: flat.row.line });
  });

  const paired = pairOwnTransfers(sides);
  const moves: MovePair[] = [];
  for (const side of sides) {
    if (side.line.direction !== "debit") continue;
    const other = paired.get(side.id);
    const credit =
      other === undefined
        ? undefined
        : sides.find((candidate) => candidate.id === other);
    const debitRow = rows[Number(side.id)];
    if (credit === undefined || debitRow === undefined) continue;
    moves.push({
      debit: Number(side.id),
      credit: Number(credit.id),
      move: {
        date: side.line.date,
        amountMinor: side.line.amountMinor,
        currency: "INR",
        fromLast4: side.account,
        toLast4: credit.account,
        sourceHash: debitRow.row.lineHash,
      },
    });
  }
  return moves.sort((a, b) => a.debit - b.debit);
}
