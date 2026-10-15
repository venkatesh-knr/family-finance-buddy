/**
 * Quick add: the amount first, everything else folded.
 *
 * The artboard's form (docs/design/vibrant-canvas.html, Expenses): an amount and a payee side by side, a row of
 * category chips, and one line, "Today · you · shared", that opens the rest (the date, whose it is, and whether it is
 * private), then Add. The flow this exists for is a week of real spending logged without it annoying anyone, so
 * the common entry is two taps and an amount, and the unusual one is one tap further.
 */

import { useCallback, useMemo, useState } from 'react';
import { formatIsoDate } from '../../lib/dates.ts';
import { money, parseAmountToMinor } from '../../lib/money.ts';
import { todayInIst } from '../../repo/expenses.ts';
import type { ExpenseListing } from '../../repo/types.ts';
import { Button, Field, Problem } from '../../ui/primitives.tsx';
import type { useExpenses } from './useExpenses.ts';

/** How many category chips are offered before "More": the ones this household files under most. */
const CHIPS = 4;

export function QuickAdd({
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
  const [opened, setOpened] = useState(false);
  const [allCategories, setAllCategories] = useState(false);

  /**
   * Private, and off by default (§20).
   *
   * "A shared ledger is the premise of the app"; a form that remembered the
   * tick would slowly turn one into something else without anybody deciding
   * to. So it resets after every entry, and privacy is a choice made per
   * entry rather than a mode somebody is left in.
   */
  const [personal, setPersonal] = useState(false);

  const currency = listing.household.baseCurrency;
  const symbol = currency === 'INR' ? '₹' : currency;
  const today = useMemo(() => todayInIst(), []);

  // The categories this household files under most come first as chips; the rest are under More. A category
  // chosen from More takes the last chip's place, so what is selected is always on screen.
  const chips = useMemo(() => {
    const live = listing.categories.filter((category) => !category.isArchived);
    const used = new Map<string, number>();
    for (const expense of listing.expenses) {
      if (expense.categoryId !== null) used.set(expense.categoryId, (used.get(expense.categoryId) ?? 0) + 1);
    }
    const ranked = [...live].sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0));
    const top = ranked.slice(0, CHIPS);
    const chosen = live.find((category) => category.id === categoryId);
    if (chosen !== undefined && !top.some((category) => category.id === chosen.id)) {
      return [...top.slice(0, CHIPS - 1), chosen];
    }
    return top;
  }, [listing.categories, listing.expenses, categoryId]);

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
          visibility: personal && memberId === listing.viewer.memberId ? 'personal' : 'household',
        });
        setAmount('');
        setPayee('');
        setPersonal(false);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not save that.');
      } finally {
        setBusy(false);
      }
    },
    [amount, categoryId, currency, date, listing.household.id, memberId, onAdd, payee, personal],
  );

  const memberName = listing.members.find((member) => member.id === memberId)?.displayName ?? 'you';
  const summary = [
    date === today ? 'Today' : formatIsoDate(date),
    memberId === listing.viewer.memberId ? 'you' : memberName,
    personal ? 'private' : 'shared',
  ].join(' · ');

  return (
    <section className="card qa" aria-label="Add an expense">
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="qa-top">
          <label className="qa-amount">
            <span aria-hidden="true">{symbol}</span>
            <input
              type="text"
              inputMode="decimal"
              aria-label={`Amount (${currency})`}
              placeholder="0"
              required
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
            />
          </label>
          <label className="qa-payee">
            <input
              type="text"
              aria-label="Payee"
              placeholder="Payee (optional)"
              value={payee}
              onChange={(event) => {
                setPayee(event.target.value);
              }}
            />
          </label>
        </div>

        <div className="qa-chips" role="group" aria-label="Category">
          {chips.map((category) => (
            <button
              key={category.id}
              type="button"
              className="qa-chip"
              aria-pressed={categoryId === category.id}
              onClick={() => {
                // Pressing the chosen one again takes the category off: blank stays blank.
                setCategoryId((now) => (now === category.id ? '' : category.id));
              }}
            >
              {category.name}
            </button>
          ))}
          <button
            type="button"
            className="qa-chip"
            aria-expanded={allCategories}
            onClick={() => {
              setAllCategories((was) => !was);
            }}
          >
            More
          </button>
        </div>

        {allCategories && (
          <label className="mt-2.5 flex flex-col gap-1.5">
            <span className="label">Category</span>
            <select
              className="field"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
              }}
            >
              <option value="">Uncategorised</option>
              {listing.categories
                .filter((category) => !category.isArchived)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
        )}

        <div className="qa-foot">
          <button
            type="button"
            className="qa-fold"
            aria-expanded={opened}
            onClick={() => {
              setOpened((was) => !was);
            }}
          >
            <span>{summary}</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ transform: opened ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <Button type="submit" disabled={busy || amount.trim() === ''}>
            {busy ? 'Saving…' : 'Add'}
          </Button>
        </div>

        {opened && (
          <div className="qa-panel">
            <Field
              label="Date"
              type="date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
              }}
            />

            {selectableMembers.length > 1 && (
              <label className="flex flex-col gap-1.5">
                <span className="label">Member</span>
                <select
                  className="field"
                  value={memberId}
                  onChange={(event) => {
                    setMemberId(event.target.value);
                    // Private is offered only on your own entries, so moving the entry to somebody else takes the
                    // tick off. Left on, the form would file it private under a member who never chose that.
                    if (event.target.value !== listing.viewer.memberId) setPersonal(false);
                  }}
                >
                  {selectableMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/*
              Offered only when filing under your own name. A private entry is
              readable by the member it belongs to, so marking somebody else's
              entry private would hide it from them and from you both — the
              database would accept it and nobody could ever read it again.
            */}
            {memberId === listing.viewer.memberId && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={personal}
                  onChange={(event) => {
                    setPersonal(event.target.checked);
                  }}
                />
                <span className="text-caption" style={{ color: 'var(--ink-2)' }}>
                  <strong>Keep this private</strong>: only you will see it. The amount still counts in the household
                  total, shown to everyone else as one figure without the detail.
                </span>
              </label>
            )}

            <p className="note">
              Dates are the calendar day in India, whatever this device is set to. Amounts are stored in paise, in{' '}
              {currency}, exactly as entered.
            </p>
          </div>
        )}
      </form>

      {problem !== null && (
        <div className="mt-3">
          <Problem>{problem}</Problem>
        </div>
      )}
    </section>
  );
}
