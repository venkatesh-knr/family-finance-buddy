/**
 * Holdings: a list that is one glance a holding, and a screen for each holding (docs/design/holdings.md).
 *
 * Eight holdings took about 6.7 phone screens when every one rendered its full detail inline. The list is a
 * summary, tabs that live in the URL (All first, then a tab for each class held), and holdings grouped by class; a row opens
 * the holding, whose own screen takes the shape of its kind. Recording a value is still the thing this screen is
 * for — it takes seconds and cannot be done retrospectively — so it is on the detail, one tap from the row.
 */

import { Select } from '../../ui/Select.tsx';
import { useMemo, useState } from 'react';
import { isQualified } from '../../domain/position.ts';
import { EARMARK_LABELS, type Earmark } from '../../domain/earmark.ts';
import type { IsoDate } from '../../lib/dates.ts';
import { money, percentOfCost } from '../../lib/money.ts';
import { formatQuantityGrouped } from '../../lib/quantity.ts';
import type { HoldingListing, InstrumentKind } from '../../repo/types.ts';
import { Problem } from '../../ui/primitives.tsx';
import { kindLabel } from '../../ui/labels.ts';
import { splitFundName } from './fundName.ts';
import { groupHoldings, matchesFilter, type Filter, type ListHolding, type Sort } from './holdingGroups.ts';
import { AddHolding, RefreshPrices } from './holdingParts.tsx';
import { AddGold } from './AddGold.tsx';
import { AddRetirement } from './AddRetirement.tsx';
import { goldRowLine } from './goldRow.ts';
import { useGold } from './useGold.ts';
import { TermsForm } from './FixedIncomeForms.tsx';
import { HoldingDetail } from './HoldingDetail.tsx';
import { EmergencyCard, FixedExtras, GroupSection, Summary, type RowModel } from './HoldingsList.tsx';
import { ByClass, ClassHeader, FloatingAdd, GoldFacts, SetAside, TabStrip, type SetAsideItem } from './HoldingsTabs.tsx';
import { othersHoldNote } from '../../app/otherMembers.ts';
import { ScopeSwitch, useScope, whose } from '../../app/scope.tsx';
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
  gold: 'gold',
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
  const { listing, rows: allRows, loading, problem, today, paidOut, paidOutFailed } = hook;
  // Whose figures: Mine first, and one state with the Overview (src/app/scope.tsx). Mine is the holdings recorded under the signed-in member.
  const { scope } = useScope();
  // The emergency fund is only ever the household's (simple-layout.md section 2a), so its view does not follow the switch.
  const emergencyView = (filter.earmark ?? '') === 'emergency';
  const rows = useMemo(
    () =>
      scope === 'mine' && !emergencyView && listing !== null ? allRows.filter((row) => row.holding.member.id === listing.viewer.memberId) : allRows,
    [allRows, scope, emergencyView, listing],
  );
  const fixed = useFixedIncomeFacts(listing, today);
  // Read once for the list, so a physical gold row can say whether its purity has a rate (gold.md section 3).
  const goldData = useGold(
    listing?.household.id ?? null,
    rows.some((row) => row.holding.instrument.kind === 'gold' && row.holding.instrument.goldForm === 'physical'),
  );
  const isPhysicalGold = (row: HoldingRow): boolean => row.holding.instrument.kind === 'gold' && row.holding.instrument.goldForm === 'physical';
  const [panel, setPanel] = useState<'add' | 'import' | null>(null);
  const [sort, setSort] = useState<Sort>('largest');
  const [fetchSaid, setFetchSaid] = useState<string | null>(null);

  const base = listing?.household.baseCurrency ?? 'INR';
  const filterKind = filter.kind;
  const filterEarmark = filter.earmark;
  const filterCurrency = filter.currency;

  /** Per currency, on the Overview's terms: never summed across currencies; a holding nobody has read is absent. */
  const totals = useMemo(() => {
    const byCurrency = new Map<string, { value: bigint; comparable: bigint; invested: bigint; unread: number; short: number; missing: number }>();
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
      const bucket = byCurrency.get(currency) ?? { value: 0n, comparable: 0n, invested: 0n, unread: 0, short: 0, missing: 0 };
      if (row.latest === null) {
        // Unread on both sides of the comparison, or neither: an unvalued holding's cost set against no value
        // once turned a portfolio into a 61% loss.
        bucket.unread += 1;
      } else if (row.holding.instrument.kind === 'retirement') {
        // In the value and out of the comparison with cost: an EPF or an NPS has no cost to have, and neither claims a return nor
        // refuses everybody else's.
        bucket.value += row.latest.amountMinor;
      } else {
        bucket.invested += row.cost.amount?.minor ?? 0n;
        bucket.value += row.latest.amountMinor;
        bucket.comparable += row.latest.amountMinor;
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

  // The tab strip draws a tab for each class held, whatever tab is open, in the order of their value.
  const tabKinds = useMemo(
    () => groupHoldings({ holdings: listHoldings, base, filter: {}, sort: 'largest' }).groups.map((group) => group.kind),
    [listHoldings, base],
  );

  /** What is earmarked as the emergency fund and still held, per currency, across the household: the card, and the Set aside row. */
  const emergency = useMemo(() => {
    // Physical gold is never the emergency fund (GD-I10); a gold ETF or fund is, as any fund is.
    const live = allRows.filter(
      (row) => row.holding.earmark === 'emergency' && !isPhysicalGold(row) && !paidOut.has(row.holding.id) && row.unitsHeld !== 0n,
    );
    const by = new Map<string, bigint>();
    for (const row of live) {
      if (row.latest !== null) by.set(row.holding.instrument.currency, (by.get(row.holding.instrument.currency) ?? 0n) + row.latest.amountMinor);
    }
    return {
      count: live.length,
      unvalued: live.filter((row) => row.latest === null).length,
      held: [...by.entries()].map(([currency, minor]) => money(minor, currency)),
    };
  }, [allRows, paidOut]);

  // What is set aside, per earmark: how many holdings and what they are worth, for the rows of All's Set aside section. The emergency fund is
  // the household's whichever way the switch is set, and the rest are the scope's.
  const setAside = useMemo<readonly SetAsideItem[]>(
    () => [
      ...(emergency.count > 0 ? [{ earmark: 'emergency' as Earmark, count: emergency.count, held: emergency.held }] : []),
      ...grouped.chips.earmarks
        .filter(({ earmark }) => earmark !== 'emergency')
        .map(({ earmark, count }) => {
          const held = new Map<string, bigint>();
          for (const h of listHoldings) {
            if (h.earmark !== earmark || h.paidOutOn !== null || h.unitsHeld === 0n || h.latest === null) continue;
            held.set(h.latest.currency, (held.get(h.latest.currency) ?? 0n) + h.latest.minor);
          }
          return { earmark: earmark as Earmark, count, held: [...held.entries()].map(([currency, minor]) => money(minor, currency)) };
        }),
    ],
    [emergency, grouped.chips.earmarks, listHoldings],
  );

  const modelOf = useMemo(() => {
    const byId = new Map<string, HoldingRow>(rows.map((row) => [row.holding.id, row]));
    return (id: string): RowModel | null => {
      const row = byId.get(id);
      if (row === undefined) return null;
      const { holding } = row;
      const currency = holding.instrument.currency;
      const facts = fixed.get(id);
      // A deposit's row says when its reading was taken, and so does a retirement holding's: an EPF is a passbook balance and an
      // NPS units at a NAV, neither has a cost to have, and "no cost recorded" on it would be asking for a figure nobody has.
      const isFixed =
        holding.instrument.kind === 'deposit' ||
        holding.instrument.kind === 'bond' ||
        holding.instrument.kind === 'retirement' ||
        isPhysicalGold(row);
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
          goldLine: isPhysicalGold(row)
            ? goldRowLine({ purity: holding.instrument.goldPurity, grams: row.unitsHeld, rates: goldData.rates, today })
            : null,
          privacy,
        }),
        value,
        earmark: holding.earmark as Earmark,
        isForeign: holding.instrument.isForeignAsset,
        gain,
      };
    };
  }, [rows, fixed, privacy, goldData.rates, today]);

  // What Mine leaves out, said on All, where the classes are listed: a class held under another member has no row and no tab here.
  const othersHold = useMemo(
    () =>
      scope === 'mine' && listing !== null
        ? othersHoldNote(
            allRows.filter((row) => !row.holding.isArchived && !paidOut.has(row.holding.id) && row.unitsHeld !== 0n).map((row) => ({ memberId: row.holding.member.id, kind: row.holding.instrument.kind })),
            listing.viewer.memberId,
            kindLabel,
          )
        : null,
    [scope, listing, allRows, paidOut],
  );

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

  const kind = filter.kind ?? '';
  const earmarkFilter = filter.earmark ?? '';
  const filtered = kind !== '' || earmarkFilter !== '';
  const memberCount = listing.members.filter((member) => !member.isArchived).length;
  const mayTypeRate = listing.viewer.role === 'owner' || listing.viewer.role === 'partner';
  const addLabel = kind !== '' ? `Add ${A[kind] ?? 'a holding'}` : 'Add a holding';
  const count = grouped.groups.reduce((sum, g) => sum + g.holdings.length, 0);
  // The label above the figure says whose it is and of what (docs/design/simple-layout.md section 2a): "Your holdings", "Household gold".
  const heading =
    kind !== ''
      ? `${whose(scope)} ${kindLabel(kind).toLowerCase()} · current value`
      : earmarkFilter === 'emergency'
        ? 'Household emergency fund · current value'
        : earmarkFilter !== ''
          ? `${whose(scope)} ${EARMARK_LABELS[earmarkFilter as Earmark].toLowerCase()} · current value`
          : `${whose(scope)} holdings · current value`;
  const listTitle =
    kind !== '' ? kindLabel(kind) : earmarkFilter === 'emergency' ? 'Household emergency fund' : earmarkFilter !== '' ? EARMARK_LABELS[earmarkFilter as Earmark] : 'Holdings';
  // Under Mine, a member can hold nothing of their own while the household holds plenty: that is said, and not "nothing recorded".
  const householdHoldsOther = scope === 'mine' && allRows.length > 0;
  const householdOfKind = kind === '' ? allRows.length : allRows.filter((row) => row.holding.instrument.kind === kind).length;

  const summary = (
    <Summary
      grouped={grouped}
      heading={heading}
      base={base}
      filter={filter}
      privacy={privacy}
      totals={totals}
      paidOutFailed={paidOutFailed}
      action={canWrite ? <RefreshPrices onRefresh={hook.refresh} onSaid={setFetchSaid} /> : null}
      status={fetchSaid}
      extra={
        kind === 'deposit' ? (
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
    // The bottom room is the floating Add's band, so that the pill never sits over the last row.
    <div className="flex flex-col gap-3 pb-24">
      {/* Whose figures, and Import: the top of the screen (simple-layout.md section 2). */}
      <div className="holdings-top">
        <ScopeSwitch members={memberCount} />
        <span className="flex-1" />
        {canWrite && (
          <button
            type="button"
            className="quiet-button"
            aria-expanded={panel === 'import'}
            onClick={() => {
              setPanel(panel === 'import' ? null : 'import');
            }}
          >
            Import
          </button>
        )}
      </div>

      {/* All first, then a tab for each class held. An earmark opens from All's Set aside, and is no tab. */}
      {allRows.length > 0 && <TabStrip kinds={tabKinds} current={earmarkFilter !== '' ? null : kind} />}

      {summary}

      {kind === '' && earmarkFilter === '' && rows.length > 0 && othersHold !== null && (
        <p className="note" data-testid="others-hold">
          {othersHold}
        </p>
      )}

      {canWrite && panel === 'add' && (
        <AddPanel
          listing={listing}
          initialKind={kind}
          onAdd={hook.add}
          onAddRetirement={hook.addRetirement}
          onAddGold={hook.addGold}
          today={today}
          onDone={() => {
            fixed.reload();
            void goldData.reload();
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

      {listHoldings.length === 0 && !emergencyView ? (
        householdHoldsOther ? (
          <p className="note" data-testid="mine-empty">
            You hold nothing of your own here. The household holds {allRows.length} {allRows.length === 1 ? 'holding' : 'holdings'}: choose Household
            above to see {allRows.length === 1 ? 'it' : 'them'}.
          </p>
        ) : (
          <p className="note">
            Nothing recorded yet. Add a holding, then record what it is worth at each month end — that reading is the only
            way the year&rsquo;s peak can ever be known.
          </p>
        )
      ) : !filtered ? (
        <>
          <ByClass grouped={grouped} base={base} privacy={privacy} />
          <SetAside items={setAside} privacy={privacy} />
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
        </>
      ) : (
        <>
          {kind === 'gold' && (
            <GoldFacts
              rows={rows}
              rates={goldData.rates}
              today={today}
              householdId={listing.household.id}
              mayTypeRate={mayTypeRate}
              onChanged={async () => {
                await goldData.reload();
                await hook.reload();
              }}
            />
          )}
          <ClassHeader title={listTitle} count={count} sort={sort} onSort={setSort} />
          {kind === 'deposit' && (
            <p className="note list-helper">FD, RD, SSY, NSC, KVP, SCSS and post office deposits all live here. A PPF is under Retirement.</p>
          )}
          {grouped.groups.length === 0 && grouped.ended.length === 0 && (
            <p className="note" data-testid="filter-empty">
              {scope === 'mine' && householdOfKind > 0 && kind !== ''
                ? `You hold none of this. The household holds ${String(householdOfKind)}: choose Household above to see ${householdOfKind === 1 ? 'it' : 'them'}.`
                : 'Nothing here matches that filter.'}
            </p>
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
              bare={kind !== '' && grouped.groups.length === 1}
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
          {(kind === 'deposit' || earmarkFilter === 'emergency') && (
            <EmergencyCard held={emergency.held} count={emergency.count} unvalued={emergency.unvalued} privacy={privacy} />
          )}
        </>
      )}

      {/* The one Add on the screen (HD-I5), a pill above the bottom bar, named for the tab. */}
      {canWrite && (
        <FloatingAdd
          label={addLabel}
          expanded={panel === 'add'}
          onClick={() => {
            setPanel(panel === 'add' ? null : 'add');
          }}
        />
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
  onAddGold,
  today,
  onDone,
}: {
  listing: HoldingListing;
  initialKind: string;
  onAdd: React.ComponentProps<typeof AddHolding>['onAdd'];
  onAddRetirement: React.ComponentProps<typeof AddRetirement>['onAdd'];
  onAddGold: React.ComponentProps<typeof AddGold>['onAdd'];
  today: IsoDate;
  onDone: () => void;
}) {
  const [what, setWhat] = useState<'holding' | 'fixed' | 'retirement' | 'gold'>(
    initialKind === 'deposit' || initialKind === 'bond'
      ? 'fixed'
      : initialKind === 'retirement'
        ? 'retirement'
        : initialKind === 'gold'
          ? 'gold'
          : 'holding',
  );
  // What is being added is the first field of the form's first step, and it decides the form (HD-I5; docs/design/simple-layout.md section 4).
  const typeField = (
    <Select
      label="Type"
      value={what}
      onChange={(event) => {
        const value = event.target.value;
        setWhat(value === 'fixed' || value === 'retirement' || value === 'gold' ? value : 'holding');
      }}
    >
      <option value="holding">A fund, an ETF, a share or something else</option>
      <option value="fixed">A deposit or a bond</option>
      <option value="retirement">A retirement account: EPF, NPS or PPF</option>
      <option value="gold">Gold: physical, or an ETF or fund</option>
    </Select>
  );
  return what === 'retirement' ? (
    <AddRetirement listing={listing} today={today} onAdd={onAddRetirement} onDone={onDone} typeField={typeField} />
  ) : what === 'gold' ? (
    <AddGold listing={listing} today={today} onAdd={onAddGold} onDone={onDone} typeField={typeField} />
  ) : what === 'holding' ? (
    <AddHolding
      listing={listing}
      onAdd={onAdd}
      onClose={onDone}
      typeField={typeField}
      {...(initialKind === '' || initialKind === 'deposit' || initialKind === 'bond' || initialKind === 'retirement' || initialKind === 'gold'
        ? {}
        : { initialKind: initialKind as InstrumentKind })}
    />
  ) : (
    <TermsForm
      listing={listing}
      mode={{ kind: 'new' }}
      today={today}
      typeField={typeField}
      {...(initialKind === 'bond' ? { initialKind: 'bond' as const } : {})}
      onCancel={onDone}
      onDone={onDone}
    />
  );
}
