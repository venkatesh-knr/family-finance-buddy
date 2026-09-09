/**
 * Where a capital gain comes from.
 *
 * "Capital gains are derived from lots. Never store a gain." A stored gain is
 * a number that was true once: it does not change when a forgotten purchase is
 * entered, when a cost is corrected, or when the rule it was computed under is
 * amended for a prior year. Derived, all three fix themselves.
 *
 * A *lot* is one acquisition — what was bought, when, and what it cost. A
 * *disposal* is one sale. Neither says anything about gain. This module walks
 * the sales against the purchases and produces *parcels*: the units of a single
 * sale that came from a single purchase, each with its own acquisition date,
 * its own cost and its own holding period. A sale of fifteen units drawn from
 * two purchases is two parcels, and it has to be, because those parcels can
 * fall on opposite sides of a holding-period rule.
 *
 * ── first in, first out ──────────────────────────────────────────────────
 *
 * Not a preference, and not a setting. For shares held in demat form and for
 * mutual fund units, the Income Tax Act prescribes FIFO; there is no
 * average-cost or specific-identification option for a resident Indian
 * taxpayer to choose between. So there is one matcher and no way to configure
 * it into being wrong.
 *
 * ── what this module refuses to decide ───────────────────────────────────
 *
 * Whether a parcel is long-term or short-term. That threshold is twelve months
 * for listed equity, twenty-four for unlisted, and it has moved more than once;
 * "tax rules — slabs, rates, thresholds, holding periods — are dated rows in
 * `tax_rule`, not constants in code", and a prior year must recompute on the
 * rule that applied then. A `heldDays` count is arithmetic and belongs here. A
 * threshold is policy and does not.
 *
 * Likewise grandfathering, indexation and set-off: all rules, all elsewhere.
 * This module answers one question — which units, bought when, at what cost,
 * were sold for how much.
 *
 * ── and what it refuses to guess ─────────────────────────────────────────
 *
 * A sale it cannot cover comes back as a shortfall, never as a parcel with a
 * zero cost. A zero-cost parcel is a hundred-percent gain, and printing one
 * because a purchase has not been entered yet would put a fictitious tax bill
 * in front of somebody. Same instinct as `netWorth` refusing a total it cannot
 * convert honestly: the missing piece is named and handed back.
 */

import { daysBetween, type IsoDate } from '../lib/dates.ts';
import { money, type CurrencyCode, type Money } from '../lib/money.ts';

/** One acquisition. Quantity is scaled by `QUANTITY_SCALE`, cost is minor units. */
export interface Lot {
  readonly id: string;
  readonly instrumentId: string;
  readonly acquiredOn: IsoDate;
  readonly quantity: bigint;
  readonly cost: Money;
}

/** One sale. */
export interface Disposal {
  readonly id: string;
  readonly instrumentId: string;
  readonly disposedOn: IsoDate;
  readonly quantity: bigint;
  readonly proceeds: Money;
}

/** Units of one sale that came from one purchase, with the gain that implies. */
export interface Parcel {
  readonly lotId: string;
  readonly disposalId: string;
  readonly instrumentId: string;
  readonly acquiredOn: IsoDate;
  readonly disposedOn: IsoDate;
  readonly quantity: bigint;
  readonly cost: Money;
  readonly proceeds: Money;
  /** Proceeds minus cost. Negative is a loss; a loss is a gain with a sign. */
  readonly gain: Money;
  /** Days held. What that means is `tax_rule`'s business, not this module's. */
  readonly heldDays: number;
}

export interface Shortfall {
  readonly disposalId: string;
  readonly instrumentId: string;
  /** The part of the sale nothing could be matched against. */
  readonly quantity: bigint;
  readonly reason: 'no-lots' | 'currency-mismatch';
}

/** What is left of a purchase after the sales have taken their share. */
export interface OpenLot {
  readonly lotId: string;
  readonly instrumentId: string;
  readonly acquiredOn: IsoDate;
  readonly quantity: bigint;
  readonly cost: Money;
}

export interface FifoResult {
  readonly parcels: readonly Parcel[];
  readonly shortfalls: readonly Shortfall[];
  /** Every lot with what remains of it — including the ones down to nothing. */
  readonly open: readonly OpenLot[];
}

/**
 * `total × part ÷ whole`, rounded half away from zero, entirely in bigint.
 *
 * Half away from zero rather than half to even, so a half-paise never rounds
 * consistently in the house's favour across a portfolio.
 */
function proportion(total: bigint, part: bigint, whole: bigint): bigint {
  if (whole === 0n) return 0n;
  const doubled = total * part * 2n;
  const quotient = doubled / whole;
  return quotient >= 0n ? (quotient + 1n) / 2n : (quotient - 1n) / 2n;
}

interface Remaining {
  readonly lot: Lot;
  quantity: bigint;
  /**
   * Cost still attached to the unsold part.
   *
   * Tracked rather than recomputed. When a lot is consumed in pieces, each
   * piece takes a rounded share and the last one takes whatever is left, so
   * the pieces sum to the lot's cost exactly. Recomputing each share from the
   * original figure would let three thirds of ₹100.01 come to ₹100.02.
   */
  cost: bigint;
}

export function matchFifo(
  lots: readonly Lot[],
  disposals: readonly Disposal[],
): FifoResult {
  // Oldest first, and by id where a day holds two purchases — an arbitrary but
  // stable order beats one that depends on how the rows came back.
  const remaining: Remaining[] = [...lots]
    .sort((a, b) => (a.acquiredOn === b.acquiredOn ? cmp(a.id, b.id) : cmp(a.acquiredOn, b.acquiredOn)))
    .map((lot) => ({ lot, quantity: lot.quantity, cost: lot.cost.minor }));

  const ordered = [...disposals].sort((a, b) =>
    a.disposedOn === b.disposedOn ? cmp(a.id, b.id) : cmp(a.disposedOn, b.disposedOn),
  );

  const parcels: Parcel[] = [];
  const shortfalls: Shortfall[] = [];

  for (const disposal of ordered) {
    let unmatched = disposal.quantity;
    let proceedsLeft = disposal.proceeds.minor;
    let reason: Shortfall['reason'] = 'no-lots';

    while (unmatched > 0n) {
      const next = remaining.find(
        (candidate) =>
          candidate.quantity > 0n &&
          candidate.lot.instrumentId === disposal.instrumentId &&
          // A purchase made after the sale cannot have funded it. Matching one
          // reads as a tidy gain instead of the data-entry error it is.
          candidate.lot.acquiredOn <= disposal.disposedOn,
      );

      if (next === undefined) break;

      // Netting a dollar cost against a rupee sale would produce a number in
      // neither currency. Conversion is a decision with a date and a rate
      // attached, and it is not this module's to make silently.
      if (next.lot.cost.currency !== disposal.proceeds.currency) {
        reason = 'currency-mismatch';
        break;
      }

      const take = unmatched < next.quantity ? unmatched : next.quantity;

      // The piece that empties the lot takes the residue; every earlier piece
      // takes its rounded share. That is what makes the parts sum to the whole.
      const cost = take === next.quantity ? next.cost : proportion(next.cost, take, next.quantity);
      const proceeds =
        take === unmatched ? proceedsLeft : proportion(proceedsLeft, take, unmatched);

      parcels.push({
        lotId: next.lot.id,
        disposalId: disposal.id,
        instrumentId: disposal.instrumentId,
        acquiredOn: next.lot.acquiredOn,
        disposedOn: disposal.disposedOn,
        quantity: take,
        cost: money(cost, disposal.proceeds.currency),
        proceeds: money(proceeds, disposal.proceeds.currency),
        gain: money(proceeds - cost, disposal.proceeds.currency),
        heldDays: daysBetween(next.lot.acquiredOn, disposal.disposedOn),
      });

      next.quantity -= take;
      next.cost -= cost;
      unmatched -= take;
      proceedsLeft -= proceeds;
    }

    if (unmatched > 0n) {
      shortfalls.push({
        disposalId: disposal.id,
        instrumentId: disposal.instrumentId,
        quantity: unmatched,
        reason,
      });
    }
  }

  return {
    parcels,
    shortfalls,
    open: remaining.map((entry) => ({
      lotId: entry.lot.id,
      instrumentId: entry.lot.instrumentId,
      acquiredOn: entry.lot.acquiredOn,
      quantity: entry.quantity,
      cost: money(entry.cost, entry.lot.cost.currency),
    })),
  };
}

/**
 * What is still held, cost attached.
 *
 * Lots sold down to nothing are dropped rather than listed at zero: a holding
 * of "0 units, ₹0" is not a position, and showing one puts a closed purchase
 * back on a screen that is meant to say what you own. This is also the figure
 * that replaces `holding.cost_minor` — the same "what it cost" question, asked
 * of the units actually still there.
 */
export function openPosition(result: FifoResult): readonly OpenLot[] {
  return result.open.filter((entry) => entry.quantity > 0n);
}

/**
 * Gains realised in one currency, or null.
 *
 * Null rather than zero when there is nothing, because zero realised gain is a
 * statement — "you sold things and came out level" — and the app should not
 * make it on the strength of having no data. Never sums across currencies:
 * that would need a rate, and a rate needs a date.
 */
export function realised(parcels: readonly Parcel[], currency: CurrencyCode): Money | null {
  const mine = parcels.filter((parcel) => parcel.gain.currency === currency);
  if (mine.length === 0) return null;
  return money(
    mine.reduce((sum, parcel) => sum + parcel.gain.minor, 0n),
    currency,
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
