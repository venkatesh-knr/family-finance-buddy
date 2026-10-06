/**
 * The household summary, shaped for a screen.
 *
 * What a contributor or a viewer is given instead of rows: sums by category and
 * by kind, from the definer functions. Everything here is per currency and never
 * across currencies. An honest total that needs an exchange rate is not this
 * module's to invent, the same rule as the rest of the app.
 *
 * Pure: it only arranges what it is given.
 */

import type { IsoDate } from '../lib/dates.ts';
import { money, type Money } from '../lib/money.ts';

export interface SpendingRow {
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly total: Money;
}

export interface SpendingGroup {
  readonly currency: string;
  readonly total: Money;
  readonly rows: readonly {
    readonly categoryId: string | null;
    readonly name: string;
    readonly total: Money;
    /** Of this currency's total. */
    readonly share: number;
  }[];
}

const byAmountDescending = (a: bigint, b: bigint): number => (a === b ? 0 : a > b ? -1 : 1);
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function summariseSpending(input: readonly SpendingRow[]): SpendingGroup[] {
  const byCurrency = new Map<string, Map<string, { id: string | null; name: string; minor: bigint }>>();

  for (const row of input) {
    const currency = row.total.currency;
    const categories = byCurrency.get(currency) ?? new Map();
    // Keyed by id, so two spellings of one category cannot split it; null is one key.
    const key = row.categoryId ?? '';
    const held = categories.get(key);
    categories.set(key, {
      id: row.categoryId,
      name: row.categoryName ?? 'Uncategorised',
      minor: (held?.minor ?? 0n) + row.total.minor,
    });
    byCurrency.set(currency, categories);
  }

  return [...byCurrency.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([currency, categories]) => {
      const rows = [...categories.values()].sort((a, b) => byAmountDescending(a.minor, b.minor));
      const sum = rows.reduce((acc, row) => acc + row.minor, 0n);
      return {
        currency,
        total: money(sum, currency),
        rows: rows.map((row) => ({
          categoryId: row.id,
          name: row.name,
          total: money(row.minor, currency),
          share: sum === 0n ? 0 : Number(row.minor) / Number(sum),
        })),
      };
    });
}

export interface AssetRow {
  readonly kind: string;
  readonly currency: string;
  readonly total: Money;
  readonly valued: number;
  readonly unvalued: number;
}

export interface AssetGroup {
  readonly currency: string;
  readonly total: Money;
  /** Holdings in this currency nobody has valued: said, never counted as zero. */
  readonly unvalued: number;
  readonly rows: readonly { readonly kind: string; readonly total: Money; readonly share: number }[];
}

export function summariseAssets(input: readonly AssetRow[]): AssetGroup[] {
  const byCurrency = new Map<string, AssetRow[]>();
  for (const row of input) byCurrency.set(row.currency, [...(byCurrency.get(row.currency) ?? []), row]);

  return [...byCurrency.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([currency, rows]) => {
      // A kind with nothing valued, or valued at nothing, has no share of anything.
      const valued = rows
        .filter((row) => row.valued > 0 && row.total.minor > 0n)
        .sort((a, b) => byAmountDescending(a.total.minor, b.total.minor));
      const sum = valued.reduce((acc, row) => acc + row.total.minor, 0n);
      return {
        currency,
        total: money(sum, currency),
        unvalued: rows.reduce((acc, row) => acc + row.unvalued, 0),
        rows: valued.map((row) => ({
          kind: row.kind,
          total: row.total,
          share: sum === 0n ? 0 : Number(row.total.minor) / Number(sum),
        })),
      };
    });
}

/**
 * The first day of this month and of each of the `count - 1` before it, newest
 * first. A calendar date in, calendar dates out: no clock and no timezone, which
 * is what lets the date be passed in.
 */
export function recentMonths(today: IsoDate, count: number): IsoDate[] {
  const out: IsoDate[] = [];
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let i = 0; i < count; i += 1) {
    out.push(`${String(year)}-${String(month).padStart(2, '0')}-01`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}
