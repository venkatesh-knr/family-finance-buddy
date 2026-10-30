/**
 * Holdings: a list that is one glance a holding, and a screen for each holding (docs/design/holdings.md).
 *
 * Eight holdings took about 6.7 phone screens when every one rendered its full detail inline. The list is a
 * summary, filter chips that live in the URL, and holdings grouped by class with an Ended group last; a row opens
 * the holding, whose own screen takes the shape of its kind. Recording a value is still the thing this screen is
 * for — it takes seconds and cannot be done retrospectively — so it is on the detail, one tap from the row.
 */

import { useMemo, useState } from 'react';
import { isQualified } from '../../domain/position.ts';
import type { Earmark } from '../../domain/earmark.ts';
import type { IsoDate } from '../../lib/dates.ts';
import { money, percentOfCost } from '../../lib/money.ts';
import { formatQuantityGrouped } from '../../lib/quantity.ts';
import type { HoldingListing, InstrumentKind } from '../../repo/types.ts';
import { Problem } from '../../ui/primitives.tsx';
import { kindLabel } from '../../ui/labels.ts';
import { splitFundName } from './fundName.ts';
import { groupHoldings, matchesFilter, type Filter, type ListHolding, type Sort } from './holdingGroups.ts';
import { AddHolding, RefreshPrices } from './holdingParts.tsx';
import { AddRetirement } from './AddRetirement.tsx';
import { TermsForm } from './FixedIncomeForms.tsx';
import { HoldingDetail } from './HoldingDetail.tsx';
import { Chips, EmergencyCard, FixedExtras, GroupSection, ListHeader, Summary, type RowModel } from './HoldingsList.tsx';
import { ImportStatement } from './ImportStatement.tsx';
import { rowFact } from './rowFact.ts';
import { useFixedIncomeFacts } from './useFixedIncomeFacts.ts';
import { useHoldings, type HoldingRow } from './useHoldings.ts';

/** "a deposit", "a mutual fund": what the list's Add says it adds when the list is filtered to a class. */
const A: Record<string, string> = {
  mutual_fund: 'a mutual fund',
  etf: 'an ETF',
  equity: 'a share',
  bond: 'a bond',
  deposit: 'a deposit',
  retirement: 'a retirement account',
  other: 'a holding',
};

export function HoldingsScreen({
  privacy,
  onTogglePrivacy,
  householdId,
  filter,
  holdingId,
}: {
  privacy: boolean;
  /** For the privacy switch in a holding's own bar on a phone. */
  onTogglePrivacy: () => void;
  householdId: string | null;
  /** The class, earmark and currency the URL asks for; empty is All. */
  filter: Filter;
  /** The holding whose own screen this is, or null for the list. */
  holdingId: string | null;
}) {
  const hook = useHoldings(householdId);
  const { listing, rows, loading, problem, today, paidOut, paidOutFailed } = hook;
  const fixed = useFixedIncomeFacts(listing, today);
  const [panel, setPanel] = useState<'add' | 'import' | null>(null);
  const [sort, setSort] = useState<Sort>('largest');
  const [fetchSaid, setFetchSaid] = useState<string | null>(null);

  const base = listing?.household.baseCurrency ?? 'INR';
  const filterKind = filter.kind;
  const filterEarmark = filter.earmark;
  const filterCurrency = filter.currency;

  /** Per currency, on the Overview's terms: never summed across currencies; a holding nobody has read is absent. */
  const totals = useMemo(() => {
    const byCurrency = new Map<string, { value: bigint; invested: bigint; unread: number; short: number; missing: number }>();
    for (const row of rows) {
      // Paid out: the money is back in an account, so it is not part of what is held. The same rule as the
      // Overview's net worth, or the two screens would disagree about one household.
      if (paidOut.has(row.holding.id) || row.unitsHeld === 0n) continue;
      // The same holdings the figure above it is made from. A filtered summary that took its return and its caveat from
      // the whole portfolio put three funds' partial statements under a deposit's heading.
      if (
        !matchesFilter(
          {
            id: row.holding.id,
            kind: row.holding.instrument.kind,
            currency: row.holding.instrument.currency,
            earmark: row.holding.earmark,
            latest: null,
            unitsHeld: row.unitsHeld,
            paidOutOn: null,
          },
          {
            ...(filterKind === undefined ? {} : { kind: filterKind }),
            ...(filterEarmark === undefined ? {} : { earmark: filterEarmark }),
            ...(filterCurrency === undefined ? {} : { currency: filterCurrency }),
          },
        )
      ) {
        continue;
      }
      const currency = row.holding.instrument.currency;
      const bucket = byCurrency.get(currency) ?? { value: 0n, invested: 0n, unread: 0, short: 0, missing: 0 };
      if (row.latest === null) {
        // Unread on both sides of the comparison, or neither: an unvalued holding's cost set against no value
        // once turned a portfolio into a 61% loss.
        bucket.unread += 1;
      } else {
        bucket.invested += row.cost.amount?.minor ?? 0n;
        bucket.value += row.latest.amountMinor;
        if (isQualified(row.history)) bucket.short += 1;
        if (row.cost.amount === null) bucket.missing += 1;
      }
      byCurrency.set(currency, bucket);
    }
    return [...byCurrency.entries()].map(([currency, b]) => ({ currency, ...b }));
  }, [rows, paidOut, filterKind, filterEarmark, filterCurrency]);

  const listHoldings = useMemo<readonly ListHolding[]>(
    () =>
      rows.map((row) => ({
        id: row.holding.id,
        name: row.holding.instrument.name,
        kind: row.holding.instrument.kind,
        currency: row.holding.instrument.currency,
        earmark: row.holding.earmark,
        latest: row.latest === null ? null : money(row.latest.amountMinor, row.holding.instrument.currency),
        unitsHeld: row.unitsHeld,
        paidOutOn: paidOut.get(row.holding.id) ?? null,
      })),
    [rows, paidOut],
  );

  const grouped = useMemo(
    () => groupHoldings({ holdings: listHoldings, base, filter, sort }),
    [listHoldings, base, filter, sort],
  );

  /** What is earmarked as an emergency fund and still held, per currency, for the card under a list of deposits. */
  const emergency = useMemo(() => {
    const live = listHoldings.filter((h) => h.earmark === 'emergency' && h.paidOutOn === null && h.unitsHeld !== 0n);
    const by = new Map<string, bigint>();
    for (const h of live) if (h.latest !== null) by.set(h.latest.currency, (by.get(h.latest.currency) ?? 0n) + h.latest.minor);
    return {
      count: live.length,
      unvalued: live.filter((h) => h.latest === null).length,
      held: [...by.entries()].map(([currency, minor]) => money(minor, currency)),
    };
  }, [listHoldings]);

  const modelOf = useMemo(() => {
    const byId = new Map<string, HoldingRow>(rows.map((row) => [row.holding.id, row]));
    return (id: string): RowModel | null => {
      const row = byId.get(id);
      if (row === undefined) return null;
      const { holding } = row;
      const currency = holding.instrument.currency;
      const facts = fixed.get(id);
      const isFixed = holding.instrument.kind === 'deposit' || holding.instrument.kind === 'bond';
      const value = row.latest === null ? null : money(row.latest.amountMinor, currency);

      let gain: RowModel['gain'] = { kind: 'none' };
      if (isFixed) {
        // A deposit's newer worked-out value lives on its detail view, beside the action that records it
        // (HD-I1): the row's figure is the reading, and says when it was taken.
        if (row.latest !== null) gain = { kind: 'asat', date: row.latest.date };
      } else if (row.latest !== null) {
        if (isQualified(row.history)) gain = { kind: 'refused', short: true, missing: false };
        else if (row.cost.amount === null) gain = { kind: 'refused', short: false, missing: true };
        else {
          const diff = money(row.latest.amountMinor - row.cost.amount.minor, currency);
          gain = { kind: 'gain', gain: diff, percent: percentOfCost(diff.minor, row.cost.amount.minor) };
        }
      }

      return {
        id,
        title: splitFundName(holding.instrument.name).title,
        kind: holding.instrument.kind,
        member: holding.member.displayName,
        fact: rowFact({
          kind: holding.instrument.kind,
          symbol: holding.instrument.symbol,
          unitsText: formatQuantityGrouped(row.unitsHeld),
          position: facts?.position ?? null,
          view: facts?.view ?? null,
          institution: facts?.institution ?? null,
          retirementType: holding.instrument.retirementType,
          privacy,
        }),
        value,
        earmark: holding.earmark as Earmark,
        isForeign: holding.instrument.isForeignAsset,
        gain,
      };
    };
  }, [rows, fixed, privacy]);

  if (loading) return <p className="note px-4.5 py-4.5">Loading…</p>;
  if (problem !== null && listing === null) {
    return (
      <div className="px-4.5 py-4.5">
        <Problem>{problem}</Problem>
      </div>
    );
  }
  if (listing === null) return null;

  const canWrite = listing.viewer.canRecord;

  // A holding's own screen.
  if (holdingId !== null) {
    return (
      <HoldingDetail
        hook={hook}
        holdingId={holdingId}
        privacy={privacy}
        onTogglePrivacy={onTogglePrivacy}
        householdKind={listing.household.kind}
        canWrite={canWrite}
        fixed={fixed}
      />
    );
  }

  const filtered = (filter.kind ?? '') !== '' || (filter.earmark ?? '') !== '';
  const addLabel = (filter.kind ?? '') !== '' ? `Add ${A[filter.kind ?? ''] ?? 'a holding'}` : 'Add';
  const count = grouped.groups.reduce((sum, g) => sum + g.holdings.length, 0);
  const title = filtered
    ? (filter.kind ?? '') !== ''
      ? kindLabel(filter.kind ?? '')
      : 'Holdings'
    : 'Holdings';

  const chips = listHoldings.length > 0 ? <Chips chips={grouped.chips} filter={filter} /> : null;
  const summary = (
    <Summary
      grouped={grouped}
      base={base}
      filter={filter}
      privacy={privacy}
      totals={totals}
      paidOutFailed={paidOutFailed}
      action={canWrite ? <RefreshPrices onRefresh={hook.refresh} onSaid={setFetchSaid} /> : null}
      status={fetchSaid}
      extra={
        (filter.kind ?? '') === 'deposit' ? (
          <FixedExtras
            privacy={privacy}
            held={grouped.groups.filter((g) => g.kind === 'deposit').reduce((n, g) => n + g.holdings.length, 0)}
            rows={grouped.groups.flatMap((g) =>
              g.holdings.flatMap((h) => {
                const f = fixed.get(h.id);
                const row = rows.find((x) => x.holding.id === h.id);
                return f === undefined || row === undefined ? [] : [{ name: row.holding.instrument.name, view: f.view }];
              }),
            )}
          />
        ) : null
      }
    />
  );

  return (
    <div className="flex flex-col gap-3">
      {/* On a class the filter is the context for everything below, so the chips come first. */}
      {filtered && chips}
      {summary}

      {/* One Add on the screen (HD-I5), naming the class when the list is filtered to one, and one Import. */}
      <ListHeader
        title={title}
        count={count}
        sort={sort}
        onSort={setSort}
        canWrite={canWrite}
        addLabel={addLabel}
        panel={panel}
        onPanel={setPanel}
        forClass={(filter.kind ?? '') !== ''}
      />
      {!filtered && chips}
      {(filter.kind ?? '') === 'deposit' && (
        <p className="note list-helper">FD, RD, SSY, NSC, KVP, SCSS and post office deposits all live here. A PPF is under Retirement.</p>
      )}

      {canWrite && panel === 'add' && (
        <AddPanel
          listing={listing}
          initialKind={filter.kind ?? ''}
          onAdd={hook.add}
          onAddRetirement={hook.addRetirement}
          today={today}
          onDone={() => {
            fixed.reload();
            void hook.reload();
            setPanel(null);
          }}
        />
      )}
      {canWrite && panel === 'import' && (
        <ImportStatement
          listing={listing}
          onImported={() => {
            void hook.reload();
          }}
        />
      )}

      {listHoldings.length === 0 ? (
        <p className="note">
          Nothing recorded yet. Add a holding, then record what it is worth at each month end — that reading is the only
          way the year&rsquo;s peak can ever be known.
        </p>
      ) : (
        <>
          {grouped.groups.length === 0 && grouped.ended.length === 0 && (
            <p className="note">Nothing here matches that filter.</p>
          )}
          {grouped.groups.map((group) => (
            <GroupSection
              key={group.kind}
              kind={group.kind}
              count={group.holdings.length}
              subtotals={group.subtotals}
              shares={group.shares}
              rows={group.holdings.flatMap((h) => modelOf(h.id) ?? [])}
              privacy={privacy}
              base={base}
              bare={(filter.kind ?? '') !== '' && grouped.groups.length === 1}
            />
          ))}
          {grouped.ended.length > 0 && (
            <GroupSection
              kind="ended"
              label="Ended"
              count={grouped.ended.length}
              subtotals={[]}
              shares={[]}
              rows={grouped.ended.flatMap((h) => modelOf(h.id) ?? [])}
              privacy={privacy}
              base={base}
              open={false}
            />
          )}
          {((filter.kind ?? '') === 'deposit' || filter.earmark === 'emergency') && (
            <EmergencyCard held={emergency.held} count={emergency.count} unvalued={emergency.unvalued} privacy={privacy} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The kind picker (HD-I5): what is being added decides the form, because a fund is units and a cost and a
 * deposit is a principal, a rate and a date. Preselected to the class the list is filtered to.
 */
function AddPanel({
  listing,
  initialKind,
  onAdd,
  onAddRetirement,
  today,
  onDone,
}: {
  listing: HoldingListing;
  initialKind: string;
  onAdd: React.ComponentProps<typeof AddHolding>['onAdd'];
  onAddRetirement: React.ComponentProps<typeof AddRetirement>['onAdd'];
  today: IsoDate;
  onDone: () => void;
}) {
  const [what, setWhat] = useState<'holding' | 'fixed' | 'retirement'>(
    initialKind === 'deposit' || initialKind === 'bond' ? 'fixed' : initialKind === 'retirement' ? 'retirement' : 'holding',
  );
  return (
    <div className="mb-3.5 flex flex-col gap-3">
      <label className="flex w-full flex-col gap-1.5 sm:w-[260px]">
        <span className="label">What are you adding</span>
        <select
          className="field"
          value={what}
          onChange={(event) => {
            setWhat(event.target.value === 'fixed' ? 'fixed' : event.target.value === 'retirement' ? 'retirement' : 'holding');
          }}
        >
          <option value="holding">A fund, an ETF, a share or something else</option>
          <option value="fixed">A deposit or a bond</option>
          <option value="retirement">A retirement account: EPF, NPS or PPF</option>
        </select>
      </label>
      {what === 'retirement' ? (
        <AddRetirement listing={listing} today={today} onAdd={onAddRetirement} onDone={onDone} />
      ) : what === 'holding' ? (
        <AddHolding
          listing={listing}
          onAdd={onAdd}
          {...(initialKind === '' || initialKind === 'deposit' || initialKind === 'bond' || initialKind === 'retirement'
            ? {}
            : { initialKind: initialKind as InstrumentKind })}
        />
      ) : (
        <TermsForm
          listing={listing}
          mode={{ kind: 'new' }}
          today={today}
          {...(initialKind === 'bond' ? { initialKind: 'bond' as const } : {})}
          onCancel={onDone}
          onDone={onDone}
        />
      )}
    </div>
  );
}
