import { useState } from 'react';
import { EARMARK_LABELS, type Earmark } from '../../domain/earmark.ts';
import { hashFor } from '../../app/route.ts';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money, percentOfCost, type Money } from '../../lib/money.ts';
import { AssetTile } from '../../ui/AssetTile.tsx';
import { kindLabel } from '../../ui/labels.ts';
import { Amount, Card, Caveat, Delta, Pill, Stat, Unit } from '../../ui/primitives.tsx';
import type { FixedIncomeView } from '../../domain/fixed-income.ts';
import { type Filter, type GroupedHoldings } from './holdingGroups.ts';
import { IMPORT_THE_FULL_STATEMENT, RECORD_THE_COST } from './history.ts';

/**
 * The Holdings list: a summary, the filters, and holdings grouped by class (docs/design/holdings.md).
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

export function Chips({ chips, filter }: { chips: GroupedHoldings['chips']; filter: Filter }) {
  const all = (filter.kind ?? '') === '' && (filter.earmark ?? '') === '';
  return (
    <nav className="chips" aria-label="Filter holdings">
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

/** The summary card, the screen's one lifted surface: what the groups shown add up to, per currency. */
export function Summary({
  grouped,
  base,
  filter,
  privacy,
  totals,
  paidOutFailed,
  extra,
}: {
  grouped: GroupedHoldings;
  base: string;
  filter: Filter;
  privacy: boolean;
  totals: readonly CurrencyTotals[];
  paidOutFailed: boolean;
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

  return (
    <Card
      lift
      title={title}
      aside={
        <span className="flex items-center gap-2.5">
          <span className="note">latest readings</span>
          <Caveat tone={paidOutFailed ? 'warn' : 'info'} label="How these totals are put together">
            Each currency on its own, never added across. A holding nobody has read is not in these figures at all,
            because counting it as zero would make the total look complete while being short. A deposit or bond that has
            paid out is left out from the day it did.
            {paidOutFailed &&
              ' Deposits and bonds could not be read just now, so one that has paid out may still be counted here. Reload to try again.'}
          </Caveat>
        </span>
      }
    >
      <div className="figure" data-testid="holdings-total">
        {lead !== undefined ? <Amount value={lead.value} privacy={privacy} compact /> : <Unit>nothing valued yet</Unit>}
        {lead !== undefined && lead.unvalued > 0 && (
          <Caveat tone="warn" label={`Why this ${lead.currency} total is short`}>
            {lead.unvalued} {lead.unvalued === 1 ? 'holding has' : 'holdings have'} never been valued, so this total is
            short by whatever they are worth. They are absent rather than counted as zero. Record a value on the holding
            and it is counted.
          </Caveat>
        )}
      </div>
      {filtered && lead !== undefined && (
        <p className="note mt-1" data-testid="filter-share">
          {ShareOfPortfolio(lead, grouped)}
        </p>
      )}
      {own !== undefined && abroad.length > 0 && (
        <p className="note mt-1">
          and{' '}
          {abroad.map((t, index) => (
            <span key={t.currency}>
              {index > 0 && ', '}
              <Amount value={t.value} privacy={privacy} compact />
            </span>
          ))}{' '}
          abroad
        </p>
      )}
      {mine !== undefined && mine.invested > 0n && mine.short === 0 && mine.missing === 0 && (
        <p className="mt-2">
          <Delta direction={mine.value - mine.invested > 0n ? 'up' : mine.value - mine.invested < 0n ? 'down' : 'flat'}>
            {privacy
              ? formatMoney(money(mine.value - mine.invested, mine.currency), { privacy })
              : `${percentOfCost(mine.value - mine.invested, mine.invested) ?? ''} on cost`}
          </Delta>
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
      {!filtered && own !== undefined && (
        <p className="note mt-2" data-testid="class-shares">
          {GroupShares(grouped, base)}
        </p>
      )}
      {extra}
    </Card>
  );
}

/** A deposit filter's own figures: the interest so far, and what matures next. */
export function FixedExtras({
  rows,
  privacy,
}: {
  rows: readonly { name: string; view: FixedIncomeView }[];
  privacy: boolean;
}) {
  const live = rows.flatMap((r) => (r.view.ok && !r.view.matured ? [{ name: r.name, view: r.view }] : []));
  // Per currency, never added across: paise and cents are not one quantity, and a foreign deposit is not summed into
  // the rupee figure (HD-I2).
  const interestBy = new Map<string, bigint>();
  for (const r of live) {
    if (r.view.kind !== 'deposit') continue;
    const c = r.view.interestToDate.currency;
    interestBy.set(c, (interestBy.get(c) ?? 0n) + r.view.interestToDate.minor);
  }
  const next = live
    .flatMap((r) => (r.view.kind === 'deposit' && r.view.nextMaturity !== null ? [{ name: r.name, on: r.view.nextMaturity, days: r.view.daysToMaturity }] : []))
    .sort((a, b) => (a.on < b.on ? -1 : 1))[0];
  if (interestBy.size === 0 && next === undefined) return null;
  return (
    <dl className="mt-3 flex flex-wrap gap-x-9 gap-y-2.5" data-testid="fixed-extras">
      {[...interestBy.entries()].map(([currency, minor]) => (
        <Stat key={currency} label={interestBy.size > 1 ? `Interest so far, ${currency}` : 'Interest so far'}>
          {formatMoney(money(minor, currency), { privacy })}
        </Stat>
      ))}
      {next !== undefined && (
        <Stat label="Next to mature">
          {formatIsoDate(next.on)}{' '}
          <span className="note">
            {next.name}
            {next.days !== null && ` · in ${String(next.days)} days`}
          </span>
        </Stat>
      )}
    </dl>
  );
}

function ShareOfPortfolio(
  lead: GroupedHoldings['totals'][number],
  grouped: GroupedHoldings,
): React.ReactNode {
  const whole = grouped.portfolio.find((p) => p.currency === lead.currency);
  if (whole === undefined || whole.value.minor === 0n) return null;
  const share = (Number(lead.value.minor) / Number(whole.value.minor)) * 100;
  return `${share.toFixed(1)}% of the ${lead.currency} portfolio`;
}

function GroupShares(grouped: GroupedHoldings, base: string): string {
  return grouped.groups
    .map((g) => ({ g, share: g.shares.find((s) => s.currency === base)?.share }))
    .filter((entry): entry is { g: (typeof grouped.groups)[number]; share: number } => entry.share !== undefined)
    .map(({ g, share }) => `${kindLabel(g.kind)} ${(share * 100).toFixed(1)}%`)
    .join(' · ');
}

export function GroupSection({
  kind,
  count,
  subtotals,
  shares,
  rows,
  privacy,
  open: initiallyOpen = true,
  label,
}: {
  kind: string;
  count: number;
  subtotals: readonly Money[];
  shares: readonly { currency: string; share: number }[];
  rows: readonly RowModel[];
  privacy: boolean;
  open?: boolean;
  /** The heading when it is not a class: "Ended". */
  label?: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = `group-${label ?? kind}`;
  return (
    <section className="holding-group" aria-labelledby={id}>
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
            {subtotals.map((s) => (
              <span key={s.currency} className="group-subtotal">
                <Amount value={s} privacy={privacy} compact />
                {shares.find((sh) => sh.currency === s.currency) !== undefined && (
                  <span className="note">
                    {' '}
                    {((shares.find((sh) => sh.currency === s.currency)?.share ?? 0) * 100).toFixed(1)}%
                  </span>
                )}
              </span>
            ))}
          </span>
        )}
        {label === 'Ended' && <span className="note">sold or matured</span>}
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
        <a className="holding-link" href={hashFor('holding', { id: row.id })}>
          <span className="holding-name">{row.title}</span>
        </a>
        <span className="holding-sub">
          {row.member}
          {row.fact !== '' && <> · {row.fact}</>}
          {row.earmark !== 'none' && <Pill tone="neutral">{EARMARK_LABELS[row.earmark]}</Pill>}
          {row.isForeign && <Pill tone="own">Abroad</Pill>}
        </span>
      </span>
      <span className="holding-figures">
        <span className="holding-value num">
          {row.value === null ? <Unit>not valued</Unit> : <Amount value={row.value} privacy={privacy} compact />}
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
          : `${gain.gain.minor > 0n ? '+' : ''}${formatMoney(gain.gain, { compact: true })}${gain.percent === null ? '' : ` · ${gain.percent}`}`}
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
