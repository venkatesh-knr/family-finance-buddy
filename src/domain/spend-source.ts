/**
 * Where a month's spent comes from (docs/design/spending-capture.md section 11; SC-I15 to SC-I18).
 *
 * A month's spent has three possible sources, and the first available wins: the balances at a close (section 2), a **stated spend** (a person's figure for the month,
 * section 11.1) and the sum of what was itemised. The three are never added, averaged or blended, and the source is always named, so that a figure is never
 * read as more certain than it is. Pure: amounts are integer minor units of one currency, passed in; nothing here reads a database or a clock.
 */

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
 * The source of each month of the window months of cover is averaged over (section 11.4): *stated* where the month has a statement, whose figure the average
 * then takes as stated, and *itemised* for every other. A month closed from balances is not told apart here: months of cover is averaged over what was itemised,
 * and says so, rather than naming a source it does not use.
 */
export function coverSources(window: readonly string[], statedMonths: ReadonlySet<string>): readonly SpendSource[] {
  return window.map((month) => (statedMonths.has(month) ? 'stated' : 'itemised'));
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
