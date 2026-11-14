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
import type { Account, Credit, ExpenseListing, Expense as ExpenseRow, Member, Transfer } from '../../repo/types.ts';
import { Pill, Problem } from '../../ui/primitives.tsx';
import { creditLine, kindsFor, LEDGER_FILTERS, mergeByDate, spendingWord, transferLine, type LedgerFilter, type LedgerLine } from '../money/ledgerLines.ts';
import { memberMarks, type MemberMark } from './memberMark.ts';

/** What the Money screen adds to the list: the credits and moves the caller may read, and the accounts they name (ledger-income.md section 1). */
export interface LedgerMoney {
  /** Opens a credit to correct or void. Absent where credits are only read. */
  readonly onEditCredit?: (credit: Credit) => void;
  /** Whether the caller may change this credit, so a line is a button only where it does something. */
  readonly canChangeCredit?: (credit: Credit) => boolean;
  readonly credits: readonly Credit[];
  readonly transfers: readonly Transfer[];
  readonly accounts: readonly Account[];
  /** Whether the credits and moves have been read, are being read, or could not be. */
  readonly status: 'loading' | 'ready' | 'failed';
  readonly onRetry: () => void;
}

type LedgerEntry =
  | { readonly kind: 'spending'; readonly date: string; readonly key: string; readonly expense: ExpenseRow }
  | { readonly kind: 'credit'; readonly date: string; readonly key: string; readonly line: LedgerLine; readonly credit: Credit }
  | { readonly kind: 'move'; readonly date: string; readonly key: string; readonly line: LedgerLine };

/**
 * A line of the ledger wraps instead of squeezing: the name keeps room to read, and the amount, which stays together, drops underneath it
 * when the row is too narrow, as it is at a large text size (ledger-income.md section 9). Nothing here is a fixed height.
 */
const LEDGER_ROW = { flexWrap: 'wrap', rowGap: '0.125rem' } as const;
const LEDGER_NAME = { flex: '1 1 6rem' } as const;
const LEDGER_AMOUNT = { flex: '0 0 auto', marginLeft: 'auto', textAlign: 'right' } as const;

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
  money,
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
  /** Money in and money moved, listed beside the spending. Absent where only spending is shown. */
  money?: LedgerMoney;
}) {
  const [seeAll, setSeeAll] = useState(false);
  const [filter, setFilter] = useState<LedgerFilter>('all');
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

  const all = useMemo((): LedgerEntry[] => {
    const spending = (expenses: readonly ExpenseRow[]): LedgerEntry[] =>
      expenses.map((expense) => ({ kind: 'spending', date: expense.date, key: `e-${expense.id}`, expense }));
    if (uncategorisedIn !== null) {
      return spending(
        listing.expenses.filter(
          (expense) => expense.categoryId === null && !expense.isVoided && expense.date >= uncategorisedIn.start && expense.date <= uncategorisedIn.end,
        ),
      );
    }
    if (money === undefined) return spending(listing.expenses);
    const kinds = kindsFor(filter);
    const context = { accounts: money.accounts, members: listing.members, viewerMemberId: listing.viewer.memberId, privacy };
    const entries: LedgerEntry[] = [];
    if (kinds.includes('spending')) entries.push(...spending(listing.expenses));
    if (kinds.includes('credit')) {
      for (const credit of money.credits) {
        entries.push({ kind: 'credit', date: credit.date, key: `c-${credit.id}`, line: creditLine(credit, context), credit });
      }
    }
    if (kinds.includes('move')) {
      for (const transfer of money.transfers) entries.push({ kind: 'move', date: transfer.date, key: `t-${transfer.id}`, line: transferLine(transfer, context) });
    }
    return mergeByDate(entries);
  }, [listing.expenses, listing.members, listing.viewer.memberId, uncategorisedIn, money, filter, privacy]);
  const expanded = seeAll || onlyUncategorised;
  const shown = expanded ? all : all.slice(0, FIRST);

  const days = useMemo(() => {
    const out: { date: string; rows: LedgerEntry[] }[] = [];
    for (const entry of shown) {
      const last = out[out.length - 1];
      if (last !== undefined && last.date === entry.date) last.rows.push(entry);
      else out.push({ date: entry.date, rows: [entry] });
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

      {money !== undefined && !onlyUncategorised && (
        <div className="qa-chips" role="group" aria-label="Show">
          {LEDGER_FILTERS.map((each) => (
            <button
              key={each.id}
              type="button"
              className="qa-chip"
              aria-pressed={filter === each.id}
              onClick={() => {
                setFilter(each.id);
              }}
            >
              {each.label}
            </button>
          ))}
        </div>
      )}

      {money?.status === 'failed' && !onlyUncategorised && (
        <div className="mb-1 flex flex-wrap items-center gap-x-3">
          <Problem>Money in could not be read, so it is not listed.</Problem>
          <button type="button" className="disclosure" onClick={money.onRetry}>
            Try again
          </button>
        </div>
      )}

      {all.length === 0 ? (
        <p className="note">
          {onlyUncategorised
            ? 'Every entry in this period has a category.'
            : money?.status === 'loading'
              ? 'Reading…'
              : filter !== 'all'
                ? 'Nothing of this kind yet.'
                : money === undefined
                  ? 'Nothing recorded yet. The first amount you add above will appear here, and on any other device signed in to this household.'
                  : 'Nothing recorded yet. The first amount you add above will appear here.'}
        </p>
      ) : (
        days.map((day) => (
          <div key={day.date} className="recent-dayblock">
            <h3 className="recent-day">{dayLabel(day.date, today)}</h3>
            <ul className="recent-rows">
              {day.rows.map((entry) =>
                entry.kind === 'spending' ? (
                  <Entry
                    key={entry.key}
                    expense={entry.expense}
                    mark={marks.get(entry.expense.member.id) ?? FALLBACK_MARK}
                    categoryName={entry.expense.categoryId === null ? null : (categoryNames.get(entry.expense.categoryId) ?? null)}
                    privacy={privacy}
                    onEdit={onEdit}
                    ledger={money !== undefined}
                  />
                ) : (
                  <LedgerRow
                    key={entry.key}
                    line={entry.line}
                    direction={entry.kind === 'credit' ? 'in' : 'move'}
                    onEdit={
                      entry.kind === 'credit' && money?.onEditCredit !== undefined && money.canChangeCredit?.(entry.credit) === true
                        ? () => {
                            money.onEditCredit?.(entry.credit);
                          }
                        : null
                    }
                  />
                ),
              )}
            </ul>
          </div>
        ))
      )}

      {/* The board's state 6: what the list cannot show is said, so the In filter is not read as the household's income. */}
      {money !== undefined && !onlyUncategorised && (filter === 'all' || filter === 'in') && listing.members.filter((member) => !member.isArchived).length > 1 && (
        <p className="note mt-2">Credits another member keeps private are not listed here.</p>
      )}
    </section>
  );
}

/**
 * A line of money in, or of money moved: an arrow, a name, the second line, the signed amount and a word for what it does to the month.
 * Direction is a sign and a word as well as the arrow, and never a colour alone (LI-I16). A credit the viewer may change is a button that opens
 * it to correct or void; a move, a voided credit and another member's credit for a contributor are plain lines.
 */
function LedgerRow({ line, direction, onEdit }: { line: LedgerLine; direction: 'in' | 'move'; onEdit: (() => void) | null }) {
  const struck = line.voided ? 'line-through' : undefined;
  // Teal is the third signal for money in, after the sign and the word (the board); a move stays neutral.
  const tone = direction === 'in' && !line.voided ? { color: 'var(--teal)' } : undefined;
  const Row = onEdit === null ? 'div' : 'button';
  return (
    <li {...(onEdit === null ? { 'aria-label': line.name } : {})}>
      <Row
        className="recent-row"
        style={LEDGER_ROW}
        {...(onEdit === null ? {} : { type: 'button' as const, 'aria-label': `Change ${line.name}`, onClick: onEdit })}
      >
        <DirectionTile direction={direction} />
        <span className="recent-main" style={LEDGER_NAME}>
          <span className="recent-payee" style={{ textDecoration: struck }}>
            {line.title}
          </span>
          {line.private && (
            <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--ink-2)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
            </span>
          )}
          <span className="recent-meta" style={{ flexBasis: '100%' }}>
            <span>{line.sub}</span>
            {line.voided && <Pill tone="due">Voided</Pill>}
          </span>
        </span>
        <span className="recent-amount tabular-nums" style={LEDGER_AMOUNT}>
          <span style={{ textDecoration: struck, ...tone }}>{line.amount}</span>
          <span className="note block" style={{ fontWeight: 400, whiteSpace: 'normal' }}>
            {line.word}
          </span>
        </span>
      </Row>
    </li>
  );
}

/**
 * The direction of a line of the ledger in a round tile, as the board draws it: an arrow in, an arrow out, or two arrows for a move. The
 * arrow is the second signal after the sign and the word; the tile's colour is the third and is never the only one (LI-I16).
 */
function DirectionTile({ direction }: { direction: 'in' | 'out' | 'move' }) {
  const path =
    direction === 'in' ? 'M17 7 7 17M7 8v9h9' : direction === 'out' ? 'M7 17 17 7M8 7h9v9' : 'M7 8h13M16 4l4 4-4 4M17 16H4M8 12l-4 4 4 4';
  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: 'center',
        background: 'var(--surface-2)',
        borderRadius: '999px',
        color: direction === 'in' ? 'var(--teal)' : 'var(--ink-2)',
        display: 'inline-flex',
        flexShrink: 0,
        height: '1.875rem',
        justifyContent: 'center',
        width: '1.875rem',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </span>
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
  ledger = false,
}: {
  expense: ExpenseRow;
  mark: MemberMark;
  /** Null for an uncategorised entry: "a state to show, not a gap to fill in". */
  categoryName: string | null;
  privacy: boolean;
  onEdit: ((expense: ExpenseRow) => void) | null;
  /** The row is a line of the ledger beside money in: it has the ledger's arrow, sign and word (LI-I16). */
  ledger?: boolean;
}) {
  const said = spendingWord(expense.isVoided);
  // A voided entry is struck through and says Voided: not dimmed, which put its figures under 4.5:1 and left the
  // meaning to a lighter shade.
  const struck = expense.isVoided ? 'line-through' : undefined;
  const editable = onEdit !== null && !expense.isVoided;

  const inner = (
    <>
      {ledger && <DirectionTile direction="out" />}
      <span className="recent-main" style={ledger ? LEDGER_NAME : undefined}>
        <span className="recent-payee" style={{ textDecoration: struck }}>
          {expense.payee ?? <span className="note">No payee</span>}
        </span>
        <span className="recent-meta" style={ledger ? { flexBasis: '100%' } : undefined}>
          <span>{categoryName ?? 'Uncategorised'}</span>
          <MemberTag member={expense.member} mark={mark} />
          {expense.amount.currency !== 'INR' && <Pill tone="neutral">{expense.amount.currency}</Pill>}
          {expense.isVoided && <Pill tone="due">Voided</Pill>}
          {/* Nobody typed this one: a recurring rule made it on its due day. */}
          {expense.capturedVia === 'rule' && <Pill tone="neutral">Recurring</Pill>}
          {/*
            A row reaching this screen at all means the caller may read it, so a personal one here is always the
            caller's own. "A privacy control nobody can observe working is indistinguishable from one that does
            nothing" (§20): this is where it is observed.
          */}
          {expense.visibility === 'personal' && <Pill tone="own">Private</Pill>}
        </span>
      </span>
      {ledger ? (
        <span className="recent-amount tabular-nums" style={LEDGER_AMOUNT}>
          <span style={{ textDecoration: struck }}>
            {said.sign}
            {formatMoney(expense.amount, { privacy })}
          </span>
          <span className="note block" style={{ fontWeight: 400, whiteSpace: 'normal' }}>
            {said.word}
          </span>
        </span>
      ) : (
        <span className="recent-amount tabular-nums" style={{ textDecoration: struck }}>
          {formatMoney(expense.amount, { privacy })}
        </span>
      )}
    </>
  );

  return (
    <li>
      {editable ? (
        <button
          type="button"
          className="recent-row"
          style={ledger ? LEDGER_ROW : undefined}
          aria-label={`Edit ${expense.payee ?? 'this entry'}, ${formatIsoDate(expense.date)}${ledger ? `, ${said.word}` : ''}`}
          onClick={() => {
            onEdit(expense);
          }}
        >
          {inner}
        </button>
      ) : (
        <div className="recent-row" style={ledger ? LEDGER_ROW : undefined}>
          {inner}
        </div>
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
