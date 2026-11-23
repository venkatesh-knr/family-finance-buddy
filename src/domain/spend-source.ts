/**
 * Where a month's spent comes from (docs/design/spending-capture.md section 11; SC-I15 to SC-I18).
 *
 * A month's spent has three possible sources, and the first available wins: the balances at a close (section 2), a **stated spend** (a person's figure for the month,
 * section 11.1) and the sum of what was itemised. The three are never added, averaged or blended, and the source is always named, so that a figure is never
 * read as more certain than it is. Pure: amounts are integer minor units of one currency, passed in; nothing here reads a database or a clock.
 */

import type { Money } from '../lib/money.ts';

export type SpendSource = 'balances' | 'stated' | 'itemised';

export interface SpendInput {
  /** Spent from the balances at a close, or null when the month has no close. */
  readonly closed: bigint | null;
  /** The household's stated spend for the month, or null when there is none. */
  readonly stated: bigint | null;
  /** The sum of what was itemised, which is never negative. */
  readonly itemised: bigint;
}

export interface MonthSpend {
  readonly source: SpendSource;
  readonly spent: bigint;
  /** What was itemised, always: it is the breakdown, whichever source the figure has (SC-I2). */
  readonly itemised: bigint;
  /** For a stated month, stated less itemised. Null for any other, and null when more is itemised than stated (see `itemisedOverBy`). */
  readonly notYetItemised: bigint | null;
  /** For a stated month in which more is itemised than stated, by how much. Neither figure is changed (SC-I16). */
  readonly itemisedOverBy: bigint | null;
  /** For a month closed from balances that also has a stated spend: both, and the balances' less the stated. Never changes `spent` (SC-I17). */
  readonly crossCheck: { readonly stated: bigint; readonly fromBalances: bigint; readonly difference: bigint } | null;
}

export function monthSpend(input: SpendInput): MonthSpend {
  const { closed, stated, itemised } = input;
  if (closed !== null) {
    return {
      source: 'balances',
      spent: closed,
      itemised,
      notYetItemised: null,
      itemisedOverBy: null,
      crossCheck: stated === null ? null : { stated, fromBalances: closed, difference: closed - stated },
    };
  }
  if (stated !== null) {
    return {
      source: 'stated',
      spent: stated,
      itemised,
      notYetItemised: itemised <= stated ? stated - itemised : null,
      itemisedOverBy: itemised > stated ? itemised - stated : null,
      crossCheck: null,
    };
  }
  return { source: 'itemised', spent: itemised, itemised, notYetItemised: null, itemisedOverBy: null, crossCheck: null };
}

/** The total a person means by "and this much more": what is itemised so far plus the rest (section 11.3). */
export function restToTotal(itemised: bigint, rest: bigint): bigint {
  return itemised + rest;
}

/** The rest that a total leaves to itemise, or null when the total is below what is itemised: there is nothing to add, and it is not an error. */
export function totalToRest(total: bigint, itemised: bigint): bigint | null {
  return total >= itemised ? total - itemised : null;
}

export interface MonthSaved {
  readonly saved: bigint;
  /** Where it comes from, in words that are always shown beside it. */
  readonly label: 'from balances' | 'rough' | 'from what you entered';
  /** Whether saved can be split into invested, paid to loans and the change in the cash reserve (SC-I12). Only a close from balances proves it (SC-I18). */
  readonly splitProven: boolean;
}

/** Saved is came in less spent, labelled by where spent came from. */
export function savedFor(cameIn: bigint, spend: MonthSpend): MonthSaved {
  const saved = cameIn - spend.spent;
  switch (spend.source) {
    case 'balances':
      return { saved, label: 'from balances', splitProven: true };
    case 'stated':
      return { saved, label: 'rough', splitProven: false };
    case 'itemised':
      return { saved, label: 'from what you entered', splitProven: false };
  }
}

/** How many of some months come from each source, for the caveat on months of cover (section 11.4). */
export function countBySource(sources: readonly SpendSource[]): Record<SpendSource, number> {
  const counts: Record<SpendSource, number> = { balances: 0, stated: 0, itemised: 0 };
  for (const source of sources) counts[source] += 1;
  return counts;
}

/**
 * The statements months of cover may use: those of months that were not closed from balances. Balances beat a statement (SC-I17), so a closed month is never
 * averaged at its stated figure; the balances' figure is what it is averaged at, for an owner or a partner who can read the close, and itemised for anyone else.
 */
export function statementsForCover<T extends { readonly month: string }>(statements: readonly T[], closedMonths: ReadonlySet<string>): readonly T[] {
  return statements.filter((statement) => !closedMonths.has(statement.month));
}

/**
 * The source of each month of the window months of cover is averaged over (section 11.4; the owner, 23 November 2026): *balances* where the month was closed from them, which beat a
 * statement (SC-I17), *stated* where it has a statement, and *itemised* for every other.
 */
export function coverSources(window: readonly string[], statedMonths: ReadonlySet<string>, closedMonths: ReadonlySet<string> = new Set()): readonly SpendSource[] {
  return window.map((month) => (closedMonths.has(month) ? 'balances' : statedMonths.has(month) ? 'stated' : 'itemised'));
}

/**
 * What one month contributes to months of cover, each currency from its best source on its own: the close's spent where the close covers that currency, else a stated spend, else what was
 * itemised there. The three are never added or blended (SC-I15), and a currency only a lower source has is still counted, so it is not lost. Amounts are in their own currencies; the caller
 * converts and adds them.
 */
export function coverAmounts(input: {
  readonly closed: readonly Money[] | null;
  readonly stated: readonly Money[];
  readonly itemised: readonly Money[];
}): Money[] {
  const closedIn = new Set((input.closed ?? []).map((amount) => amount.currency));
  const statedIn = new Set(input.stated.filter((amount) => !closedIn.has(amount.currency)).map((amount) => amount.currency));
  return [
    ...(input.closed ?? []),
    ...input.stated.filter((amount) => !closedIn.has(amount.currency)),
    ...input.itemised.filter((amount) => !closedIn.has(amount.currency) && !statedIn.has(amount.currency)),
  ];
}

/** The words under months of cover that say how its months were made, and why the itemised ones matter; null when there are no months to say. */
export function coverCaveat(counts: Record<SpendSource, number>): { readonly counts: string; readonly reading: string | null } | null {
  const total = counts.balances + counts.stated + counts.itemised;
  if (total === 0) return null;
  const parts: string[] = [];
  if (counts.balances > 0) parts.push(`${String(counts.balances)} from balances`);
  if (counts.stated > 0) parts.push(`${String(counts.stated)} stated`);
  if (counts.itemised > 0) parts.push(`${String(counts.itemised)} itemised`);
  return {
    counts: `Of the ${String(total)} ${total === 1 ? 'month' : 'months'}: ${parts.join(', ')}.`,
    reading: counts.itemised > 0 ? 'Itemised months read low, which makes the cover read high.' : null,
  };
}
