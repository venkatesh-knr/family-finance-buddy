/**
 * The holdings screen's data, and the peak it is really about.
 *
 * The repository returns readings; the domain turns them into a peak and a list
 * of gaps. That split is the point — the calculation is pure and tested against
 * fixtures, and this hook only decides which year to ask about.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calendarYearPeak, type CalendarYearPeak } from '../../domain/peak.ts';
import {
  matchFifo,
  openPosition,
  realised,
  type Parcel,
  type Shortfall,
} from '../../domain/lots.ts';
import { istCalendarDate } from '../../lib/dates.ts';
import { money, type Money } from '../../lib/money.ts';
import { parseQuantity } from '../../lib/quantity.ts';
import { addHolding, listHoldings, recordValuation } from '../../repo/holdings.ts';
import { addDisposal, addLot } from '../../repo/lots.ts';
import type {
  Holding,
  HoldingListing,
  NewDisposal,
  NewHolding,
  NewLot,
  NewValuation,
} from '../../repo/types.ts';

export interface HoldingRow {
  readonly holding: Holding;
  /** Most recent reading, whenever it was taken. */
  readonly latest: { readonly date: string; readonly amountMinor: bigint } | null;
  /** The Schedule FA figure for the year in view, with its gaps. */
  readonly peak: CalendarYearPeak;
  /**
   * What the units still held cost, and where that figure came from.
   *
   * 'lots' is derived from recorded acquisitions net of recorded sales.
   * 'holding' is the single figure entered before lots existed — a weaker
   * fact, and the screen says so rather than presenting the two alike.
   */
  readonly cost: { readonly amount: Money | null; readonly source: 'lots' | 'holding' };
  /** Realised gains on this holding, or null when nothing has been sold. */
  readonly realisedGain: Money | null;
  /** Every matched parcel, newest sale first, for the detail view. */
  readonly parcels: readonly Parcel[];
  /** Sales that could not be matched. Never silently absorbed. */
  readonly shortfalls: readonly Shortfall[];
}

export function useHoldings(householdId: string | null): {
  listing: HoldingListing | null;
  rows: readonly HoldingRow[];
  year: number;
  setYear: (year: number) => void;
  today: string;
  loading: boolean;
  problem: string | null;
  add: (holding: NewHolding) => Promise<void>;
  record: (valuation: NewValuation) => Promise<void>;
  recordLot: (lot: NewLot) => Promise<void>;
  recordSale: (disposal: NewDisposal) => Promise<void>;
  /**
   * Re-read everything.
   *
   * Exposed because corrections are made through the repository directly
   * rather than through this hook — there is no useful derived state for an
   * edit to update, only the need to see the consequence, which is the whole
   * listing again.
   */
  reload: () => Promise<void>;
} {
  const [listing, setListing] = useState<HoldingListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  // The clock is read once, here at the edge, and passed down. Everything
  // below this line takes the date as an argument.
  const [today] = useState(() => istCalendarDate(new Date()));
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));

  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const next = await listHoldings(householdId === null ? {} : { householdId });
      if (mine === generation.current) {
        setListing(next);
        setProblem(null);
      }
    } catch (error) {
      if (mine === generation.current) {
        setProblem(error instanceof Error ? error.message : 'Could not load holdings.');
      }
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<readonly HoldingRow[]>(() => {
    if (listing === null) return [];

    return listing.holdings.map((holding) => {
      const mine = listing.valuations.filter((value) => value.holdingId === holding.id);

      // Sorted newest first by the query, so the first is the latest.
      const latest = mine[0];

      const currency = holding.instrument.currency;

      // The matcher takes scaled bigints; the repository hands out decimal
      // strings. Parsing happens here, at the one place arithmetic starts.
      const matched = matchFifo(
        listing.lots
          .filter((lot) => lot.holdingId === holding.id)
          .map((lot) => ({
            id: lot.id,
            instrumentId: holding.instrument.id,
            acquiredOn: lot.acquiredOn,
            quantity: parseQuantity(lot.quantity),
            cost: lot.cost,
          })),
        listing.disposals
          .filter((sale) => sale.holdingId === holding.id)
          .map((sale) => ({
            id: sale.id,
            instrumentId: holding.instrument.id,
            disposedOn: sale.disposedOn,
            quantity: parseQuantity(sale.quantity),
            proceeds: sale.proceeds,
          })),
      );

      const open = openPosition(matched);
      const hasLots = matched.open.length > 0;

      // Presence in the listing is the exact answer, not an approximation of
      // one: a lot is visible to precisely whoever can see its holding, so a
      // holding on this screen with no lots beside it genuinely has none. The
      // holding_cost_source() function says the same thing server-side, and
      // asking it per holding would be a round trip to learn what is already
      // here.
      const cost = hasLots
        ? {
            amount: money(
              open.reduce((sum, entry) => sum + entry.cost.minor, 0n),
              currency,
            ),
            source: 'lots' as const,
          }
        : { amount: holding.cost, source: 'holding' as const };

      return {
        holding,
        latest: latest === undefined ? null : { date: latest.date, amountMinor: latest.amount.minor },
        peak: calendarYearPeak({
          values: mine.map((value) => ({ date: value.date, amount: value.amount })),
          year,
          today,
          heldFrom: holding.openedOn,
        }),
        cost,
        realisedGain: realised(matched.parcels, currency),
        parcels: [...matched.parcels].reverse(),
        shortfalls: matched.shortfalls,
      };
    });
  }, [listing, year, today]);

  const add = useCallback(
    async (holding: NewHolding) => {
      await addHolding(holding);
      await load();
    },
    [load],
  );

  const record = useCallback(
    async (valuation: NewValuation) => {
      await recordValuation(valuation);
      await load();
    },
    [load],
  );

  const recordLot = useCallback(
    async (lot: NewLot) => {
      await addLot(lot);
      await load();
    },
    [load],
  );

  const recordSale = useCallback(
    async (disposal: NewDisposal) => {
      await addDisposal(disposal);
      await load();
    },
    [load],
  );

  return {
    listing,
    rows,
    year,
    setYear,
    today,
    loading,
    problem,
    add,
    record,
    recordLot,
    recordSale,
    reload: load,
  };
}
