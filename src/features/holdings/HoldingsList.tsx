import { useEffect, useRef, useState } from 'react';
import { EARMARK_LABELS, type Earmark } from '../../domain/earmark.ts';
import { hashFor } from '../../app/route.ts';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money, percentOfCost, type Money } from '../../lib/money.ts';
import { AssetTile } from '../../ui/AssetTile.tsx';
import { kindColour, kindLabel } from '../../ui/labels.ts';
import { Amount, Caveat, Delta, Pill, Stat, Unit } from '../../ui/primitives.tsx';
import type { FixedIncomeView } from '../../domain/fixed-income.ts';
import { type Filter, type GroupedHoldings, type Sort } from './holdingGroups.ts';
import { IMPORT_THE_FULL_STATEMENT, RECORD_THE_COST } from './history.ts';

/**
 * The Holdings list: a summary, the filters, and holdings grouped by class (docs/design/holdings.md;
 * docs/design/vibrant-canvas.html, the Holdings boards).
 *
 * Eight holdings took about 6.7 phone screens when every one rendered its full detail inline. A row is one
 * glance now, and the rest is one tap away on the holding's own screen.
 */

/** What a row says under its value: a gain, the reason there is none, or when the reading was taken. */
export type RowGain =
  | { readonly kind: 'gain'; readonly gain: Money; readonly percent: string | null }
  | { readonly kind: 'refused'; readonly short: boolean; readonly missing: boolean }
  | { readonly kind: 'asat'; readonly date: string }
  | { readonly kind: 'none' };

export interface RowModel {
  readonly id: string;
  /** The fund or instrument, the part read first. */
  readonly title: string;
  readonly kind: string;
  readonly member: string;
  /** Units, or terms: the one class-specific fact. */
  readonly fact: string;
  readonly value: Money | null;
  readonly earmark: Earmark;
  readonly isForeign: boolean;
  readonly gain: RowGain;
}

/** The earmark in a word, for the pill beside a name: the label would take the line the name needs. */
const EARMARK_SHORT: Record<Earmark, string> = {
  emergency: 'Emergency',
  retirement: 'Retirement',
  child: 'Child’s',
  house: 'House',
  none: '',
};

/**
 * One row of chips that scrolls sideways (docs/design/vibrant-canvas.html): All, a chip for each class, and, past a
 * hairline, a chip for each earmark (the owner's call on the mock-vs-build review, item 10). The row scrolls inside
 * itself and the page never does, with a fade at the edge that says there is more.
 */
export function Chips({ chips, filter }: { chips: GroupedHoldings['chips']; filter: Filter }) {
  const all = (filter.kind ?? '') === '' && (filter.earmark ?? '') === '';
  const row = useRef<HTMLElement | null>(null);

  // A filter reached by a link (an allocation row on the Overview) can be a chip far along the row: bring it into view
  // inside the row, without moving the page.
  useEffect(() => {
    const nav = row.current;
    const pressed = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (nav === null || nav === undefined || pressed === null || pressed === undefined) return;
    if (pressed.offsetLeft + pressed.offsetWidth > nav.clientWidth) nav.scrollLeft = pressed.offsetLeft - 24;
  }, [filter.kind, filter.earmark]);

  return (
    <nav className="chips" aria-label="Filter holdings" ref={row}>
      <a className="chip" href={hashFor('holdings')} aria-current={all ? 'true' : undefined}>
        All
      </a>
      {chips.kinds.map(({ kind, count }) => (
        <a
          key={kind}
          className="chip"
          href={hashFor('holdings', { kind })}
          aria-current={filter.kind === kind ? 'true' : undefined}
        >
          {kindLabel(kind)} <span className="chip-count">{count}</span>
        </a>
      ))}
      {chips.earmarks.length > 0 && <span className="chip-divider" aria-hidden="true" />}
      {chips.earmarks.map(({ earmark, count }) => (
        <a
          key={earmark}
          className="chip"
          href={hashFor('holdings', { earmark })}
          aria-current={filter.earmark === earmark ? 'true' : undefined}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
            <circle cx="7.5" cy="7.5" r="1" />
          </svg>
          {EARMARK_LABELS[earmark as Earmark]} <span className="chip-count">{count}</span>
        </a>
      ))}
    </nav>
  );
}

/** One currency's figures, as the screen adds them up: a holding nobody has read is absent, not zero. */
export interface CurrencyTotals {
  readonly currency: string;
  readonly value: bigint;
  readonly invested: bigint;
  readonly unread: number;
  /** Valued positions whose cost covers only part of their units. */
  readonly short: number;
  /** Valued positions with no cost recorded. */
  readonly missing: number;
}

/**
 * The summary card, the screen's one lifted surface: what the groups shown add up to, per currency.
 *
 * On All it is the portfolio: the figure, what is held abroad, the return on cost, and the classes as a stacked bar with
 * their shares under it. Filtered to a class or an earmark it is about that: its share of the portfolio, the figure in
 * full, and what is particular to it (a deposit's interest so far and what matures next).
 */
export function Summary({
  grouped,
  base,
  filter,
  privacy,
  totals,
  paidOutFailed,
  action,
  status,
  extra,
}: {
  grouped: GroupedHoldings;
  base: string;
  filter: Filter;
  privacy: boolean;
  totals: readonly CurrencyTotals[];
  paidOutFailed: boolean;
  /** The price fetch, an icon at the card's top right, for a role that can record. */
  action: React.ReactNode;
  /** What the fetch said, or null. */
  status: string | null;
  /** Class-specific figures for a filter (a deposit's interest so far and next maturity), where they exist. */
  extra: React.ReactNode;
}) {
  const filtered = (filter.kind ?? '') !== '' || (filter.earmark ?? '') !== '';
  const own = grouped.totals.find((t) => t.currency === base);
  const abroad = grouped.totals.filter((t) => t.currency !== base);
  const lead = own ?? abroad[0];
  const title = filtered
    ? (filter.kind ?? '') !== ''
      ? kindLabel(filter.kind ?? '')
      : EARMARK_LABELS[(filter.earmark ?? 'none') as Earmark]
    : 'Portfolio';
  // Only the groups shown are summed, so a filtered summary describes the filter; the caveats follow the same set.
  const mine = totals.find((t) => t.currency === (lead?.currency ?? base));
  const whole = lead === undefined ? undefined : grouped.portfolio.find((p) => p.currency === lead.currency);
  const putTogether = (
    <Caveat tone={paidOutFailed ? 'warn' : 'info'} label="How these totals are put together">
      Each currency on its own, never added across. A holding nobody has read is not in these figures at all, because
      counting it as zero would make the total look complete while being short. A deposit or bond that has paid out is
      left out from the day it did.
      {paidOutFailed &&
        ' Deposits and bonds could not be read just now, so one that has paid out may still be counted here. Reload to try again.'}
    </Caveat>
  );

  return (
    <section className="card card-lift" aria-label={title}>
      <div className="summary-head">
        <h2 className="label">{title}</h2>
        {filtered && lead !== undefined && whole !== undefined && whole.value.minor !== 0n ? (
          <span className="note tabular-nums" data-testid="filter-share">
            {((Number(lead.value.minor) / Number(whole.value.minor)) * 100).toFixed(1)}% of{' '}
            <Amount value={whole.value} privacy={privacy} compact />
            {putTogether}
          </span>
        ) : (
          <span className="summary-aside">
            <span className="note">latest readings</span>
            {putTogether}
            {action}
          </span>
        )}
      </div>
      {/* What the price fetch found, on a line of its own: a message beside the icons breaks the header. */}
      {status !== null && (
        <p className="note summary-said" role="status">
          {status}
        </p>
      )}

      <div className="figure mt-1" data-testid="holdings-total">
        {lead !== undefined ? (
          // The portfolio is a hero figure and compact; a class is read to the paisa, as the board draws it.
          <Amount value={lead.value} privacy={privacy} compact={!filtered} />
        ) : (
          <Unit>nothing valued yet</Unit>
        )}
        {lead !== undefined && lead.unvalued > 0 && (
          <Caveat tone="warn" label={`Why this ${lead.currency} total is short`}>
            {lead.unvalued} {lead.unvalued === 1 ? 'holding has' : 'holdings have'} never been valued, so this total is
            short by whatever they are worth. They are absent rather than counted as zero. Record a value on the holding
            and it is counted.
          </Caveat>
        )}
      </div>
      {filtered && <p className="note mt-1">latest readings</p>}

      {!filtered && (
        <p className="summary-line">
          {own !== undefined && abroad.length > 0 ? (
            <span className="note tabular-nums">
              and{' '}
              {abroad.map((t, index) => (
                <span key={t.currency}>
                  {index > 0 && ', '}
                  <Amount value={t.value} privacy={privacy} compact />
                </span>
              ))}{' '}
              abroad
            </span>
          ) : (
            <span />
          )}
          {mine !== undefined && mine.invested > 0n && mine.short === 0 && mine.missing === 0 && (
            <Delta direction={mine.value - mine.invested > 0n ? 'up' : mine.value - mine.invested < 0n ? 'down' : 'flat'}>
              {privacy
                ? formatMoney(money(mine.value - mine.invested, mine.currency), { privacy })
                : `${percentOfCost(mine.value - mine.invested, mine.invested) ?? ''} on cost`}
            </Delta>
          )}
        </p>
      )}
      {mine !== undefined && (mine.short > 0 || mine.missing > 0) && (
        <div className="note mt-2">
          return not shown
          <Caveat tone="warn" label={`Why this ${mine.currency} cost is short`}>
            {mine.short > 0 && (
              <>
                {mine.short === 1 ? 'One position rests on' : `${String(mine.short)} positions rest on`} a statement that
                covers only part of the history, so what was paid for the earlier units is not in this figure.{' '}
              </>
            )}
            {mine.missing > 0 && (
              <>
                {mine.missing === 1 ? 'One holding has' : `${String(mine.missing)} holdings have`} no cost recorded, so
                nothing for {mine.missing === 1 ? 'it is' : 'them is'} in this figure.{' '}
              </>
            )}
            It is the sum of the costs that were recorded, and nothing has been made up to fill the rest.{' '}
            {mine.short > 0 && IMPORT_THE_FULL_STATEMENT} {mine.missing > 0 && RECORD_THE_COST}
          </Caveat>
        </div>
      )}

      {!filtered && own !== undefined && <ClassBar grouped={grouped} base={base} />}
      {extra}
    </section>
  );
}

/**
 * The classes as one bar and a legend, each with its share of the rupee portfolio. The bar is the shares and the legend
 * says them in words, so it is told apart by the word and the figure and not by its colour.
 */
function ClassBar({ grouped, base }: { grouped: GroupedHoldings; base: string }) {
  const parts = grouped.groups
    .map((g) => ({ kind: g.kind, share: g.shares.find((s) => s.currency === base)?.share }))
    .filter((p): p is { kind: string; share: number } => p.share !== undefined && p.share > 0);
  if (parts.length === 0) return null;
  const words = parts.map((p) => `${kindLabel(p.kind)} ${(p.share * 100).toFixed(1)} percent`).join(', ');
  return (
    <div data-testid="class-shares">
      <div className="class-bar" role="img" aria-label={`${words} of the ${base} portfolio`}>
        {parts.map((p) => (
          <span key={p.kind} style={{ background: kindColour(p.kind), flexGrow: p.share }} />
        ))}
      </div>
      <ul className="class-legend">
        {parts.map((p) => (
          <li key={p.kind}>
            <span className="class-swatch" style={{ background: kindColour(p.kind) }} aria-hidden="true" />
            {kindLabel(p.kind)} <span className="tabular-nums">{(p.share * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A deposit filter's own figures: the interest so far, what matures next, and what the terms work it out to today. */
export function FixedExtras({
  rows,
  privacy,
  held,
}: {
  rows: readonly { name: string; view: FixedIncomeView }[];
  privacy: boolean;
  /** How many live deposits the filter holds, with or without terms: the figures below cover only those with terms. */
  held: number;
}) {
  const live = rows.flatMap((r) => (r.view.ok && !r.view.matured ? [{ name: r.name, view: r.view }] : []));
  // Per currency, never added across: paise and cents are not one quantity, and a foreign deposit is not summed into
  // the rupee figure (HD-I2).
  const interestBy = new Map<string, bigint>();
  const workedBy = new Map<string, bigint>();
  for (const r of live) {
    if (r.view.kind !== 'deposit') continue;
    const c = r.view.interestToDate.currency;
    interestBy.set(c, (interestBy.get(c) ?? 0n) + r.view.interestToDate.minor);
    workedBy.set(c, (workedBy.get(c) ?? 0n) + r.view.value.minor);
  }
  const next = live
    .flatMap((r) => (r.view.kind === 'deposit' && r.view.nextMaturity !== null ? [{ name: r.name, on: r.view.nextMaturity, days: r.view.daysToMaturity }] : []))
    .sort((a, b) => (a.on < b.on ? -1 : 1))[0];
  if (interestBy.size === 0 && next === undefined) return null;
  // A deposit entered before there were terms has none to work a value out from, so it is in the total above and not in
  // these. Said where the figures are, or they read as the whole of what the total is made of.
  const termed = live.filter((r) => r.view.kind === 'deposit').length;
  const short = held - termed;
  const coverage =
    short > 0 ? (
      <Caveat tone="warn" label="Which deposits these figures cover">
        {termed} of the {held} deposits here have terms, so these figures cover those {termed}. {short}{' '}
        {short === 1 ? 'has' : 'have'} no terms recorded and {short === 1 ? 'is' : 'are'} in the total above and not in
        these. Record the terms on the holding and {short === 1 ? 'it is' : 'they are'} worked out too.
      </Caveat>
    ) : null;
  return (
    <>
      <dl className="term-stats mt-3" data-testid="fixed-extras">
        {[...interestBy.entries()].map(([currency, minor]) => (
          <Stat key={currency} label={interestBy.size > 1 ? `Interest so far, ${currency}` : 'Interest so far'}>
            {formatMoney(money(minor, currency), { privacy })}
            {coverage}
          </Stat>
        ))}
        {next !== undefined && (
          <Stat label="Next to mature">
            {formatIsoDate(next.on)}
            <span className="note block">
              {next.name}
              {next.days !== null && ` · in ${String(next.days)} days`}
            </span>
          </Stat>
        )}
      </dl>
      {[...workedBy.entries()].map(([currency, minor]) => (
        <p key={currency} className="chart-note" data-testid="worked-out-note">
          <span>
            Worked out today{short > 0 ? ` for the ${String(termed)} with terms` : ''}:{' '}
            <span className="tabular-nums">{formatMoney(money(minor, currency), { privacy })}</span>. Not in net worth
            until it is recorded as a reading.
          </span>
        </p>
      ))}
    </>
  );
}

/**
 * The list's own header (docs/design/vibrant-canvas.html): the title and the count, the sort, an icon to import a
 * statement and the one Add. One Add on the screen (HD-I5), naming the class when the list is filtered to one.
 */
export function ListHeader({
  title,
  count,
  sort,
  onSort,
  canWrite,
  addLabel,
  panel,
  onPanel,
  forClass = false,
}: {
  title: string;
  count: number;
  sort: Sort;
  onSort: (sort: Sort) => void;
  /** Filtered to a class, the header is the board's: the title, the count and the Add; sort and import are on All. */
  forClass?: boolean;
  canWrite: boolean;
  addLabel: string;
  panel: 'add' | 'import' | null;
  onPanel: (panel: 'add' | 'import' | null) => void;
}) {
  return (
    <div className="list-head">
      <h2 className="list-title">{title}</h2>
      <span className="list-count tabular-nums">{count}</span>
      <span className="flex-1" />
      {!forClass && (
        <button
          type="button"
          className="quiet-button"
          aria-label={sort === 'largest' ? 'Sorted largest first. Sort by name.' : 'Sorted by name. Sort largest first.'}
          onClick={() => {
            onSort(sort === 'largest' ? 'name' : 'largest');
          }}
        >
          <span aria-hidden="true">{sort === 'largest' ? '↓ Largest' : 'A–Z Name'}</span>
        </button>
      )}
      {canWrite && (
        <>
          {!forClass && (
          <button
            type="button"
            className="iconbtn list-icon"
            aria-label="Import a statement"
            aria-expanded={panel === 'import'}
            onClick={() => {
              onPanel(panel === 'import' ? null : 'import');
            }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 16V4" />
              <path d="m7 9 5-5 5 5" />
              <path d="M5 21h14" />
            </svg>
          </button>
          )}
          <button
            type="button"
            className="btn btn-primary add-button"
            aria-expanded={panel === 'add'}
            onClick={() => {
              onPanel(panel === 'add' ? null : 'add');
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            {addLabel}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The earmarked emergency fund, under a list of what it is made of: what is set aside and how many holdings it is. The
 * months of cover it gives are worked out on the Overview, from the spending that is recorded there, and this says so
 * and does not guess.
 */
export function EmergencyCard({
  held,
  count,
  unvalued,
  privacy,
}: {
  held: readonly Money[];
  count: number;
  /** How many of them nobody has valued: absent from the sum, and not counted as nothing. */
  unvalued: number;
  privacy: boolean;
}) {
  if (count === 0) return null;
  return (
    <section className="card emergency-card" aria-label="Emergency fund" data-testid="emergency-card">
      <div className="emergency-head">
        <span className="emergency-title">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 3h12v18l-6-4-6 4Z" />
          </svg>
          Emergency fund
        </span>
        <span className="tabular-nums">
          {held.length === 0 ? (
            <Unit>not valued</Unit>
          ) : (
            held.map((amount, index) => (
              <span key={amount.currency}>
                {index > 0 && ', '}
                {formatMoney(amount, { privacy })}
              </span>
            ))
          )}
          {unvalued > 0 && held.length > 0 && (
            <Caveat tone="warn" label="Why this emergency fund total is short">
              {unvalued} of the {count} {count === 1 ? 'holding has' : 'holdings have'} never been valued, so this total is
              short by whatever {unvalued === 1 ? 'it is' : 'they are'} worth. {unvalued === 1 ? 'It is' : 'They are'}{' '}
              absent rather than counted as zero. Record a value on the holding and it is counted.
            </Caveat>
          )}
        </span>
      </div>
      <p className="note">
        {count} {count === 1 ? 'holding' : 'holdings'} earmarked
      </p>
      <p className="note mt-1">
        Months of cover is worked out on the <a href={hashFor('overview')}>Overview</a>, once there are three months of
        spending to measure it against.
      </p>
    </section>
  );
}

export function GroupSection({
  kind,
  count,
  subtotals,
  shares,
  rows,
  privacy,
  base,
  open: initiallyOpen = true,
  label,
  bare = false,
}: {
  kind: string;
  count: number;
  subtotals: readonly Money[];
  shares: readonly { currency: string; share: number }[];
  rows: readonly RowModel[];
  privacy: boolean;
  /** The household's own currency: any other is abroad, and says so where a share would be. */
  base: string;
  open?: boolean;
  /** The heading when it is not a class: "Ended". */
  label?: string;
  /** Rows only, no header: a list filtered to one class already says which, in its own header. */
  bare?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = `group-${label ?? kind}`;
  if (bare) {
    return (
      <section className="card holding-group" aria-label={label ?? kindLabel(kind)}>
        <ul className="holding-rows">
          {rows.map((row) => (
            <ListRow key={row.id} row={row} privacy={privacy} />
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section className="card holding-group" aria-labelledby={id}>
      <button
        type="button"
        className="group-head"
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <span className="group-name" id={id}>
          {label ?? kindLabel(kind)} <span className="chip-count">{count}</span>
        </span>
        {subtotals.length > 0 && (
          <span className="group-figures">
            {subtotals.map((s) => {
              const share = shares.find((sh) => sh.currency === s.currency);
              return (
                <span key={s.currency} className="group-subtotal">
                  <Amount value={s} privacy={privacy} compact />
                  {s.currency !== base ? (
                    <span className="note"> abroad</span>
                  ) : (
                    share !== undefined && <span className="note"> {(share.share * 100).toFixed(1)}%</span>
                  )}
                </span>
              );
            })}
          </span>
        )}
        {label === 'Ended' && <span className="note">sold or matured</span>}
        <svg
          className="group-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="holding-rows">
          {rows.map((row) => (
            <ListRow key={row.id} row={row} privacy={privacy} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ListRow({ row, privacy }: { row: RowModel; privacy: boolean }) {
  return (
    <li className="holding-row">
      <AssetTile kind={row.kind} compact />
      <span className="min-w-0">
        <span className="holding-title">
          <a className="holding-link" href={hashFor('holding', { id: row.id })}>
            <span className="holding-name">{row.title}</span>
          </a>
          {row.earmark !== 'none' && (
            <span role="img" aria-label={`Earmarked: ${EARMARK_LABELS[row.earmark]}`} title={EARMARK_LABELS[row.earmark]}>
              <Pill tone="neutral">{EARMARK_SHORT[row.earmark]}</Pill>
            </span>
          )}
        </span>
        <span className="holding-sub">
          {/* A globe marks a holding that is held abroad, and the word is for a screen reader. */}
          {row.isForeign && (
            <svg
              role="img"
              aria-label="Held abroad"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18" />
              <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
            </svg>
          )}
          <span className="detail-member">{row.member}</span>
          {row.fact !== '' && <> · {row.fact}</>}
        </span>
      </span>
      <span className="holding-figures">
        <span className="holding-value tabular-nums">
          {row.value === null ? <Unit>not valued</Unit> : <Amount value={row.value} privacy={privacy} />}
        </span>
        <GainLine gain={row.gain} privacy={privacy} />
      </span>
    </li>
  );
}

/** Under the value: the gain, or the reason there is none (HD-I3: a refused gain keeps its mark and its reason). */
function GainLine({ gain, privacy }: { gain: RowGain; privacy: boolean }) {
  if (gain.kind === 'gain') {
    const direction = gain.gain.minor > 0n ? 'up' : gain.gain.minor < 0n ? 'down' : 'flat';
    return (
      <Delta direction={direction}>
        {privacy
          ? formatMoney(gain.gain, { privacy })
          : `${gain.gain.minor > 0n ? '+' : ''}${formatMoney(gain.gain)}${gain.percent === null ? '' : ` · ${gain.percent}`}`}
      </Delta>
    );
  }
  if (gain.kind === 'refused') {
    return (
      <span className="holding-reason">
        {gain.short ? 'return not shown' : 'no cost recorded'}
        <Caveat tone="warn" label={gain.short ? 'Why there is no return for this holding' : 'Why there is no cost for this holding'}>
          {gain.short
            ? 'The cost rests on a statement that covers only part of the history, so no return is shown. '
            : 'No cost is recorded, and a cost nobody recorded is not a cost of nothing. '}
          {gain.short ? IMPORT_THE_FULL_STATEMENT : RECORD_THE_COST}
        </Caveat>
      </span>
    );
  }
  if (gain.kind === 'asat') return <span className="holding-reason">as at {formatIsoDate(gain.date)}</span>;
  return null;
}
