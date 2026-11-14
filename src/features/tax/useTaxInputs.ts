/**
 * The Tax screen's typed income for a household and a tax year, as the caller may read it.
 *
 * Row-level security returns the member's own figures and whatever the caller typed, and no one else's (LI-I21), so another member's gross
 * salary is simply absent. A failed read is `failed`, and never an empty answer. `save` writes each row and reads again.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listTaxInputs, saveTaxInput } from '../../repo/taxInputs.ts';
import type { NewTaxInput, TaxInputRecord } from '../../repo/types.ts';

export type TaxInputsState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly records: readonly TaxInputRecord[] };

export function useTaxInputs(householdId: string | null, taxYear: string) {
  const [state, setState] = useState<TaxInputsState>({ status: 'loading' });
  const asked = useRef(0);

  const load = useCallback(async () => {
    if (householdId === null) return;
    const turn = ++asked.current;
    try {
      const records = await listTaxInputs(householdId, { taxYear });
      if (turn === asked.current) setState({ status: 'ready', records });
    } catch {
      if (turn === asked.current) setState({ status: 'failed' });
    }
  }, [householdId, taxYear]);

  useEffect(() => {
    setState({ status: 'loading' });
    void load();
  }, [load]);

  const save = useCallback(
    async (rows: readonly NewTaxInput[]): Promise<void> => {
      try {
        for (const row of rows) await saveTaxInput(row);
      } finally {
        // Read again whatever happened: a save that failed part-way has written some of its rows, and what is shown must be what is kept.
        await load();
      }
    },
    [load],
  );

  return { state, save };
}
