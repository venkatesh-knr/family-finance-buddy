/**
 * Holdings as tabs, All first (docs/design/simple-layout.md section 2; the HoldingsTabsAll and HoldingsTabGold boards).
 *
 * The strip is a navigation of links, one for All and one for each class the household holds, in the order of their value, with
 * `aria-current="page"` on the active one: each tab is a different address (`#/holdings?kind=gold`), so Back undoes it (HD-I4), and an
 * ARIA tablist, which promises panels that are not there, is not used. The active tab is always scrolled into view (SL-I2).
 *
 * All is the whole picture: the total, what was invested and the gain, one row per class, and what is set aside. A class tab is that
 * class: its value, what explains it, its holdings. One Add floats above the bottom bar, named for the tab (HD-I5).
 */

import { useEffect, useRef, useState } from 'react';
import { hashFor } from '../../app/route.ts';
import { EARMARK_LABELS, type Earmark } from '../../domain/earmark.ts';
import { formatGrams, latestRate, type GoldRate, type Purity } from '../../domain/gold.ts';
import { formatIsoDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney, money, type Money } from '../../lib/money.ts';
import { AssetTile } from '../../ui/AssetTile.tsx';
import { kindLabel } from '../../ui/labels.ts';
import { Chevron } from '../../ui/primitives.tsx';
import type { GroupedHoldings, Sort } from './holdingGroups.ts';
import { IBJA_URL, RateForm } from './PhysicalGold.tsx';
import type { HoldingRow } from './useHoldings.ts';

/** The tab strip: All, then a tab for each class held. A tab for a class nobody holds is not drawn (SL-I2). */
export function TabStrip({ kinds, current }: { kinds: readonly string[]; current: string | null }) {
  const nav = useRef<HTMLElement | null>(null);

  // The active tab is always in view: a class reached by a link can be far along a strip that scrolls sideways.
  useEffect(() => {
    const strip = nav.current;
    const active = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (strip === null || strip === undefined || active === null || active === undefined) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 16);
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth + 16;
  }, [current, kinds.length]);

  return (
    <nav className="tabs" aria-label="Holdings by class" ref={nav}>
      <a className="tab" href={hashFor('holdings')} aria-current={current === '' ? 'page' : undefined}>
        All
      </a>
      {kinds.map((kind) => (
        <a key={kind} className="tab" href={hashFor('holdings', { kind })} aria-current={current === kind ? 'page' : undefined}>
          {kindLabel(kind)}
        </a>
      ))}
    </nav>
  );
}

/** A row that opens something: the whole row is the target, with a chevron at its right edge (simple-layout.md section 1). */
function OpenRow({ href, tile, title, sub, value }: { href: string; tile: React.ReactNode; title: string; sub: string; value: React.ReactNode }) {
  return (
    <a className="flat-row" href={href}>
      {tile}
      <span className="flat-row-main">
        <span className="flat-row-title">{title}</span>
        <span className="note">{sub}</span>
      </span>
      <span className="flat-row-value tabular-nums">{value}</span>
      <span className="flat-row-chevron" aria-hidden="true">
        <Chevron />
      </span>
    </a>
  );
}

function amounts(values: readonly Money[], privacy: boolean): string {
  return values.length === 0 ? 'not valued' : values.map((value) => formatMoney(value, { privacy })).join(' + ');
}

/** All: one row per class, each opening that class's tab. */
export function ByClass({ grouped, base, privacy }: { grouped: GroupedHoldings; base: string; privacy: boolean }) {
  const count = grouped.groups.reduce((sum, group) => sum + group.holdings.length, 0);
  if (grouped.groups.length === 0) return null;
  return (
    <section className="card" aria-label="By class" data-testid="by-class">
      <div className="section-head">
        <h2 className="label">By class</h2>
        <span className="note tabular-nums">
          {count} {count === 1 ? 'holding' : 'holdings'}
        </span>
      </div>
      <ul className="flat-rows">
        {grouped.groups.map((group) => {
          const share = group.shares.find((entry) => entry.currency === base)?.share;
          const n = group.holdings.length;
          return (
            <li key={group.kind}>
              <OpenRow
                href={hashFor('holdings', { kind: group.kind })}
                tile={<AssetTile kind={group.kind} />}
                title={kindLabel(group.kind)}
                sub={`${String(n)} ${n === 1 ? 'holding' : 'holdings'}${share === undefined ? '' : ` · ${(share * 100).toFixed(1)}%`}`}
                value={amounts(group.subtotals, privacy)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface SetAsideItem {
  readonly earmark: Earmark;
  readonly count: number;
  readonly held: readonly Money[];
}

/** All: what is set aside for something, each a row that opens the holdings it covers (earmarks are on All, not tabs of their own). */
export function SetAside({ items, privacy }: { items: readonly SetAsideItem[]; privacy: boolean }) {
  if (items.length === 0) return null;
  return (
    <section className="card" aria-label="Set aside" data-testid="set-aside">
      <div className="section-head">
        <h2 className="label">Set aside</h2>
      </div>
      <ul className="flat-rows">
        {items.map((item) => (
          <li key={item.earmark}>
            <OpenRow
              href={hashFor('holdings', { earmark: item.earmark })}
              tile={null}
              title={item.earmark === 'emergency' ? 'Household emergency fund' : EARMARK_LABELS[item.earmark]}
              sub={`${String(item.count)} ${item.count === 1 ? 'holding' : 'holdings'}`}
              value={amounts(item.held, privacy)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The list header on a class or an earmark: its title, how many, and the sort. */
export function ClassHeader({ title, count, sort, onSort }: { title: string; count: number; sort: Sort; onSort: (sort: Sort) => void }) {
  return (
    <div className="section-head">
      <h2 className="label">
        {title} <span className="tabular-nums">{count}</span>
      </h2>
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
    </div>
  );
}

/** The one Add on the screen, a pill above the bottom bar, named for the tab: Add a holding on All, Add gold on Gold (HD-I5). */
export function FloatingAdd({ label, expanded, onClick }: { label: string; expanded: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-primary floating-add" aria-expanded={expanded} onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
      {label}
    </button>
  );
}

/**
 * The Gold tab's facts (gold.md section 3): the physical gold held and its purity, the rate for each purity and the day it was typed, a
 * link to IBJA's published rate and, for an owner or a partner, a way to type a newer one. Nothing is fetched.
 */
export function GoldFacts({
  rows,
  rates,
  today,
  householdId,
  mayTypeRate,
  onChanged,
}: {
  rows: readonly HoldingRow[];
  rates: readonly GoldRate[] | null;
  today: IsoDate;
  householdId: string;
  mayTypeRate: boolean;
  onChanged: () => Promise<void>;
}) {
  const [typing, setTyping] = useState<Purity | null>(null);
  const grams = new Map<Purity, bigint>();
  for (const row of rows) {
    const instrument = row.holding.instrument;
    if (instrument.kind !== 'gold' || instrument.goldForm !== 'physical' || instrument.goldPurity === null || row.unitsHeld === 0n) continue;
    grams.set(instrument.goldPurity, (grams.get(instrument.goldPurity) ?? 0n) + row.unitsHeld);
  }
  if (grams.size === 0) return null;

  return (
    <section className="card" aria-label="Gold rate" data-testid="gold-facts">
      <ul className="flat-rows">
        {[...grams.entries()].map(([purity, held]) => {
          const label = purity.toUpperCase();
          const rate = rates === null ? null : latestRate(rates, purity, today);
          return (
            <li key={purity} className="flat-fact">
              <span>
                Physical gold <span className="tabular-nums">{formatGrams(held)} g</span> · {label}
              </span>
              <span className="note">
                {rate === null
                  ? `no ${label} rate typed yet`
                  : `${label} at ${formatMoney(money(rate.perGramMinor, rate.currency))} a gram, typed ${formatIsoDate(rate.asOf)}`}
              </span>
              <span className="flat-fact-actions">
                {mayTypeRate && (
                  <button
                    type="button"
                    className="flat-link"
                    aria-expanded={typing === purity}
                    onClick={() => {
                      setTyping((was) => (was === purity ? null : purity));
                    }}
                  >
                    {typing === purity ? 'Cancel' : `Update the ${label} rate`}
                  </button>
                )}
              </span>
              {mayTypeRate && typing === purity && (
                <RateForm
                  householdId={householdId}
                  purity={purity}
                  today={today}
                  onDone={async () => {
                    setTyping(null);
                    await onChanged();
                  }}
                />
              )}
            </li>
          );
        })}
        <li className="flat-fact">
          {/* A plain link to the published rate: nothing of the household's goes in it, and nothing is fetched from it. */}
          <a className="flat-link" href={IBJA_URL} target="_blank" rel="noopener noreferrer">
            Today&rsquo;s rate on IBJA <span className="note">· opens in a new tab</span>
          </a>
        </li>
      </ul>
    </section>
  );
}
