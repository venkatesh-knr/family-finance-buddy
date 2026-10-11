/**
 * How the Holdings list groups, orders and filters what the household holds (docs/design/holdings.md).
 *
 * Pure: the screen hands it one line per holding and gets back the groups, the ended group, the totals and the
 * chips. Nothing here reads a figure that is not already a recorded reading (HD-I1: a row shows the latest recorded
 * value, never a worked-out estimate), and nothing adds across currencies (HD-I2): a dollar holding sits in its
 * class and is summed into the dollar total only, the same refusal the Overview makes.
 */

import { money, type Money } from '../../lib/money.ts';
import type { Earmark } from '../../domain/earmark.ts';

export interface ListHolding {
  readonly id: string;
  readonly kind: string;
  /** The currency it is priced in. Totals are kept per currency. */
  readonly currency: string;
  readonly earmark: Earmark;
  /** The latest recorded reading, or null for a holding nobody has valued. Not zero. */
  readonly latest: Money | null;
  /** How many units are held; zero is a holding that has been sold out. */
  readonly unitsHeld: bigint;
  /** The day a deposit or bond paid out, if it has. */
  readonly paidOutOn: string | null;
}

export interface Filter {
  readonly kind?: string;
  readonly earmark?: string;
  readonly currency?: string;
}

export interface Group {
  readonly kind: string;
  readonly holdings: readonly ListHolding[];
  /** One subtotal per currency: the sum of the latest readings of its rows. */
  readonly subtotals: readonly Money[];
  /** The share each subtotal is of its own currency's total. */
  readonly shares: readonly { readonly currency: string; readonly share: number }[];
  /** Rows with no reading: in the group, and not in its subtotal. */
  readonly unvalued: number;
}

export interface GroupedHoldings {
  readonly groups: readonly Group[];
  /** No units left, or matured and paid out. Never in a subtotal. */
  readonly ended: readonly ListHolding[];
  /** The summary: what the groups shown add up to, per currency. */
  readonly totals: readonly { readonly currency: string; readonly value: Money; readonly unvalued: number }[];
  readonly chips: {
    readonly kinds: readonly { readonly kind: string; readonly count: number }[];
    readonly earmarks: readonly { readonly earmark: string; readonly count: number }[];
  };
}

/** A holding that is no longer one: sold out, or paid out. */
export function isEnded(holding: ListHolding): boolean {
  return holding.paidOutOn !== null || holding.unitsHeld === 0n;
}

function matches(holding: ListHolding, filter: Filter): boolean {
  if (filter.kind !== undefined && filter.kind !== '' && holding.kind !== filter.kind) return false;
  if (filter.earmark !== undefined && filter.earmark !== '' && holding.earmark !== filter.earmark) return false;
  if (filter.currency !== undefined && filter.currency !== '' && holding.currency !== filter.currency) return false;
  return true;
}

function subtotalsOf(holdings: readonly ListHolding[]): readonly Money[] {
  const by = new Map<string, bigint>();
  for (const h of holdings) {
    if (h.latest === null) continue;
    by.set(h.currency, (by.get(h.currency) ?? 0n) + h.latest.minor);
  }
  return [...by.entries()].map(([currency, minor]) => money(minor, currency));
}

export function groupHoldings(options: {
  readonly holdings: readonly ListHolding[];
  /** The household's own currency, which orders the groups. */
  readonly base: string;
  readonly filter: Filter;
}): GroupedHoldings {
  const { holdings, base, filter } = options;

  const live = holdings.filter((h) => !isEnded(h));
  const shown = holdings.filter((h) => matches(h, filter));
  const shownLive = shown.filter((h) => !isEnded(h));

  // Groups, by class, over what is shown.
  const byKind = new Map<string, ListHolding[]>();
  for (const h of shownLive) byKind.set(h.kind, [...(byKind.get(h.kind) ?? []), h]);

  // The currency totals the shares are of: the groups shown, so a filtered summary describes the filter.
  const totalByCurrency = new Map<string, { value: bigint; unvalued: number }>();
  for (const h of shownLive) {
    const entry = totalByCurrency.get(h.currency) ?? { value: 0n, unvalued: 0 };
    if (h.latest === null) entry.unvalued += 1;
    else entry.value += h.latest.minor;
    totalByCurrency.set(h.currency, entry);
  }

  const groups: Group[] = [...byKind.entries()].map(([kind, rows]) => {
    const subtotals = subtotalsOf(rows);
    return {
      kind,
      holdings: rows,
      subtotals,
      shares: subtotals.map((s) => {
        const total = totalByCurrency.get(s.currency)?.value ?? 0n;
        return { currency: s.currency, share: total === 0n ? 0 : Number(s.minor) / Number(total) };
      }),
      unvalued: rows.filter((h) => h.latest === null).length,
    };
  });

  // Largest first, in the household's own currency; a group with none of it (abroad only) follows, by its own.
  const key = (g: Group): [number, bigint] => {
    const own = g.subtotals.find((s) => s.currency === base);
    if (own !== undefined) return [0, own.minor];
    return [1, g.subtotals[0]?.minor ?? 0n];
  };
  groups.sort((a, b) => {
    const [ra, va] = key(a);
    const [rb, vb] = key(b);
    if (ra !== rb) return ra - rb;
    return vb > va ? 1 : vb < va ? -1 : 0;
  });

  // Chips are over everything live, so the filter can be changed without going back to All first.
  const kindCounts = new Map<string, number>();
  for (const h of live) kindCounts.set(h.kind, (kindCounts.get(h.kind) ?? 0) + 1);
  const kindOrder = orderKinds(live, base);
  const earmarkCounts = new Map<string, number>();
  for (const h of live) if (h.earmark !== 'none') earmarkCounts.set(h.earmark, (earmarkCounts.get(h.earmark) ?? 0) + 1);

  return {
    groups,
    ended: shown.filter(isEnded),
    totals: [...totalByCurrency.entries()].map(([currency, t]) => ({
      currency,
      value: money(t.value, currency),
      unvalued: t.unvalued,
    })),
    chips: {
      kinds: kindOrder.map((kind) => ({ kind, count: kindCounts.get(kind) ?? 0 })),
      earmarks: [...earmarkCounts.entries()].map(([earmark, count]) => ({ earmark, count })),
    },
  };
}

/** The classes in use, in the order the groups would take with no filter. */
function orderKinds(live: readonly ListHolding[], base: string): string[] {
  const byKind = new Map<string, ListHolding[]>();
  for (const h of live) byKind.set(h.kind, [...(byKind.get(h.kind) ?? []), h]);
  const rank = (rows: readonly ListHolding[]): [number, bigint] => {
    const own = subtotalsOf(rows).find((s) => s.currency === base);
    if (own !== undefined) return [0, own.minor];
    return [1, subtotalsOf(rows)[0]?.minor ?? 0n];
  };
  return [...byKind.entries()]
    .sort(([, a], [, b]) => {
      const [ra, va] = rank(a);
      const [rb, vb] = rank(b);
      if (ra !== rb) return ra - rb;
      return vb > va ? 1 : vb < va ? -1 : 0;
    })
    .map(([kind]) => kind);
}
