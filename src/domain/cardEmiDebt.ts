import type { IsoDate } from '../lib/dates.ts';

/**
 * A card's EMI plans as one debt (docs/design/card-cycles.md 4a; CY-I17). Its outstanding is never typed: after each statement it is what it was before, plus what the statement converted
 * to EMI plans, less the principal of the instalments it billed. Pure: the card's statements are passed in, and nothing here reads a database or a clock.
 */

/** What one of a card's dues records of its EMI plans: what the cycle converted, and the principal of the instalments it billed. */
export interface EmiFigures {
  readonly asAt: IsoDate;
  readonly converted: bigint;
  readonly principal: bigint;
}

/**
 * What is owed on a card's EMI plans, as at the card's latest statement: the figures in date order, so statements recorded out of order give the same answer. It never goes below nothing:
 * principal billed on a plan the card never stated as converted has nothing here to repay, and a later conversion starts from nothing.
 */
export function cardEmiOutstanding(rows: readonly EmiFigures[]): { readonly outstanding: bigint; readonly asOf: IsoDate | null; readonly unmatched: boolean } {
  const inOrder = [...rows].sort((a, b) => (a.asAt < b.asAt ? -1 : a.asAt > b.asAt ? 1 : 0));
  let outstanding = 0n;
  // Principal billed beyond everything converted so far belongs to a plan the card's statements never showed converted. It cannot be told apart from a plan converted later, so the
  // figure is then a lower bound, and is said to be (a start figure is not built).
  let unmatched = false;
  for (const each of inOrder) {
    outstanding += each.converted - each.principal;
    if (outstanding < 0n) {
      outstanding = 0n;
      unmatched = true;
    }
  }
  return { outstanding, asOf: inOrder.length === 0 ? null : (inOrder[inOrder.length - 1]?.asAt ?? null), unmatched };
}

/** What is written to a card's debt, or null when nothing is to be. */
export interface CardEmiDebtWrite {
  /** The debt does not exist yet and is made, linked to the card. */
  readonly create: boolean;
  readonly outstanding: bigint;
  readonly asOf: IsoDate;
  /** Nothing is owed: the debt is closed, as at `asOf`, the statement that took it there. It reopens by itself when the card converts again. */
  readonly closed: boolean;
  /** Whether it is closed or opened by this write, as against staying as it is: the day it was closed is the statement that took it to nothing, and a later statement does not move it. */
  readonly changesStatus: boolean;
}

/**
 * Whether a card's debt is made or changed after its statements change. `rows` are the card's dues the close reads; `debt` is the card's linked debt as stored, or null when it has none; `add`
 * is whether the person ticked adding it, which matters only while there is none. A card that has converted nothing never gets one, and a debt that already says what its statements say is not
 * written again.
 */
export function planCardEmiDebt(input: {
  readonly rows: readonly EmiFigures[];
  readonly debt: { readonly outstanding: bigint | null; readonly asOf: IsoDate | null; readonly isClosed: boolean } | null;
  readonly add: boolean;
}): CardEmiDebtWrite | null {
  const { outstanding, asOf } = cardEmiOutstanding(input.rows);
  if (asOf === null) return null;
  if (input.debt === null) {
    const converted = input.rows.some((each) => each.converted > 0n);
    return input.add && converted ? { create: true, outstanding, asOf, closed: outstanding === 0n, changesStatus: true } : null;
  }
  const closed = outstanding === 0n;
  const same = input.debt.outstanding === outstanding && input.debt.asOf === asOf && input.debt.isClosed === closed;
  return same ? null : { create: false, outstanding, asOf, closed, changesStatus: input.debt.isClosed !== closed };
}
