/**
 * What went into holdings in a month, and what came out of them (docs/design/spending-capture.md section 10).
 *
 * Derived from the holdings' own entries by the date on each, and from nothing else (SC-I11): not from balances, not from
 * what a holding is worth now, and never from market movement. A fund that rose ten thousand rupees is in net worth, not
 * here. Pure: the month is passed in, as are the entries.
 *
 * Money is per currency and is not converted, as everywhere else a total spans holdings. The classes of a currency add up to
 * its figure, in and out (SC-I13). They are listed with the most movement first, as the MonthMoney board draws them, and a tie
 * keeps the order the caller gives.
 *
 * What counts as put in:
 *   - a purchase lot, at its cost, all in;
 *   - a deposit's principal on the day it started (a renewal is the same money and is not counted again);
 *   - a holding with a cost on it and no purchase and no terms, at that cost on the day it was opened (the owner's call,
 *     13 November 2026: the opening date is the purchase date);
 *   - a PPF payment, on its entry date.
 * What counts as taken out:
 *   - a sale, a redemption or a maturity, at what it fetched net of the costs of selling;
 *   - a deposit or bond that paid out, on the day it did and at what it paid, which the caller works out from its terms
 *     because a deposit has no sale to record;
 *   - a PPF withdrawal.
 * What does neither, and is counted so the screen can say it left them out: a bonus issue, a split, a transfer between
 * members, a gift and an ESOP vest, none of which was money leaving the household's accounts.
 *
 * Not recorded anywhere, so not here: an NPS or EPF contribution, and a recurring deposit's instalments. A figure that
 * claimed them would be invented, so a recurring deposit (scheme `rd`) is kept out altogether, as the owner decided on
 * 13 November 2026.
 */

import type { IsoDate } from '../lib/dates.ts';
import type { Money } from '../lib/money.ts';

/** A year and a month, `2026-10`: the IST calendar month. */
export type YearMonth = string;

export interface InvestedHolding {
  readonly id: string;
  /** The instrument's kind, which is the class Holdings groups by. */
  readonly kind: string;
  /** The day the holding was opened, and the cost recorded on it: a holding with no purchase is counted at that cost on that day. */
  readonly openedOn?: IsoDate | null;
  readonly cost?: Money | null;
  /** A deposit's scheme. A recurring deposit (`rd`) is kept out of this figure. */
  readonly scheme?: string | null;
}

export interface InvestedLot {
  readonly holdingId: string;
  readonly acquiredOn: IsoDate;
  readonly cost: Money;
  readonly kind: string;
}

export interface InvestedDisposal {
  readonly holdingId: string;
  readonly disposedOn: IsoDate;
  readonly proceeds: Money;
  readonly kind: string;
}

export interface InvestedTerms {
  readonly holdingId: string;
  readonly start: IsoDate;
  readonly principal: Money;
}

/** A deposit or bond that paid out: the day, and what it paid. */
export interface InvestedPayout {
  readonly holdingId: string;
  readonly paidOn: IsoDate;
  readonly amount: Money;
}

export interface InvestedPpfEntry {
  readonly holdingId: string;
  readonly date: IsoDate;
  /** Positive is a payment in; negative is a withdrawal. */
  readonly amount: Money;
  readonly isVoided: boolean;
}

export interface InvestedInput {
  readonly month: YearMonth;
  /** Class kinds in the order they are listed. A kind not in here is filed under `other`. */
  readonly classOrder: readonly string[];
  readonly holdings: readonly InvestedHolding[];
  readonly lots: readonly InvestedLot[];
  readonly disposals: readonly InvestedDisposal[];
  readonly terms: readonly InvestedTerms[];
  readonly payouts: readonly InvestedPayout[];
  readonly ppfEntries: readonly InvestedPpfEntry[];
}

export interface InvestedClass {
  readonly kind: string;
  readonly putIn: bigint;
  readonly takenOut: bigint;
  readonly net: bigint;
  /** How many entries made the figure: what a person can open one by one. */
  readonly moves: number;
}

export interface InvestedCurrency {
  readonly currency: string;
  readonly putIn: bigint;
  readonly takenOut: bigint;
  readonly net: bigint;
  /** Only classes with something in them this month. */
  readonly classes: readonly InvestedClass[];
}

export interface Invested {
  readonly month: YearMonth;
  /** Currencies with any movement, INR first. Empty for a month with none. */
  readonly currencies: readonly InvestedCurrency[];
  /** Entries in the month that were deliberately not counted, so the screen can say there were some. */
  readonly leftOut: { readonly lots: number; readonly disposals: number };
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const TAKEN_OUT_KINDS: readonly string[] = ['sale', 'redemption', 'maturity'];
const OTHER = 'other';

export function investedInMonth(input: InvestedInput): Invested {
  if (!MONTH.test(input.month)) throw new Error(`"${input.month}" is not a month such as 2026-10.`);
  const inMonth = (date: IsoDate): boolean => date.slice(0, 7) === input.month;

  // A recurring deposit is kept out of every part of this figure.
  const outOf = new Set(input.holdings.filter((holding) => holding.scheme === 'rd').map((holding) => holding.id));
  const kindOf = new Map(input.holdings.map((holding) => [holding.id, holding.kind]));
  const classFor = (holdingId: string): string => {
    const kind = kindOf.get(holdingId);
    return kind !== undefined && input.classOrder.includes(kind) ? kind : OTHER;
  };
  // A deposit's money is its terms. Counting a lot on the same holding as well would count it twice.
  const hasTerms = new Set(input.terms.map((terms) => terms.holdingId));
  // A payout is worked out from the terms. A maturity recorded as a sale of the same holding would take it out twice.
  const hasPayout = new Set(input.payouts.map((payout) => payout.holdingId));

  const cells = new Map<string, Map<string, { putIn: bigint; takenOut: bigint; moves: number }>>();
  const add = (currency: string, kind: string, direction: 'in' | 'out', minor: bigint): void => {
    let classes = cells.get(currency);
    if (classes === undefined) cells.set(currency, (classes = new Map()));
    let cell = classes.get(kind);
    if (cell === undefined) classes.set(kind, (cell = { putIn: 0n, takenOut: 0n, moves: 0 }));
    if (direction === 'in') cell.putIn += minor;
    else cell.takenOut += minor;
    cell.moves += 1;
  };

  let lotsLeftOut = 0;
  for (const lot of input.lots) {
    if (!inMonth(lot.acquiredOn) || outOf.has(lot.holdingId)) continue;
    if (lot.kind !== 'purchase') {
      lotsLeftOut += 1;
      continue;
    }
    if (hasTerms.has(lot.holdingId)) continue;
    add(lot.cost.currency, classFor(lot.holdingId), 'in', lot.cost.minor);
  }

  let disposalsLeftOut = 0;
  for (const disposal of input.disposals) {
    if (!inMonth(disposal.disposedOn) || outOf.has(disposal.holdingId)) continue;
    if (!TAKEN_OUT_KINDS.includes(disposal.kind)) {
      disposalsLeftOut += 1;
      continue;
    }
    if (disposal.kind === 'maturity' && hasPayout.has(disposal.holdingId)) continue;
    add(disposal.proceeds.currency, classFor(disposal.holdingId), 'out', disposal.proceeds.minor);
  }

  for (const terms of input.terms) {
    if (inMonth(terms.start) && !outOf.has(terms.holdingId)) add(terms.principal.currency, classFor(terms.holdingId), 'in', terms.principal.minor);
  }

  for (const payout of input.payouts) {
    if (inMonth(payout.paidOn) && !outOf.has(payout.holdingId)) add(payout.amount.currency, classFor(payout.holdingId), 'out', payout.amount.minor);
  }

  // Opened this month with a cost on the holding and no purchase and no terms to show for it: its cost is what went in, on the day it was opened.
  const hasLot = new Set(input.lots.map((lot) => lot.holdingId));
  for (const holding of input.holdings) {
    if (outOf.has(holding.id) || hasLot.has(holding.id) || hasTerms.has(holding.id)) continue;
    if (holding.openedOn == null || !inMonth(holding.openedOn) || holding.cost == null) continue;
    add(holding.cost.currency, classFor(holding.id), 'in', holding.cost.minor);
  }

  for (const entry of input.ppfEntries) {
    if (entry.isVoided || !inMonth(entry.date)) continue;
    const kind = classFor(entry.holdingId);
    if (entry.amount.minor >= 0n) add(entry.amount.currency, kind, 'in', entry.amount.minor);
    else add(entry.amount.currency, kind, 'out', -entry.amount.minor);
  }

  const rank = (kind: string): number => {
    const at = input.classOrder.indexOf(kind);
    return at === -1 ? input.classOrder.length : at;
  };

  const currencies: InvestedCurrency[] = [...cells.entries()]
    .sort(([a], [b]) => (a === 'INR' ? -1 : b === 'INR' ? 1 : a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, classes]) => {
      const list: InvestedClass[] = [...classes.entries()]
        .sort(([a, x], [b, y]) => {
          const bigger = y.putIn + y.takenOut - (x.putIn + x.takenOut);
          return bigger === 0n ? rank(a) - rank(b) : bigger > 0n ? 1 : -1;
        })
        .map(([kind, cell]) => ({ kind, ...cell, net: cell.putIn - cell.takenOut }));
      const putIn = list.reduce((sum, c) => sum + c.putIn, 0n);
      const takenOut = list.reduce((sum, c) => sum + c.takenOut, 0n);
      return { currency, putIn, takenOut, net: putIn - takenOut, classes: list };
    });

  return { month: input.month, currencies, leftOut: { lots: lotsLeftOut, disposals: disposalsLeftOut } };
}
