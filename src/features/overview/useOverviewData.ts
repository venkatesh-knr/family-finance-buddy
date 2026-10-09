/**
 * What the Overview and the FIRE screen both read: the household's holdings, their readings, the
 * exchange rates, the debts, and the net worth worked out from them.
 *
 * It lived inside the Overview screen. FIRE has to show how far the household is from its target, and
 * "how far" is measured from net worth: a second calculation of it would be a second answer, and the
 * two screens would disagree by exactly what they handled differently. So it is one hook, and the
 * figure on FIRE is the figure on the Overview.
 *
 * Which holdings are in view is the caller's `scope`: the household's, or one member's own.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  allocationByKind,
  assetTotals,
  readingGaps,
  readingStaleness,
  type HoldingInput,
  type ValuationInput,
} from '../../domain/networth.ts';
import { isQualified, type History } from '../../domain/position.ts';
import { listHoldings, listPersonalHoldingTotals } from '../../repo/holdings.ts';
import {
  costForHolding,
  historyForHolding,
  unitsText,
} from '../holdings/history.ts';
import { listRates, type FxRate } from '../../repo/rates.ts';
import { listFixedIncome, listRatingChanges } from '../../repo/fixedIncome.ts';
import {
  fixedIncomeAlerts,
  paidOutHoldings,
  type FixedIncomeAlert,
} from '../holdings/fixedIncomeRows.ts';
import { listPlan } from '../../repo/planning.ts';
import { netWorth } from '../../domain/fx.ts';
import { istCalendarDate } from '../../lib/dates.ts';
import {
  NoHouseholdError,
  type HoldingListing,
  type PersonalHoldingTotal,
} from '../../repo/types.ts';

export function useOverviewData({
  householdId,
  displayCurrency,
  scope,
}: {
  householdId: string | null;
  /** Which currency to read in, or empty for the household's own. */
  displayCurrency: string;
  scope: 'household' | 'mine';
}) {
  const [listing, setListing] = useState<HoldingListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [noHousehold, setNoHousehold] = useState(false);
  const [rates, setRates] = useState<readonly FxRate[]>([]);
  const [debts, setDebts] = useState<
    readonly {
      amount: import('../../lib/money.ts').Money;
      name: string;
      /** Null is a household debt — everybody's, so it stays in a personal view too. */
      memberId: string | null;
      asOf: string;
    }[]
  >([]);
  /**
   * Open loans nobody has entered a balance for.
   *
   * Not the same as "no debts": a loan with no balance is a debt the household
   * has and the figure cannot subtract, which makes net worth high by exactly
   * what is owed. No loans at all is a different fact, and does not warn.
   */
  const [unbalancedLoans, setUnbalancedLoans] = useState<readonly { memberId: string | null }[]>([]);


  /**
   * Other members' personal holdings, as one sum each.
   *
   * The household figure is short without these — a personal holding is
   * invisible to everybody but its member, so the assets the client can add up
   * are only part of what the family owns. This is the definer function that
   * returns the sums and never the rows.
   */
  const [personalTotals, setPersonalTotals] = useState<readonly PersonalHoldingTotal[]>([]);
  const [personalTotalsFailed, setPersonalTotalsFailed] = useState(false);
  /**
   * The loans, and the exchange rates, could not be read.
   *
   * Not the same as there being none, and treated as none they say something false:
   * no loans read as "No debts are recorded", which is a net worth high by the whole
   * mortgage with a caveat telling you there is nothing to subtract; no rates read
   * as "a rate is missing, add it", offered for a rate that exists. Recorded, and said
   * on the figure, as the private holdings already are.
   */
  const [plansFailed, setPlansFailed] = useState(false);
  const [ratesFailed, setRatesFailed] = useState(false);
  // What deposits and bonds have to say: a maturity close by, a downgrade. Read apart from
  // the rest and its failure said, since a position that could not be read cannot warn.
  const [fixedIncome, setFixedIncome] = useState<{
    readonly terms: Awaited<ReturnType<typeof listFixedIncome>>['terms'];
    readonly renewals: Awaited<ReturnType<typeof listFixedIncome>>['renewals'];
    readonly ratingChanges: Awaited<ReturnType<typeof listRatingChanges>>;
  } | null>(null);
  const [fixedIncomeFailed, setFixedIncomeFailed] = useState(false);
  // The rating history, read apart from the terms: its failure says nothing about a value, and
  // must not stop a month being closed.
  const [ratingsFailed, setRatingsFailed] = useState(false);
  // Not yet read is not the same as could not be read. Close month needs to know which: it
  // works deposits and bonds out from what was read, and "nothing read yet" must not be
  // reported to somebody as a failure, nor acted on as if there were none.
  const [fixedIncomeSettled, setFixedIncomeSettled] = useState(false);

  // Read once at the edge. Every calculation below takes it as an argument.
  const [today] = useState(() => istCalendarDate(new Date()));

  const load = useCallback(async () => {
    setLoading(true);
    setFixedIncomeSettled(false);
    try {
      const next = await listHoldings({
        ...(householdId === null ? {} : { householdId }),
        includeArchived: true,
      });
      setListing(next);
      setProblem(null);
      setNoHousehold(false);

      // Rates and debts separately, and neither may take the screen down. The
      // asset figures stand on their own; these only add the conversion and
      // the subtraction on top of them.
      const [rateResult, planResult, personalResult, fixedResult, ratingResult] = await Promise.allSettled([
        listRates(next.household.id),
        listPlan({ householdId: next.household.id, fy: Number(today.slice(0, 4)) }),
        listPersonalHoldingTotals(next.household.id),
        listFixedIncome(next.household.id),
        listRatingChanges(next.household.id),
      ]);
      setRates(rateResult.status === 'fulfilled' ? rateResult.value : []);
      setRatesFailed(rateResult.status === 'rejected');
      setPlansFailed(planResult.status === 'rejected');
      setUnbalancedLoans(
        planResult.status === 'fulfilled'
          ? planResult.value.liabilities
              .filter((l) => !l.isClosed && l.outstanding === null)
              .map((l) => ({ memberId: l.memberId }))
          : [],
      );
      setDebts(
        planResult.status === 'fulfilled'
          ? planResult.value.liabilities
              .filter((l) => !l.isClosed && l.outstanding !== null)
              .map((l) => ({
                amount: l.outstanding as import('../../lib/money.ts').Money,
                name: l.name,
                memberId: l.memberId,
                asOf: l.outstandingAsOf ?? '',
              }))
          : [],
      );

      // A failure here is not an empty result, and the difference is the whole
      // point: silently treating it as "no private holdings" would show a
      // household total short by an amount nobody can see. So it is recorded
      // and said on the figure.
      setPersonalTotals(personalResult.status === 'fulfilled' ? personalResult.value : []);
      setPersonalTotalsFailed(personalResult.status === 'rejected');

      setRatingsFailed(ratingResult.status === 'rejected');
      if (fixedResult.status === 'fulfilled') {
        setFixedIncome({
          terms: fixedResult.value.terms,
          renewals: fixedResult.value.renewals,
          ratingChanges: ratingResult.status === 'fulfilled' ? ratingResult.value : [],
        });
        setFixedIncomeFailed(false);
      } else {
        setFixedIncome(null);
        setFixedIncomeFailed(true);
      }
      setFixedIncomeSettled(true);
    } catch (error) {
      if (error instanceof NoHouseholdError) setNoHousehold(true);
      else setProblem(error instanceof Error ? error.message : 'Could not load the overview.');
    } finally {
      setLoading(false);
    }
  }, [householdId, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = listing?.viewer.memberId ?? null;

  /**
   * Whether each position's purchases account for the units its statement
   * reported. Worked out once here, because the totals, the allocation and the
   * notice all need the answer and must not each derive their own.
   */
  const histories = useMemo<ReadonlyMap<string, History>>(
    () =>
      listing === null
        ? new Map()
        : new Map(listing.holdings.map((h) => [h.id, historyForHolding(listing, h)])),
    [listing],
  );

  // Deposits and bonds that have paid out are left out from the day they did: not archived and
  // nothing written, only worked out from the terms, so correcting the terms puts one back.
  const paidOut = useMemo(
    () => (fixedIncome === null ? new Map<string, string>() : paidOutHoldings(fixedIncome.terms, fixedIncome.renewals, today)),
    [fixedIncome, today],
  );

  // Archived holdings stay in this list: a reading gap or a point on the line in a
  // month before the archive is still true of that month. Each calculation below
  // leaves them out of what is held now.
  const holdings = useMemo<readonly HoldingInput[]>(
    () =>
      (listing === null ? [] : listing.holdings)
        .filter((h) => scope === 'household' || h.member.id === mine)
        .map((h) => ({
          id: h.id,
          memberId: h.member.id,
          memberName: h.member.displayName,
          kind: h.instrument.kind,
          currency: h.instrument.currency,
          // Derived from the purchases where there are any, exactly as the
          // holdings screen does. This used to read the holding's own column,
          // which an import leaves empty, so a household with imported funds
          // showed less invested here than on the screen beside it.
          cost: costForHolding(listing as HoldingListing, h),
          isArchived: h.isArchived || paidOut.has(h.id),
          openedOn: h.openedOn,
          archivedOn: h.archivedOn ?? paidOut.get(h.id) ?? null,
          costIsShort: isQualified(histories.get(h.id) ?? { kind: 'unstated' }),
        })),
    [listing, scope, mine, histories, paidOut],
  );

  /** The positions in view whose cost covers only part of their units, named. */
  const shortPositions = useMemo(
    () =>
      (listing?.holdings ?? [])
        .filter((h) => !h.isArchived && (scope === 'household' || h.member.id === mine))
        .flatMap((h) => {
          const history = histories.get(h.id);
          if (history === undefined || history.kind === 'unstated' || !isQualified(history)) return [];
          return [
            `${h.instrument.name} · ${h.member.displayName} — ${unitsText(history.lotUnits)} of ${unitsText(history.statedUnits)} units`,
          ];
        }),
    [listing, scope, mine, histories],
  );

  const valuations = useMemo<readonly ValuationInput[]>(
    () => {
      // Kept in step with the holdings above. A reading whose holding has been
      // filtered out is not a smaller number, it is a number for something not
      // on screen — and assetTotals would count it.
      const shown = new Set(holdings.map((h) => h.id));
      return (listing?.valuations ?? [])
        .filter((v) => shown.has(v.holdingId))
        .map((v) => ({
          holdingId: v.holdingId,
          date: v.date,
          amount: v.amount,
        }));
    },
    [listing, holdings],
  );

  const totals = useMemo(() => assetTotals({ holdings, valuations }), [holdings, valuations]);

  /**
   * Allocation, grouped by the currency it is an allocation within.
   *
   * Shares are meaningless across currencies without a rate, which is the same
   * reason there is no single net worth figure — so the grouping is the
   * arithmetic being honest, not a layout choice. A currency nothing has been
   * valued in is left out entirely rather than shown as an empty chart.
   */
  const allocation = useMemo(
    () =>
      totals
        .map((total) => ({
          currency: total.currency,
          rows: allocationByKind({ holdings, valuations, currency: total.currency }),
        }))
        .filter((group) => group.rows.length > 0),
    [totals, holdings, valuations],
  );
  // The peak is a foreign-asset disclosure figure (blueprint §06), so the alarm
  // that says it is a lower bound is about foreign holdings alone. A domestic
  // fund's missing month is a step in the line, and is said separately and quietly.
  const foreignIds = useMemo(
    () => new Set((listing?.holdings ?? []).filter((h) => h.instrument.isForeignAsset).map((h) => h.id)),
    [listing],
  );
  const alerts = useMemo<readonly FixedIncomeAlert[]>(
    () =>
      fixedIncome === null || listing === null
        ? []
        : fixedIncomeAlerts({
            terms: fixedIncome.terms,
            renewals: fixedIncome.renewals,
            ratingChanges: fixedIncome.ratingChanges,
            // What is in view: in Mine, only the caller's own, as for everything else here.
            visibleHoldingIds: new Set(
              listing.holdings
                .filter((h) => !h.isArchived && (scope === 'household' || h.member.id === mine))
                .map((h) => h.id),
            ),
            today,
          }),
    [fixedIncome, listing, scope, mine, today],
  );
  const maturities = alerts.filter((a) => a.kind === 'matures');
  const renewals = alerts.filter((a) => a.kind === 'renews');
  const downgrades = alerts.filter((a) => a.kind === 'downgraded');
  const ratingNotices = alerts.filter((a) => a.kind === 'rating-unclear' || a.kind === 'rating-removed');

  const gaps = useMemo(() => {
    const year = Number(today.slice(0, 4));
    const foreign = holdings.filter((h) => foreignIds.has(h.id));
    const domestic = holdings.filter((h) => !foreignIds.has(h.id));
    return {
      peak: readingGaps({ holdings: foreign, valuations, year, today }),
      line: readingGaps({ holdings: domestic, valuations, year, today }),
      neverRead: readingGaps({ holdings, valuations, year, today }).neverRead,
    };
  }, [holdings, valuations, foreignIds, today]);

  // The newest reading of what is held now, which is what "as at" can honestly
  // mean; the oldest is what the figure is partly made of. An archived fund's
  // last reading says nothing about the holdings still here.
  const staleness = useMemo(() => readingStaleness({ holdings, valuations }), [holdings, valuations]);
  const asOf = staleness.newest;

  /** "Fund · Member", for naming a holding where only its id is known. */
  const holdingName = useMemo(() => {
    const names = new Map((listing?.holdings ?? []).map((h) => [h.id, `${h.instrument.name} · ${h.member.displayName}`]));
    return (id: string): string => names.get(id) ?? 'A holding';
  }, [listing]);

  /** Holdings in view that have never been read: left out of every total. */
  const visibleUnvalued = useMemo(() => totals.reduce((sum, t) => sum + t.unvalued, 0), [totals]);

  const lastMonthEnd = useMemo(() => {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const end = new Date(Date.UTC(year, month - 1, 0));
    return end.toISOString().slice(0, 10);
  }, [today]);

  const base = listing?.household.baseCurrency ?? 'INR';
  // What this device reads in. The household's own currency until somebody
  // says otherwise, and a rate reads both ways, so USD works from the one row
  // a household records for USD to INR.
  const display = displayCurrency === '' ? base : displayCurrency;

  /**
   * Assets minus debt, in the household's own currency — or a refusal naming
   * the rates it lacks. Converted at the date of the latest reading rather
   * than today, because that is the date the figures are true on.
   */
  const shownDebts = useMemo(
    () =>
      // A debt with no member is the household's, so it belongs in both views.
      // Filtering it out of a personal one would make somebody's own figure
      // better than it is by the size of the mortgage.
      debts.filter((d) => scope === 'household' || d.memberId === null || d.memberId === mine),
    [debts, scope, mine],
  );

  const shownUnbalanced = useMemo(
    () =>
      unbalancedLoans.filter(
        (l) => scope === 'household' || l.memberId === null || l.memberId === mine,
      ).length,
    [unbalancedLoans, scope, mine],
  );

  /**
   * What the client cannot see, added back.
   *
   * Only in the household view, and only other members' — the caller's own
   * personal holdings are already rows in `holdings` above, and adding the sum
   * as well would count them twice.
   */
  const hiddenAssets = useMemo(
    () => (scope === 'household' ? personalTotals : []),
    [scope, personalTotals],
  );


  const hiddenUnvalued = useMemo(
    () => hiddenAssets.reduce((sum, entry) => sum + entry.unvalued, 0),
    [hiddenAssets],
  );

  const worth = useMemo(() => {
    return netWorth({
      // One amount per currency, already summed. Converting the totals rather
      // than each holding is the same arithmetic with fewer roundings.
      assets: [...totals.map((t) => t.value), ...hiddenAssets.map((entry) => entry.total)],
      debts: shownDebts.map((d) => d.amount),
      base: display,
      rates,
      on: asOf ?? today,
    });
  }, [totals, hiddenAssets, shownDebts, display, rates, asOf, today]);

  // What is wrong with the figure, in one list behind one mark. Five marks in a row
  // on the number were five buttons to open, and the two of them that were not
  // warnings carried the same "i" as the heading's.
  const heroWarnings: string[] = [];
  if (personalTotalsFailed && scope === 'household') {
    heroWarnings.push(
      'The private holdings of other members could not be read, so this figure may be short by whatever they are worth. It is not that there are none: the request failed. Reload before relying on this number.',
    );
  }
  if (!personalTotalsFailed && hiddenUnvalued > 0 && scope === 'household') {
    heroWarnings.push(
      `${String(hiddenUnvalued)} ${hiddenUnvalued === 1 ? 'private holding of another member has' : 'private holdings of other members have'} never been valued, so this total is short by whatever they are worth. Only they can record a value for them.`,
    );
  }
  if (visibleUnvalued > 0) {
    heroWarnings.push(
      `${String(visibleUnvalued)} ${visibleUnvalued === 1 ? 'holding has' : 'holdings have'} never been valued, so this total is short by whatever ${visibleUnvalued === 1 ? 'it is' : 'they are'} worth. Record a value on Holdings and it is counted.`,
    );
  }
  if (shownUnbalanced > 0) {
    heroWarnings.push(
      `${String(shownUnbalanced)} ${shownUnbalanced === 1 ? 'loan has' : 'loans have'} no outstanding balance recorded, so nothing is subtracted for ${shownUnbalanced === 1 ? 'it' : 'them'}. This figure is high by whatever is still owed. Record the balance on FIRE.`,
    );
  }
  if (plansFailed) {
    heroWarnings.push(
      'The loans could not be read, so nothing has been subtracted for them and this figure may be high by whatever is owed. It is not that there are none: the request failed. Reload before relying on this number.',
    );
  }

  return {
    listing,
    loading,
    problem,
    setProblem,
    noHousehold,
    rates,
    debts,
    personalTotalsFailed,
    plansFailed,
    ratesFailed,
    fixedIncome,
    fixedIncomeFailed,
    ratingsFailed,
    fixedIncomeSettled,
    today,
    load,
    mine,
    paidOut,
    holdings,
    shortPositions,
    valuations,
    totals,
    allocation,
    alerts,
    maturities,
    renewals,
    downgrades,
    ratingNotices,
    gaps,
    staleness,
    asOf,
    holdingName,
    visibleUnvalued,
    lastMonthEnd,
    base,
    display,
    shownDebts,
    shownUnbalanced,
    hiddenAssets,
    heroWarnings,
    worth,
  };
}
