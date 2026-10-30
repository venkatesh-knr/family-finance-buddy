/**
 * A household's PPF accounts, entries and the notified rate, for the holding screens that work a PPF out.
 *
 * Read only when a PPF is on screen, and apart from the holdings: a PPF that could not be read says so, and is not read as a PPF
 * with no payments in it. Nothing here works out a figure: that is `src/domain/ppf.ts`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listPpf } from '../../repo/retirement.ts';
import type { PpfListing } from '../../repo/types.ts';

export function usePpf(householdId: string | null, enabled: boolean) {
  const [ppf, setPpf] = useState<PpfListing | null>(null);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (householdId === null || !enabled) return;
    const mine = ++generation.current;
    try {
      const next = await listPpf(householdId);
      if (mine === generation.current) {
        setPpf(next);
        setFailed(false);
      }
    } catch {
      if (mine === generation.current) setFailed(true);
    }
  }, [householdId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ppf, failed, reload: load };
}
