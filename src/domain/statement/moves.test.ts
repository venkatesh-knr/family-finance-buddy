import { describe, expect, it } from "vitest";
import type { StatementLine } from "./common.ts";
import type { MatchedRow, NewCredit, NewEntry, Proposal } from "./match.ts";
import { findMoves, type FlatRow } from "./moves.ts";
import {
  allowedDecisions,
  planImport,
  resolveRows,
  skipWords,
} from "./plan.ts";

/**
 * Moves between the household's own accounts, across statements read together (docs/design/ledger-income.md sections 1 and 12: a move is one `account_transfer`, neither income nor
 * spent; bank import must detect a matching debit and credit and offer the move). A debit on one bank account and a credit of the same amount on another, a day apart at most, are one
 * move and not an expense and an income. It is a guess from amount and date, so it is offered, can be changed, and is never made from a line that says what it is. The data is invented.
 */
const LINE = (over: Partial<StatementLine>): StatementLine => ({
  date: "2026-10-08",
  valueDate: null,
  direction: "debit",
  amountMinor: 5_000_000n,
  raw: "NEFT",
  payee: null,
  upiReference: null,
  reference: null,
  balanceMinor: null,
  hint: null,
  ...over,
});
const ENTRY = (
  last4: string | null,
  over: Partial<NewEntry> = {},
): NewEntry => ({
  date: "2026-10-08",
  amountMinor: 5_000_000n,
  currency: "INR",
  payee: null,
  accountId: null,
  accountLast4: last4,
  method: null,
  upiRefLast4: null,
  upiRefHash: null,
  sourceHash: "d".repeat(64),
  hint: null,
  note: null,
  ...over,
});
const CREDIT = (
  last4: string | null,
  over: Partial<NewCredit> = {},
): NewCredit => ({
  date: "2026-10-08",
  amountMinor: 5_000_000n,
  currency: "INR",
  payer: null,
  accountId: null,
  accountLast4: last4,
  category: "other_income",
  sourceHash: "c".repeat(64),
  ...over,
});

const debit = (
  last4: string,
  over: Partial<StatementLine> = {},
  entry: Partial<NewEntry> = {},
  proposal?: Proposal,
): FlatRow => ({
  bank: true,
  row: {
    line: LINE({ direction: "debit", ...over }),
    lineHash: "d".repeat(64),
    proposal: proposal ?? { action: "create", entry: ENTRY(last4, entry) },
  },
});
const credit = (
  last4: string,
  over: Partial<StatementLine> = {},
  made: Partial<NewCredit> = {},
  proposal?: Proposal,
): FlatRow => ({
  bank: true,
  row: {
    line: LINE({ direction: "credit", ...over }),
    lineHash: "c".repeat(64),
    proposal: proposal ?? { action: "credit", credit: CREDIT(last4, made) },
  },
});

describe("which lines are one move", () => {
  it("pairs a debit with a credit of the same amount on another bank account within a day, and says from where to where", () => {
    const moves = findMoves([
      debit("1111"),
      credit("2222", { date: "2026-10-09" }),
    ]);
    expect(moves).toEqual([
      {
        debit: 0,
        credit: 1,
        move: {
          date: "2026-10-08",
          amountMinor: 5_000_000n,
          currency: "INR",
          fromLast4: "1111",
          toLast4: "2222",
          sourceHash: "d".repeat(64),
        },
      },
    ]);
  });

  it("does not pair lines of one account, an amount that differs, a day too far, or lines with no account", () => {
    expect(findMoves([debit("1111"), credit("1111")])).toEqual([]);
    expect(
      findMoves([debit("1111"), credit("2222", { amountMinor: 4_000_000n })]),
    ).toEqual([]);
    expect(
      findMoves([debit("1111"), credit("2222", { date: "2026-10-12" })]),
    ).toEqual([]);
    const noAccount: FlatRow = {
      bank: true,
      row: {
        line: LINE({ direction: "credit" }),
        lineHash: "c".repeat(64),
        proposal: { action: "credit", credit: CREDIT(null) },
      },
    };
    expect(findMoves([debit("1111"), noAccount])).toEqual([]);
  });

  it("never pairs a line of a card or a UPI app, which a purchase and a refund of the same amount could be", () => {
    expect(
      findMoves([{ ...debit("1111"), bank: false }, credit("2222")]),
    ).toEqual([]);
    expect(
      findMoves([debit("1111"), { ...credit("2222"), bank: false }]),
    ).toEqual([]);
  });

  it("does not take money in that says what it is for a move, such as salary, interest or a refund", () => {
    expect(
      findMoves([debit("1111"), credit("2222", {}, { category: "salary" })]),
    ).toEqual([]);
    expect(
      findMoves([debit("1111"), credit("2222", {}, { category: "refund" })]),
    ).toEqual([]);
  });

  it("takes a line already guessed to be a move to oneself, on either side, and carries on from there", () => {
    const guessedDebit = debit(
      "1111",
      {},
      {},
      {
        action: "skip",
        reason: "own-transfer",
        sure: false,
        entry: ENTRY("1111"),
      },
    );
    const guessedCredit = credit(
      "2222",
      {},
      {},
      {
        action: "skip",
        reason: "own-transfer",
        sure: false,
        credit: CREDIT("2222", { category: "salary" }),
      },
    );
    expect(findMoves([guessedDebit, guessedCredit])).toHaveLength(1);
  });

  it("does not take a line that is already an entry, a suggestion, or left out for certain", () => {
    const merged = debit(
      "1111",
      {},
      {},
      { action: "witness", entryId: "e1", fill: {} },
    );
    const seen = debit(
      "1111",
      {},
      {},
      { action: "skip", reason: "already-imported", sure: true },
    );
    expect(findMoves([merged, credit("2222")])).toEqual([]);
    expect(findMoves([seen, credit("2222")])).toEqual([]);
  });

  it("uses each line once, nearest in date first", () => {
    const moves = findMoves([
      debit("1111"),
      credit("2222", { date: "2026-10-09" }),
      credit("3333", { date: "2026-10-08" }),
    ]);
    expect(moves.map((move) => [move.debit, move.credit])).toEqual([[0, 2]]);
  });
});

describe("a move in the plan", () => {
  const rows: MatchedRow[] = [debit("1111").row, credit("2222").row];
  const moves = findMoves([debit("1111"), credit("2222")]);

  it("is the default for the debit of a pair, and the credit that is its other half is not written on its own", () => {
    const resolved = resolveRows(rows, new Map(), moves);
    expect(resolved[0]?.decision).toBe("move");
    expect(resolved[0]?.allowed).toEqual(["move", "create", "skip"]);
    expect(resolved[1]?.decision).toBe("skip");
    expect(resolved[1]?.allowed).toEqual(["skip"]);
    expect(resolved[1]?.partOf?.debit).toBe(0);
    const plan = planImport(rows, new Map(), new Map(), moves);
    expect(plan.writes.map((write) => write.kind)).toEqual(["move"]);
    expect(plan.counts).toMatchObject({
      create: 0,
      credit: 0,
      move: 1,
      skip: 0,
    });
    expect(plan.canCommit).toBe(true);
  });

  it("is made an expense and money in instead when the person says the pair is not a move", () => {
    const plan = planImport(
      rows,
      new Map([[0, "create" as const]]),
      new Map(),
      moves,
    );
    expect(plan.writes.map((write) => write.kind)).toEqual([
      "create",
      "credit",
    ]);
    expect(plan.counts).toMatchObject({ create: 1, credit: 1, move: 0 });
  });

  it("is left out altogether when the person leaves the debit out, and the credit goes back to what it was", () => {
    const plan = planImport(
      rows,
      new Map([[0, "skip" as const]]),
      new Map(),
      moves,
    );
    expect(plan.writes.map((write) => write.kind)).toEqual(["credit"]);
  });

  it("writes the move from the debit line, so that the line is recognised when the statement is imported again", () => {
    const plan = planImport(rows, new Map(), new Map(), moves);
    expect(plan.writes[0]).toMatchObject({
      kind: "move",
      index: 0,
      lineHash: "d".repeat(64),
      move: { fromLast4: "1111", toLast4: "2222" },
    });
  });

  it("does not offer a move for a line that is in no pair, and the choices it had are unchanged", () => {
    const alone = resolveRows([debit("1111").row], new Map(), []);
    expect(alone[0]?.allowed).toEqual(
      allowedDecisions(debit("1111").row.proposal),
    );
    expect(alone[0]?.partOf).toBeUndefined();
  });
});

describe("saying what a move is", () => {
  it("says a credit that is a move recorded already is not money in", () => {
    expect(skipWords("move-recorded", false, true)).toBe(
      "Already recorded as a move between your own accounts. Add it as money in if it is not.",
    );
  });
});
