/**
 * Recent entries, a day at a time.
 *
 * The artboard's list (docs/design/vibrant-canvas.html, Expenses): grouped under Today and Yesterday, each row a
 * payee, its category and whose it is, and the amount, with "See all" at the head. A row is one tap target that
 * opens the entry to correct it; an entry that has been voided is the end of a row's life and is not one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { daysBetween, formatIsoDate } from '../../lib/dates.ts';
import { formatMoney } from '../../lib/money.ts';
import type { LiveStatus } from '../../repo/expenses.ts';
import type { ExpenseListing, Expense as ExpenseRow, Member } from '../../repo/types.ts';
import { Pill } from '../../ui/primitives.tsx';
import { memberMarks, type MemberMark } from './memberMark.ts';

/** For an entry whose member is somehow not in the list: the mark still says something. */
const FALLBACK_MARK: MemberMark = { text: '?', showName: true };

/** How many entries are shown before "See all". */
const FIRST = 6;

function dayLabel(date: string, today: string): string {
  const ago = daysBetween(date, today);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return formatIsoDate(date);
}

export function RecentList({
  listing,
  today,
  privacy,
  refreshing,
  live,
  liveDetail,
  onEdit,
  uncategorisedIn,
  onShowAll,
}: {
  listing: ExpenseListing;
  today: string;
  privacy: boolean;
  refreshing: boolean;
  live: LiveStatus;
  liveDetail: string | null;
  /** Null for a viewer, who may read every entry and correct none. */
  onEdit: ((expense: ExpenseRow) => void) | null;
  /** Only entries with no category, in this period: where "File them" on the plan leads. Null for the ordinary list. */
  uncategorisedIn: { start: string; end: string } | null;
  /** Leave the uncategorised view. */
  onShowAll: () => void;
}) {
  const [seeAll, setSeeAll] = useState(false);
  const onlyUncategorised = uncategorisedIn !== null;

  // Tapping File them changes a list that may be off the screen, and focus is left on the button. Bring the list
  // into view and put focus on its heading, so the change is seen and announced.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!onlyUncategorised) return;
    heading.current?.scrollIntoView({ block: 'start' });
    heading.current?.focus();
  }, [onlyUncategorised]);

  // A member is an initial in a ring of their colour; two that collide grow to
  // two letters, and the name comes back only where letters cannot separate them.
  const marks = useMemo(() => memberMarks(listing.members), [listing.members]);

  // Resolved once for the whole list rather than searched per row: a category
  // is referenced by id everywhere because "renaming a category changes the
  // label only", so the name has to be looked up somewhere.
  const categoryNames = useMemo(
    () => new Map(listing.categories.map((category) => [category.id, category.name])),
    [listing.categories],
  );

  const all = useMemo(
    () =>
      uncategorisedIn === null
        ? listing.expenses
        : listing.expenses.filter(
            (expense) =>
              expense.categoryId === null &&
              !expense.isVoided &&
              expense.date >= uncategorisedIn.start &&
              expense.date <= uncategorisedIn.end,
          ),
    [listing.expenses, uncategorisedIn],
  );
  const expanded = seeAll || onlyUncategorised;
  const shown = expanded ? all : all.slice(0, FIRST);

  const days = useMemo(() => {
    const out: { date: string; rows: ExpenseRow[] }[] = [];
    for (const expense of shown) {
      const last = out[out.length - 1];
      if (last !== undefined && last.date === expense.date) last.rows.push(expense);
      else out.push({ date: expense.date, rows: [expense] });
    }
    return out;
  }, [shown]);

  return (
    <section className="card" aria-label="Recent expenses">
      <header className="mb-1 flex items-baseline justify-between gap-2">
        <h2 ref={heading} tabIndex={-1} className="card-title font-sans">
          {onlyUncategorised ? 'Not filed yet' : 'Recent'}
        </h2>
        <span className="flex items-center gap-2.5">
          <LiveStatusNote live={live} liveDetail={liveDetail} />
          <span className="note" aria-live="polite">
            {refreshing ? 'Updating…' : null}
          </span>
          {onlyUncategorised ? (
            <button type="button" className="disclosure" onClick={onShowAll}>
              Show all
            </button>
          ) : (
            all.length > FIRST && (
              <button
                type="button"
                className="disclosure"
                aria-expanded={seeAll}
                onClick={() => {
                  setSeeAll((was) => !was);
                }}
              >
                {seeAll ? 'Show fewer' : 'See all'}
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
                  style={{ transform: seeAll ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            )
          )}
        </span>
      </header>

      {all.length === 0 ? (
        <p className="note">
          {onlyUncategorised
            ? 'Every entry in this period has a category.'
            : 'Nothing recorded yet. The first amount you add above will appear here, and on any other device signed in to this household.'}
        </p>
      ) : (
        days.map((day) => (
          <div key={day.date}>
            <h3 className="recent-day">{dayLabel(day.date, today)}</h3>
            <ul className="recent-rows">
              {day.rows.map((expense) => (
                <Entry
                  key={expense.id}
                  expense={expense}
                  mark={marks.get(expense.member.id) ?? FALLBACK_MARK}
                  categoryName={expense.categoryId === null ? null : (categoryNames.get(expense.categoryId) ?? null)}
                  privacy={privacy}
                  onEdit={onEdit}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/**
 * Whether this screen is actually live, said only when it is not.
 *
 * Shown rather than assumed: a channel that never joined behaves exactly like one with nothing to report, so
 * without this the list silently goes stale and a figure entered on another device never arrives. When it is
 * live there is nothing to say.
 */
function LiveStatusNote({ live, liveDetail }: { live: LiveStatus; liveDetail: string | null }) {
  if (live === 'live') return null;
  if (live === 'connecting') return <Pill tone="neutral">Connecting</Pill>;
  return (
    <span title={liveDetail ?? 'The change stream did not connect.'}>
      <Pill tone="due">Not live</Pill>
    </span>
  );
}

function Entry({
  expense,
  mark,
  categoryName,
  privacy,
  onEdit,
}: {
  expense: ExpenseRow;
  mark: MemberMark;
  /** Null for an uncategorised entry: "a state to show, not a gap to fill in". */
  categoryName: string | null;
  privacy: boolean;
  onEdit: ((expense: ExpenseRow) => void) | null;
}) {
  // A voided entry is struck through and says Voided: not dimmed, which put its figures under 4.5:1 and left the
  // meaning to a lighter shade.
  const struck = expense.isVoided ? 'line-through' : undefined;
  const editable = onEdit !== null && !expense.isVoided;

  const inner = (
    <>
      <span className="recent-main">
        <span className="recent-payee" style={{ textDecoration: struck }}>
          {expense.payee ?? <span className="note">No payee</span>}
        </span>
        <span className="recent-meta">
          <span>{categoryName ?? 'Uncategorised'}</span>
          <MemberTag member={expense.member} mark={mark} />
          {expense.amount.currency !== 'INR' && <Pill tone="neutral">{expense.amount.currency}</Pill>}
          {expense.isVoided && <Pill tone="due">Voided</Pill>}
          {/*
            A row reaching this screen at all means the caller may read it, so a personal one here is always the
            caller's own. "A privacy control nobody can observe working is indistinguishable from one that does
            nothing" (§20): this is where it is observed.
          */}
          {expense.visibility === 'personal' && <Pill tone="own">Private</Pill>}
        </span>
      </span>
      <span className="recent-amount tabular-nums" style={{ textDecoration: struck }}>
        {formatMoney(expense.amount, { privacy })}
      </span>
    </>
  );

  return (
    <li>
      {editable ? (
        <button
          type="button"
          className="recent-row"
          aria-label={`Edit ${expense.payee ?? 'this entry'}, ${formatIsoDate(expense.date)}`}
          onClick={() => {
            onEdit(expense);
          }}
        >
          {inner}
        </button>
      ) : (
        <div className="recent-row">{inner}</div>
      )}
    </li>
  );
}

/**
 * Whose entry it is: the member's initials in a ring of their colour.
 *
 * The initial is text, so ownership is not carried by colour alone, and the full name is the accessible name and
 * the tooltip. Where two members share an initial the ones that collide grow to two letters, and only where even
 * that does not separate them is the name shown as well (see memberMark.ts).
 */
function MemberTag({ member, mark }: { member: Member; mark: MemberMark }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="member-mark"
        role="img"
        aria-label={member.displayName}
        title={member.displayName}
        style={{ borderColor: `var(--${member.colour})` }}
      >
        {mark.text}
      </span>
      {mark.showName && <span style={{ color: 'var(--ink-2)' }}>{member.displayName}</span>}
      {member.isArchived && <Pill tone="neutral">Archived</Pill>}
    </span>
  );
}
