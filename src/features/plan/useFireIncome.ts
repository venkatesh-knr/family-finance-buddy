/**
 * The income FIRE reads: the credits the caller may read, for Mine, and the household's yearly totals from the sum function, for Household.
 *
 * Mine is worked out here from the credits (`src/domain/income.ts`); Household comes from `household_yearly_income`, which an owner or a
 * partner with a second factor may ask and which returns two sums and no member or month. The two are read separately, so that one failing
 * does not hide the other. A read that failed is `failed`, and never an empty answer: FIRE must not show its number beside an income of
 * nothing because a read went wrong. A household total that the role may not ask for is `null`, which is not a failure.
 */

import { useEffect, useRef, useState } from 'react';
import type { IncomeCredit } from '../../domain/income.ts';
import { listCredits } from '../../repo/credits.ts';
import { todayInIst } from '../../repo/expenses.ts';
import { householdYearlyIncome } from '../../repo/moneyTotals.ts';
import type { YearlyIncomeTotals } from '../../repo/types.ts';

export type FireIncomeData =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | {
      readonly status: 'ready';
      readonly today: string;
      /** The credits that count as income for Mine: voided ones and refunds left out. */
      readonly credits: readonly IncomeCredit[];
      /** The household's yearly totals for each currency; null where the role may not ask; `failed` where the read went wrong. */
      readonly household: readonly YearlyIncomeTotals[] | null | 'failed';
    };

export function useFireIncome(householdId: string | null, mayAskHousehold: boolean): FireIncomeData {
  const [state, setState] = useState<FireIncomeData>({ status: 'loading' });
  const asked = useRef(0);

  useEffect(() => {
    if (householdId === null) return;
    const turn = ++asked.current;
    setState({ status: 'loading' });
    const today = todayInIst();
    void Promise.allSettled([listCredits(householdId), mayAskHousehold ? householdYearlyIncome(householdId, today) : Promise.resolve(null)]).then(
      ([credits, household]) => {
        if (turn !== asked.current) return;
        if (credits.status === 'rejected') {
          setState({ status: 'failed' });
          return;
        }
        setState({
          status: 'ready',
          today,
          credits: credits.value
            .filter((credit) => !credit.isVoided && credit.category !== 'refund')
            .map((credit) => ({ memberId: credit.memberId, category: credit.category, amountMinor: credit.amount.minor, currency: credit.amount.currency, date: credit.date })),
          household: household.status === 'rejected' ? 'failed' : household.value,
        });
      },
    );
  }, [householdId, mayAskHousehold]);

  return state;
}
