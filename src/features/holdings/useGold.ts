/**
 * A household's gold schemes and their instalments, for the screens that work a scheme out.
 *
 * Read apart from the holdings: a scheme that could not be read says so, and is not read as a scheme with nothing paid. Nothing here
 * works out a figure: that is `src/domain/gold.ts`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listGold } from '../../repo/gold.ts';
import type { GoldListing } from '../../repo/types.ts';

export function useGold(householdId: string | null, enabled: boolean) {
  const [gold, setGold] = useState<GoldListing | null>(null);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (householdId === null || !enabled) return;
    const mine = ++generation.current;
    try {
      const next = await listGold(householdId);
      if (mine === generation.current) {
        setGold(next);
        setFailed(false);
      }
    } catch {
      if (mine === generation.current) setFailed(true);
    }
  }, [householdId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { gold, failed, reload: load };
}

export type GoldData = ReturnType<typeof useGold>;
