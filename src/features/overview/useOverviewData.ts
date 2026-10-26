/**
 * What the Overview and the FIRE screen both read: the household's holdings, their readings, the
 * exchange rates, the debts, and the net worth worked out from them.
 *
 * It lived inside the Overview screen. FIRE has to show how far the household is from its target, and
 * that is measured from the corpus, which is the net worth less what is earmarked for something other
 * than retirement, and less a home the family lives in, with the loan linked to it. Both are worked out here from the same
 * holdings, readings, rates and debts, so the two screens differ by those and by nothing else.
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
import {
  EXCLUDED_FROM_FIRE,
  earmarkedHoldings,
  fireCorpus,
  type CorpusHolding,
  type ExcludedEarmark,
} from '../../domain/earmark.ts';
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
import { listProperties } from '../../repo/property.ts';
import { debtAtShare, propertyAssets, splitForCorpus, type PropertyAssets } from './propertyAssets.ts';
import { unvaluedPhrase } from './unvaluedPhrase.ts';
import { netWorth, type NetWorth } from '../../domain/fx.ts';
import { istCalendarDate } from '../../lib/dates.ts';
import {
  NoHouseholdError,
  type HoldingListing,
  type PersonalHoldingTotal,
  type PlanListing,
  type PropertyListing,
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
      /** Which loan, so one linked to a property can be taken at the property's share. */
      loanId: string;
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
  /** The plan the household's loans and policies come from, kept whole for the protection line. */
  const [planListing, setPlanListing] = useState<PlanListing | null>(null);
  const [ratesFailed, setRatesFailed] = useState(false);
  /**
   * The property, with its valuations: assets of the household like any other, at the household's share. Archived ones
   * too, since a month before one was archived is still true of that month. Not read is not the same as none, and is said.
   */
  const [propertyListing, setPropertyListing] = useState<PropertyListing | null>(null);
  const [propertyFailed, setPropertyFailed] = useState(false);
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
      // Rates and debts separately, and neither may take the screen down. The
      // asset figures stand on their own; these only add the conversion and
      // the subtraction on top of them.
      const [rateResult, planResult, personalResult, fixedResult, ratingResult, propertyResult] = await Promise.allSettled([
        listRates(next.household.id),
        listPlan({ householdId: next.household.id, fy: Number(today.slice(0, 4)) }),
        listPersonalHoldingTotals(next.household.id),
        listFixedIncome(next.household.id),
        listRatingChanges(next.household.id),
        listProperties({ householdId: next.household.id, includeArchived: true }),
      ]);
      setPropertyListing(propertyResult.status === 'fulfilled' ? propertyResult.value : null);
      setPropertyFailed(propertyResult.status === 'rejected');
      setRates(rateResult.status === 'fulfilled' ? rateResult.value : []);
      setRatesFailed(rateResult.status === 'rejected');
      setPlansFailed(planResult.status === 'rejected');
      setPlanListing(planResult.status === 'fulfilled' ? planResult.value : null);
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
                loanId: l.id,
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
      // The holdings go on screen last, with everything they are worked out against. They used to go first,
      // and until the rates arrived the net worth was refused for want of a rate that had only not been
      // read yet. All of this runs after the last await, so it is one render: nothing is drawn from the
      // holdings alone, and a reload swaps old figures for new ones without passing through that state.
      setListing(next);
      setProblem(null);
      setNoHousehold(false);
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
  const fundHoldings = useMemo<readonly HoldingInput[]>(
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

  const fundValuations = useMemo<readonly ValuationInput[]>(
    () => {
      // Kept in step with the holdings above. A reading whose holding has been
      // filtered out is not a smaller number, it is a number for something not
      // on screen — and assetTotals would count it.
      const shown = new Set(fundHoldings.map((h) => h.id));
      return (listing?.valuations ?? [])
        .filter((v) => shown.has(v.holdingId))
        .map((v) => ({
          holdingId: v.holdingId,
          date: v.date,
          amount: v.amount,
        }));
    },
    [listing, fundHoldings],
  );

  /**
   * Property, as holdings of the kind `property` with its valuations as the readings, at the household's share. Net worth,
   * the allocation and the history read `holdings` and `valuations` below, which have it; the reading gaps, the
   * staleness of readings and the FIRE corpus read the funds alone. A property is valued when somebody values it and
   * how old that is has its own rule (the household's months, on the Property screen); and an owned home is not in
   * the corpus (docs/decisions.md).
   */
  const property = useMemo<PropertyAssets>(
    () =>
      propertyListing === null
        ? {
            holdings: [],
            valuations: [],
            names: new Map(),
            loanShares: new Map(),
            linkedLoanIds: new Set(),
            livedIn: new Set(),
            livedInLoanIds: new Set(),
            unvaluedForCorpus: 0,
            unvalued: 0,
            unvaluedByCurrency: new Map(),
            stale: [],
            newestValuation: null,
          }
        : propertyAssets(propertyListing, { scope, mine }, today),
    [propertyListing, scope, mine, today],
  );
  const holdings = useMemo<readonly HoldingInput[]>(() => [...fundHoldings, ...property.holdings], [fundHoldings, property]);
  const valuations = useMemo<readonly ValuationInput[]>(
    () => [...fundValuations, ...property.valuations],
    [fundValuations, property],
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
    const foreign = fundHoldings.filter((h) => foreignIds.has(h.id));
    const domestic = fundHoldings.filter((h) => !foreignIds.has(h.id));
    return {
      peak: readingGaps({ holdings: foreign, valuations: fundValuations, year, today }),
      line: readingGaps({ holdings: domestic, valuations: fundValuations, year, today }),
      neverRead: readingGaps({ holdings: fundHoldings, valuations: fundValuations, year, today }).neverRead,
    };
  }, [fundHoldings, fundValuations, foreignIds, today]);

  // The newest reading of what is held now, which is what "as at" can honestly
  // mean; the oldest is what the figure is partly made of. An archived fund's
  // last reading says nothing about the holdings still here.
  const staleness = useMemo(
    () => readingStaleness({ holdings: fundHoldings, valuations: fundValuations }),
    [fundHoldings, fundValuations],
  );
  // The day the figures are as at: the newest reading of what is held, a property's newest valuation included. Taken from the
  // funds alone, a valuation recorded after their last reading was counted in a total labelled with an earlier day, and
  // the history, which asks every holding for a reading on that day, withdrew itself over a property that had been valued.
  const asOf = useMemo(
    () => [staleness.newest, property.newestValuation].filter((day): day is string => day !== null).sort().pop() ?? null,
    [staleness.newest, property.newestValuation],
  );

  /** "Fund · Member", for naming a holding where only its id is known. */
  const holdingName = useMemo(() => {
    const names = new Map((listing?.holdings ?? []).map((h) => [h.id, `${h.instrument.name} · ${h.member.displayName}`]));
    return (id: string): string => names.get(id) ?? property.names.get(id) ?? 'A holding';
  }, [listing, property]);

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
      debts
        .filter((d) => scope === 'household' || d.memberId === null || d.memberId === mine)
        // A loan linked to a part-owned property is the household's at that property's share: half of a property carries
        // half of what is owed on it (docs/decisions.md, Property). The name says so, so the row is not read as the
        // bank's balance.
        .map((d) => {
          const share = property.loanShares.get(d.loanId);
          return share === undefined || share === '100'
            ? d
            : { ...d, amount: debtAtShare(d.amount, d.loanId, property.loanShares), name: `${d.name} · ${share}% share` };
        }),
    [debts, scope, mine, property],
  );

  /**
   * The debts the FIRE corpus subtracts: without a loan linked to a home the family lives in, since that home is not in the
   * corpus. A home is not money that can be spent in retirement, and its loan is not subtracted from money that was never
   * counted. A property that is not lived in is in the corpus, and its loan is subtracted with it (docs/decisions.md, Property).
   */
  const corpusDebts = useMemo(
    () => shownDebts.filter((d) => !property.livedInLoanIds.has(d.loanId)),
    [shownDebts, property],
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

  /**
   * The FIRE corpus, which is not the net worth (docs/design/protection-and-flow.md §3).
   *
   * The same holdings, readings, rates and debts as `worth`, with the holdings earmarked emergency, child
   * or house taken out, because spending the emergency fund is its purpose, the child's savings are
   * locked and hers, and a house deposit is already committed. `worth` is unchanged: that is what the
   * household owns, and the Overview's hero says so.
   *
   * Other members' private holdings arrive only as one sum per member, so their earmarks cannot be
   * applied and they count in full. `privateMembers` says how many members that is, so the screen can
   * say the corpus may be overstated by them rather than leave it as a surprise.
   */
  // The holdings that carry a policy's surrender value: counted in the corpus, not available in an emergency (PF-C17).
  const carriers = useMemo(
    () => new Set((planListing?.policies ?? []).flatMap((p) => (p.linkedHoldingId === null ? [] : [p.linkedHoldingId]))),
    [planListing],
  );
  const corpusHoldings = useMemo<readonly CorpusHolding[]>(
    () =>
      (listing === null ? [] : listing.holdings)
        .filter((h) => scope === 'household' || h.member.id === mine)
        .map((h) => ({
          id: h.id,
          currency: h.instrument.currency,
          earmark: h.earmark,
          scheme: h.instrument.scheme,
          carriesPolicy: carriers.has(h.id),
          isArchived: h.isArchived || paidOut.has(h.id),
        })),
    [listing, scope, mine, paidOut, carriers],
  );

  const fire = useMemo(() => {
    const corpusTotals = fireCorpus({ holdings: corpusHoldings, valuations: fundValuations });
    const earmarked = earmarkedHoldings({ holdings: corpusHoldings, valuations: fundValuations });
    const on = asOf ?? today;
    // Property that is not lived in is an asset like any other and is in the corpus, at the household's share.
    const split = splitForCorpus(property);
    const corpusProperty = assetTotals(split.counted).map((t) => t.value);
    const corpus: NetWorth = netWorth({
      assets: [...corpusTotals.map((t) => t.included), ...corpusProperty, ...hiddenAssets.map((entry) => entry.total)],
      debts: corpusDebts.map((d) => d.amount),
      base: display,
      rates,
      on,
    });
    const excluded = EXCLUDED_FROM_FIRE.map((earmark: ExcludedEarmark) => ({
      earmark,
      amount: netWorth({
        assets: corpusTotals.map((t) => t.excluded[earmark]),
        debts: [],
        base: display,
        rates,
        on,
      }),
    }));
    // What could be had in an emergency, for the cover gap: the same holdings, classified once, so the
    // Insurance screen does not define it a second time. Other members' private holdings arrive as one
    // sum and cannot be classified, so they are not in it.
    // In the household's own currency and not the display one: it goes into the cover gap beside the loans
    // and the annual expense, which are in base, and a gap is refused where its inputs are in two currencies.
    // A home lived in is left out on purpose, with how much it is, so the FIRE screen can say so.
    const propertyLeftOut: NetWorth = netWorth({
      assets: assetTotals(split.leftOut).map((t) => t.value),
      debts: [],
      base: display,
      rates,
      on,
    });
    const liquid: NetWorth = netWorth({
      assets: corpusTotals.map((t) => t.liquid),
      debts: [],
      base,
      rates,
      on,
    });
    return {
      corpus,
      liquid,
      excluded,
      propertyLeftOut,
      propertyCount: property.holdings.filter((h) => !h.isArchived && property.livedIn.has(h.id)).length,
      /** Which holdings are earmarked, valued or not: a total of nothing is not the same as nothing earmarked. */
      earmarked,
      privateMembers: new Set(hiddenAssets.map((entry) => entry.memberId)).size,
    };
  }, [corpusHoldings, fundValuations, hiddenAssets, corpusDebts, property, display, base, rates, asOf, today]);

  // What is wrong with the figure, in one list behind one mark. Five marks in a row
  // on the number were five buttons to open, and the two of them that were not
  // warnings carried the same "i" as the heading's.
  const heroWarnings: string[] = [];
  // What the FIRE corpus says of its own figure: the same list less what is about property alone, which the corpus leaves out.
  const corpusWarnings: string[] = [];
  const warnBoth = (message: string): void => {
    heroWarnings.push(message);
    corpusWarnings.push(message);
  };
  // Whether the person can act on any of them. A mark is amber only where there is something to do, and says what
  // (docs/tokens.md, "A caveat is never coral"): the other members' unvalued private holdings are theirs to value.
  let heroActionable = false;
  if (personalTotalsFailed && scope === 'household') {
    heroActionable = true; // reload
    warnBoth(
      'The private holdings of other members could not be read, so this figure may be short by whatever they are worth. It is not that there are none: the request failed. Reload before relying on this number.',
    );
  }
  if (!personalTotalsFailed && hiddenUnvalued > 0 && scope === 'household') {
    warnBoth(
      `${String(hiddenUnvalued)} ${hiddenUnvalued === 1 ? 'private holding of another member has' : 'private holdings of other members have'} never been valued, so this total is short by whatever they are worth. Only they can record a value for them.`,
    );
  }
  if (visibleUnvalued > 0) {
    heroActionable = true; // record a value
    // The holdings and the properties that have never been valued, said as they are: a property is valued on its own screen.
    const unvaluedFunds = visibleUnvalued - property.unvalued;
    const sentence = (funds: number, properties: number): string => {
      const where = funds > 0 ? (properties > 0 ? 'Holdings, or on Property for a property,' : 'Holdings') : 'Property';
      const count = funds + properties;
      return `${unvaluedPhrase(count, properties)} never been valued, so this total is short by whatever ${count === 1 ? 'it is' : 'they are'} worth. Record a value on ${where} and it is counted.`;
    };
    heroWarnings.push(sentence(unvaluedFunds, property.unvalued));
    // The corpus holds a property that is not lived in, so one that has no value makes its figure short; a home lived in
    // is not in it, and not having a value for it does not.
    if (unvaluedFunds + property.unvaluedForCorpus > 0) corpusWarnings.push(sentence(unvaluedFunds, property.unvaluedForCorpus));
  }
  if (property.stale.length > 0) {
    heroActionable = true; // record a valuation
    const months = propertyListing?.staleMonths ?? 12;
    // Counted all the same, and marked: a property is carried at its latest valuation until somebody records another.
    const staleSentence = (entries: typeof property.stale): string =>
      `${entries.map((entry) => `${entry.name} (${String(entry.months)} months)`).join(', ')} ${entries.length === 1 ? 'has' : 'have'} a valuation more than ${String(months)} months old, so this total may be off by whatever ${entries.length === 1 ? 'it has' : 'they have'} moved since. Record a new valuation on Property.`;
    heroWarnings.push(staleSentence(property.stale));
    const staleForCorpus = property.stale.filter((entry) => !entry.livedIn);
    if (staleForCorpus.length > 0) corpusWarnings.push(staleSentence(staleForCorpus));
  }
  if (shownUnbalanced > 0) {
    heroActionable = true; // record the balance
    warnBoth(
      `${String(shownUnbalanced)} ${shownUnbalanced === 1 ? 'loan has' : 'loans have'} no outstanding balance recorded, so nothing is subtracted for ${shownUnbalanced === 1 ? 'it' : 'them'}. This figure is high by whatever is still owed. Record the balance on FIRE.`,
    );
  }
  if (plansFailed) {
    heroActionable = true; // reload
    warnBoth(
      'The loans could not be read, so nothing has been subtracted for them and this figure may be high by whatever is owed. It is not that there are none: the request failed. Reload before relying on this number.',
    );
  }
  if (propertyFailed) {
    heroActionable = true; // reload
    warnBoth(
      'The property could not be read, so this figure may be short by whatever it is worth, and a loan taken at a share may be counted whole. It is not that there is none: the request failed. Reload before relying on this number.',
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
    propertyFailed,
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
    corpusWarnings,
    heroActionable,
    propertyUnvaluedByCurrency: property.unvaluedByCurrency,
    worth,
    fire,
    planListing,
  };
}
