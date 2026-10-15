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
import { PlanCard, SpentHero, useBudgetComparison } from './budgetView.tsx';
import { EditExpense, type ExpensePatch } from './EditExpense.tsx';
import { QuickAdd } from './QuickAdd.tsx';
import { RecentList } from './RecentList.tsx';
import { useExpenses } from './useExpenses.ts';

export function ExpensesScreen({
  privacy,
  householdId,
  displayCurrency,
}: {
  privacy: boolean;
  householdId: string | null;
  /** Empty for the household's own currency. A device setting (§366). */
  displayCurrency: string;
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
    edit,
    discard,
    fy,
    today,
    add,
    reload,
  } = useExpenses(householdId);

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
    <div className="flex flex-col gap-4.5">
      {/*
        The comparison adds up the entries it can see and sets them against the household's plan. A contributor can
        read only their own entries, so for them it would show their spending as the household's, a partial figure
        that looks whole. They get their own ledger below and the household's totals on the Summary screen.
      */}
      {listing.viewer.role === 'contributor' ? (
        <>
          {quickAdd}
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
          expenses={listing.expenses}
          members={listing.members}
          // Null means the sums could not be read, which is not the same as nobody having any. The plan says which
          // it is rather than showing a total that might be short by an unknown amount.
          personalSpend={personalSpend}
          today={today}
          fy={fy}
          currency={reading}
          rates={rates}
          privacy={privacy}
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
  ...inputs
}: Parameters<typeof useBudgetComparison>[0] & {
  quickAdd: React.ReactNode;
  onFile: (period: { start: string; end: string }) => void;
  privacy: boolean;
}) {
  const view = useBudgetComparison(inputs);
  return (
    <>
      <SpentHero view={view} privacy={privacy} />
      {quickAdd}
      <PlanCard view={view} privacy={privacy} onFile={onFile} />
    </>
  );
}
