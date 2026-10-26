/**
 * The property screen's data: the listing through the repository, today in IST read once at the edge, and a reload
 * for after every write. Nothing is derived here: `propertyFacts` works every figure out from what this returns.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { istCalendarDate, type IsoDate } from '../../lib/dates.ts';
import { listProperties } from '../../repo/property.ts';
import { NoHouseholdError, type PropertyListing } from '../../repo/types.ts';

export function usePropertyData(householdId: string | null) {
  const [listing, setListing] = useState<PropertyListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [noHousehold, setNoHousehold] = useState(false);
  // Read once at the edge; every calculation takes it as an argument.
  const [today] = useState<IsoDate>(() => istCalendarDate(new Date()));

  // A stale response must not overwrite a newer one when several reloads are in flight.
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const next = await listProperties(householdId === null ? {} : { householdId });
      if (mine === generation.current) {
        setListing(next);
        setProblem(null);
        setNoHousehold(false);
      }
    } catch (error) {
      if (mine === generation.current) {
        if (error instanceof NoHouseholdError) {
          setNoHousehold(true);
          setProblem(null);
        } else {
          setProblem(error instanceof Error ? error.message : 'Could not read the property.');
        }
      }
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { listing, loading, problem, noHousehold, today, reload: load };
}
