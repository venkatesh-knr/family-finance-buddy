/**
 * A household's typed gold rates, for the screens that value physical gold (docs/design/gold.md section 3).
 *
 * Read apart from the holdings: a rate that could not be read says so, and is not read as there being none, because "no rate" means
 * "not valued" and that must never be said of a failed read. Nothing here works out a figure: that is `src/domain/gold.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asDomainRates, listGoldRates } from '../../repo/gold.ts';
import type { GoldRateRow } from '../../repo/types.ts';

export function useGold(householdId: string | null, enabled: boolean) {
  const [rows, setRows] = useState<readonly GoldRateRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (householdId === null || !enabled) return;
    const mine = ++generation.current;
    try {
      const next = await listGoldRates(householdId);
      if (mine === generation.current) {
        setRows(next);
        setFailed(false);
      }
    } catch {
      if (mine === generation.current) setFailed(true);
    }
  }, [householdId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const rates = useMemo(() => (rows === null ? null : asDomainRates(rows)), [rows]);
  return { rows, rates, failed, reload: load };
}

export type GoldData = ReturnType<typeof useGold>;
