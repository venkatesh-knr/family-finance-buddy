/**
 * The holdings screen's data, and the peak it is really about.
 *
 * The repository returns readings; the domain turns them into a peak and a list
 * of gaps. That split is the point — the calculation is pure and tested against
 * fixtures, and this hook only decides which year to ask about.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calendarYearPeak, type CalendarYearPeak } from '../../domain/peak.ts';
import { istCalendarDate } from '../../lib/dates.ts';
import { addHolding, listHoldings, recordValuation } from '../../repo/holdings.ts';
import type { Holding, HoldingListing, NewHolding, NewValuation } from '../../repo/types.ts';

export interface HoldingRow {
  readonly holding: Holding;
  /** Most recent reading, whenever it was taken. */
  readonly latest: { readonly date: string; readonly amountMinor: bigint } | null;
  /** The Schedule FA figure for the year in view, with its gaps. */
  readonly peak: CalendarYearPeak;
}

export function useHoldings(): {
  listing: HoldingListing | null;
  rows: readonly HoldingRow[];
  year: number;
  setYear: (year: number) => void;
  today: string;
  loading: boolean;
  problem: string | null;
  add: (holding: NewHolding) => Promise<void>;
  record: (valuation: NewValuation) => Promise<void>;
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
      const next = await listHoldings();
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<readonly HoldingRow[]>(() => {
    if (listing === null) return [];

    return listing.holdings.map((holding) => {
      const mine = listing.valuations.filter((value) => value.holdingId === holding.id);

      // Sorted newest first by the query, so the first is the latest.
      const latest = mine[0];

      return {
        holding,
        latest: latest === undefined ? null : { date: latest.date, amountMinor: latest.amount.minor },
        peak: calendarYearPeak({
          values: mine.map((value) => ({ date: value.date, amount: value.amount })),
          year,
          today,
          heldFrom: holding.openedOn,
        }),
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

  return { listing, rows, year, setYear, today, loading, problem, add, record };
}
