/**
 * The expenses screen, in the order of its artboard (docs/design/vibrant-canvas.html, Expenses): the month's
 * spending and how it is going, a quick add folded to an amount, the plan beside what has been spent, and what was
 * recorded most recently.
 *
 * A figure typed here travels through the repository, the policies and the change stream and comes back on another
 * device; the comparison is read in whatever this device asked for, and the ledger stays in what was entered.
 */

import { useEffect, useState } from 'react';
import { listRates, type FxRate } from '../../repo/rates.ts';
import type { Expense as ExpenseRow } from '../../repo/types.ts';
import { Card, Problem } from '../../ui/primitives.tsx';
import { JoinHousehold } from '../household/JoinHousehold.tsx';
import { MonthSurface } from '../money/MonthSurface.tsx';
import { PlanCard, SpentHero, useBudgetComparison } from './budgetView.tsx';
import { EditExpense, type ExpensePatch } from './EditExpense.tsx';
import { QuickAdd } from './QuickAdd.tsx';
import { RecentList, type LedgerMoney } from './RecentList.tsx';
import { useExpenses } from './useExpenses.ts';

export function ExpensesScreen({
  privacy,
  householdId,
  displayCurrency,
  recurringMade = 0,
  money,
}: {
  privacy: boolean;
  householdId: string | null;
  /** How many recurring entries were made since the app opened. When it grows, the entries are read again. */
  recurringMade?: number;
  /** Empty for the household's own currency. A device setting (§366). */
  displayCurrency: string;
  /** Money in and money moved, listed beside the spending (Money's Ledger). Absent where only spending is shown. */
  money?: LedgerMoney;
}) {
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  // "File them" on the plan: the ledger shows only the entries with no category in the period the plan was
  // showing, until it is left.
  const [uncategorisedIn, setUncategorisedIn] = useState<{ start: string; end: string } | null>(null);

  /**
   * The rates this household has recorded.
   *
   * Loaded here rather than in the hook because only the comparison needs
   * them, and a failure to read them must not take the ledger down with it:
   * with no rates, spending in another currency is left out and said so.
   */
  const [rates, setRates] = useState<readonly FxRate[]>([]);

  useEffect(() => {
    if (householdId === null) return;
    let live = true;
    listRates(householdId)
      .then((next) => {
        if (live) setRates(next);
      })
      .catch(() => {
        if (live) setRates([]);
      });
    return () => {
      live = false;
    };
  }, [householdId]);

  const {
    listing,
    loading,
    refreshing,
    problem,
    live,
    liveDetail,
    noHousehold,
    budgets,
    personalSpend,
    periodExpenses,
    edit,
    discard,
    fy,
    today,
    add,
    reload,
  } = useExpenses(householdId);

  // The poster ran after the first read: read again, so the entries it made are here.
  useEffect(() => {
    if (recurringMade > 0) reload();
  }, [recurringMade]);

  if (loading) {
    return <p className="note px-4.5 py-4.5">Loading…</p>;
  }

  if (noHousehold) {
    return <JoinHousehold onJoined={reload} />;
  }

  if (problem !== null && listing === null) {
    return (
      <div className="px-4.5 py-4.5">
        <Problem>{problem}</Problem>
      </div>
    );
  }

  if (listing === null) return null;

  // The household's own currency until this device says otherwise.
  const reading = displayCurrency === '' ? (listing.household.baseCurrency ?? 'INR') : displayCurrency;

  const quickAdd = listing.viewer.canRecord ? (
    <QuickAdd listing={listing} onAdd={add} />
  ) : (
    <Card title="Quick add">
      <p className="note">
        Your role in this household is <strong>{listing.viewer.role}</strong>, which can read but not record. The
        database enforces that, not this screen.
      </p>
    </Card>
  );

  return (
    <div className="flex flex-col gap-2.5">
      {/*
        The comparison adds up the entries it can see and sets them against the household's plan. A contributor can
        read only their own entries, so for them it would show their spending as the household's, a partial figure
        that looks whole. They get their own ledger below and the household's totals on the Summary screen.
      */}
      {listing.viewer.role === 'contributor' ? (
        <>
          {quickAdd}
          {money?.expected}
          <Card title="This month">
            <p className="note">
              You can read your own entries. The household&rsquo;s spending, by category, is on the Summary screen.
            </p>
          </Card>
        </>
      ) : (
        <Budget
          quickAdd={quickAdd}
          categories={listing.categories}
          budgets={budgets}
          // The whole year when it could be read, so a busy month is added up in full; the list's most recent
          // entries otherwise, and then the figure says it may be short.
          expenses={periodExpenses ?? listing.expenses}
          complete={periodExpenses !== null}
          members={listing.members}
          // Null means the sums could not be read, which is not the same as nobody having any. The plan says which
          // it is rather than showing a total that might be short by an unknown amount.
          personalSpend={personalSpend}
          today={today}
          fy={fy}
          currency={reading}
          rates={rates}
          privacy={privacy}
          {...(money !== undefined && (listing.viewer.role === 'owner' || listing.viewer.role === 'partner')
            ? { month: { householdId: listing.household.id, refreshKey: money.credits } }
            : {})}
          {...(money?.expected === undefined ? {} : { afterSurface: money.expected })}
          onFile={(period) => {
            setUncategorisedIn(period);
          }}
        />
      )}

      {editing !== null && (
        <EditExpense
          key={editing.id}
          expense={editing}
          listing={listing}
          onSave={async (patch: ExpensePatch) => {
            await edit(patch);
            setEditing(null);
          }}
          onVoid={async () => {
            await discard(editing.id);
            setEditing(null);
          }}
          onCancel={() => {
            setEditing(null);
          }}
        />
      )}

      <RecentList
        listing={listing}
        today={today}
        onEdit={listing.viewer.canRecord ? setEditing : null}
        privacy={privacy}
        refreshing={refreshing}
        live={live}
        liveDetail={liveDetail}
        uncategorisedIn={uncategorisedIn}
        onShowAll={() => {
          setUncategorisedIn(null);
        }}
        {...(money === undefined ? {} : { money })}
      />
    </div>
  );
}

/**
 * The month's figure, quick add, and the plan, in that order. A component of its own because the hook that reads
 * the plan against the spending feeds the first and the third, and quick add sits between them.
 */
function Budget({
  quickAdd,
  onFile,
  privacy,
  month,
  afterSurface,
  ...inputs
}: Parameters<typeof useBudgetComparison>[0] & {
  quickAdd: React.ReactNode;
  /** What sits under the month surface: the Expected panel. */
  afterSurface?: React.ReactNode;
  onFile: (period: { start: string; end: string }) => void;
  privacy: boolean;
  /** The household and what to read the month's totals again on, where the month surface is shown: an owner or a partner, with money in. */
  month?: { householdId: string; refreshKey: unknown };
}) {
  const view = useBudgetComparison(inputs);
  // A second reading of the same inputs that is never moved off the month: the surface is the month, whatever the plan panel shows.
  const monthView = useBudgetComparison(inputs);
  return (
    <>
      {month !== undefined && (
        <MonthSurface view={monthView} householdId={month.householdId} today={inputs.today} privacy={privacy} refreshKey={month.refreshKey} />
      )}
      {afterSurface}
      <SpentHero view={view} privacy={privacy} soft={month !== undefined} />
      {quickAdd}
      <PlanCard view={view} privacy={privacy} onFile={onFile} />
    </>
  );
}
