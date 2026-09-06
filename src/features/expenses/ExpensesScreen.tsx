/**
 * The expenses screen: a list, and a quick-add field.
 *
 * One screen, deliberately. It is the whole of the walking skeleton's UI — the
 * point is that a figure typed here travels through the repository, the
 * policies and the change stream and comes back on another device.
 */

import { useCallback, useMemo, useState } from 'react';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money, parseAmountToMinor } from '../../lib/money.ts';
import { todayInIst } from '../../repo/expenses.ts';
import type { LiveStatus } from '../../repo/expenses.ts';
import type { ExpenseListing, Expense as ExpenseRow, Member } from '../../repo/types.ts';
import { Button, Card, Field, Pill, Problem } from '../../ui/primitives.tsx';
import { JoinHousehold } from '../household/JoinHousehold.tsx';
import { BudgetVsActual } from './BudgetVsActual.tsx';
import { useExpenses } from './useExpenses.ts';

export function ExpensesScreen({ privacy, householdId }: { privacy: boolean; householdId: string | null }) {
  const {
    listing,
    loading,
    refreshing,
    problem,
    live,
    liveDetail,
    noHousehold,
    budgets,
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

  return (
    <div className="flex flex-col gap-4.5">
      {listing.viewer.canRecord ? (
        <QuickAdd listing={listing} onAdd={add} />
      ) : (
        <Card title="Quick add">
          <p className="note">
            Your role in this household is <strong>{listing.viewer.role}</strong>, which can read
            but not record. The database enforces that, not this screen.
          </p>
        </Card>
      )}

      <BudgetVsActual
        categories={listing.categories}
        budgets={budgets}
        expenses={listing.expenses}
        today={today}
        fy={fy}
        currency={listing.household.baseCurrency}
        privacy={privacy}
      />

      <ExpenseList
        listing={listing}
        privacy={privacy}
        refreshing={refreshing}
        live={live}
        liveDetail={liveDetail}
      />
    </div>
  );
}

function QuickAdd({
  listing,
  onAdd,
}: {
  listing: ExpenseListing;
  onAdd: (expense: Parameters<ReturnType<typeof useExpenses>['add']>[0]) => Promise<void>;
}) {
  // A contributor may only file under their own name, so they are offered only
  // their own name. The policy would refuse anything else; a form that offered
  // it would be teaching people the app is unreliable rather than that they
  // lack the permission.
  const selectableMembers = useMemo(
    () =>
      listing.viewer.canFileForOthers
        ? listing.members.filter((member) => !member.isArchived)
        : listing.members.filter((member) => member.id === listing.viewer.memberId),
    [listing.members, listing.viewer.canFileForOthers, listing.viewer.memberId],
  );

  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [date, setDate] = useState(todayInIst);
  const [memberId, setMemberId] = useState(listing.viewer.memberId);
  const [categoryId, setCategoryId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const currency = listing.household.baseCurrency;

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setProblem(null);

      let minor: bigint;
      try {
        minor = parseAmountToMinor(amount, currency);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'That is not an amount.');
        return;
      }

      if (minor <= 0n) {
        setProblem('An expense is a positive amount.');
        return;
      }

      setBusy(true);
      try {
        await onAdd({
          householdId: listing.household.id,
          memberId,
          // Blank stays blank. Guessing a category to avoid an empty field
          // would file spending somewhere nobody chose, and the comparison
          // downstream would treat that guess as a fact.
          categoryId: categoryId === '' ? null : categoryId,
          date,
          amount: money(minor, currency),
          payee: payee.trim() === '' ? null : payee.trim(),
        });
        setAmount('');
        setPayee('');
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not save that.');
      } finally {
        setBusy(false);
      }
    },
    [amount, categoryId, currency, date, listing.household.id, memberId, onAdd, payee],
  );

  return (
    <Card title="Quick add" aside={<span className="note">{listing.household.name}</span>}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="w-full sm:w-[130px] sm:shrink-0">
          <Field
            label={`Amount (${currency})`}
            numeric
            inputMode="decimal"
            placeholder="0.00"
            required
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </div>

        <div className="w-full sm:w-auto sm:min-w-[160px] sm:flex-1">
          <Field
            label="Payee"
            placeholder="Optional"
            value={payee}
            onChange={(event) => {
              setPayee(event.target.value);
            }}
          />
        </div>

        <div className="w-full sm:w-[150px] sm:shrink-0">
          <Field
            label="Date"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
        </div>

        <label className="flex w-full flex-col gap-1.5 sm:w-[160px] sm:shrink-0">
          <span className="micro-label">Category</span>
          <select
            className="field"
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
            }}
          >
            <option value="">Uncategorised</option>
            {listing.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-full sm:w-[150px] sm:shrink-0 flex-col gap-1.5">
          <span className="micro-label">Member</span>
          <select
            className="field"
            value={memberId}
            onChange={(event) => {
              setMemberId(event.target.value);
            }}
          >
            {selectableMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>

        <Button type="submit" disabled={busy || amount.trim() === ''}>
          {busy ? 'Saving…' : 'Add'}
        </Button>
      </form>

      {problem !== null && (
        <div className="mt-3">
          <Problem>{problem}</Problem>
        </div>
      )}

      <p className="note mt-3">
        Dates are the calendar day in India, whatever this device is set to. Amounts are stored in
        paise, in {currency}, exactly as entered.
      </p>
    </Card>
  );
}

function ExpenseList({
  listing,
  privacy,
  refreshing,
  live,
  liveDetail,
}: {
  listing: ExpenseListing;
  privacy: boolean;
  refreshing: boolean;
  live: LiveStatus;
  liveDetail: string | null;
}) {
  const { expenses } = listing;

  return (
    <Card
      title="Expenses"
      aside={
        <span className="flex items-center gap-2.5">
          <LiveIndicator live={live} liveDetail={liveDetail} />
          <span className="note" aria-live="polite">
            {refreshing ? 'Updating…' : `${String(expenses.length)} most recent`}
          </span>
        </span>
      }
    >
      {expenses.length === 0 ? (
        <p className="note">
          Nothing recorded yet. The first amount you add above will appear here, and on any other
          device signed in to this household.
        </p>
      ) : (
        <>
          {/*
            Two renderings, not one that scrolls.
            
            Four columns do not fit a phone, and a table in a sideways-scrolling
            box hides the amount — the one column anybody opened the screen for.
            So a phone gets a stacked list where the figure is always visible,
            and the table starts where there is room for it.
          */}
          <ul className="row-separated sm:hidden">
            {expenses.map((expense) => (
              <StackedRow key={expense.id} expense={expense} privacy={privacy} />
            ))}
          </ul>

          <div className="hidden scroll-x sm:block">
            <table className="w-full border-collapse text-cell">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Payee</Th>
                  <Th>Member</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody className="row-separated">
                {expenses.map((expense) => (
                  <Row key={expense.id} expense={expense} privacy={privacy} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Whether this screen is actually live.
 *
 * Shown rather than assumed: a channel that never joined behaves exactly like
 * one with nothing to report, so without this the list silently goes stale and
 * a figure entered on another device never arrives.
 */
function LiveIndicator({ live, liveDetail }: { live: LiveStatus; liveDetail: string | null }) {
  if (live === 'live') {
    return <Pill tone="ok">Live</Pill>;
  }
  if (live === 'connecting') {
    return <Pill tone="neutral">Connecting</Pill>;
  }
  return (
    <span title={liveDetail ?? 'The change stream did not connect.'}>
      <Pill tone="due">Not live</Pill>
    </span>
  );
}

/**
 * One expense on a phone.
 *
 * The amount leads, because it is what the eye is looking for, and it keeps the
 * tabular figures so a column of them still lines up. Everything else drops to
 * a second line rather than competing for width.
 */
function StackedRow({ expense, privacy }: { expense: ExpenseRow; privacy: boolean }) {
  return (
    <li className="flex flex-col gap-1 py-2.5" style={expense.isVoided ? { opacity: 0.55 } : undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <span style={{ color: 'var(--ink)' }}>
          {expense.payee ?? <span className="note">No payee</span>}
        </span>
        <span className="num whitespace-nowrap" style={{ color: 'var(--ink)' }}>
          {formatMoney(expense.amount, { privacy })}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="num note">{formatIsoDate(expense.date)}</span>
        <MemberTag member={expense.member} />
        {expense.amount.currency !== 'INR' && <Pill tone="neutral">{expense.amount.currency}</Pill>}
        {expense.isVoided && <Pill tone="due">Voided</Pill>}
      </div>
    </li>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className="micro-label px-2.5 py-2"
      style={{
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--line)',
        textAlign: align,
      }}
    >
      {children}
    </th>
  );
}

function Row({ expense, privacy }: { expense: ExpenseRow; privacy: boolean }) {
  const foreign = expense.amount.currency !== 'INR';

  return (
    <tr style={expense.isVoided ? { opacity: 0.55 } : undefined}>
      <td className="num px-2.5 py-2 align-top" style={{ color: 'var(--muted)' }}>
        {formatIsoDate(expense.date)}
      </td>
      <td className="px-2.5 py-2 align-top" style={{ color: 'var(--ink)' }}>
        {expense.payee ?? <span className="note">—</span>}
        {expense.isVoided && (
          <>
            {' '}
            <Pill tone="due">Voided</Pill>
          </>
        )}
      </td>
      <td className="px-2.5 py-2 align-top">
        <MemberTag member={expense.member} />
      </td>
      <td className="num px-2.5 py-2 text-right align-top" style={{ color: 'var(--ink)' }}>
        {formatMoney(expense.amount, { privacy })}
        {foreign && (
          <>
            {' '}
            <Pill tone="neutral">{expense.amount.currency}</Pill>
          </>
        )}
      </td>
    </tr>
  );
}

/** Ownership reads as the member's name, with the colour as reinforcement only. */
function MemberTag({ member }: { member: Member }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 rounded-pill"
        style={{ background: `var(--${member.colour})` }}
      />
      <span style={{ color: 'var(--ink-2)' }}>{member.displayName}</span>
      {member.isArchived && <Pill tone="neutral">Archived</Pill>}
    </span>
  );
}
