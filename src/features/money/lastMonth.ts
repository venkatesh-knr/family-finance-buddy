/**
 * Last month, on the month surface (docs/design/ledger-income.md section 4; the owner, 15 November 2026).
 *
 * A closed month shows its own figures, from the balances: came in, spent and saved, per currency and never added across them, and says how many
 * accounts they cover. A month nobody has closed shows the open state, as this month does. The figures are the close's (`closeMonth.ts`), so what
 * is shown here is what the close showed; this decides only which of the two the surface draws. Pure.
 */

import type { Money } from '../../lib/money.ts';
import { money } from '../../lib/money.ts';
import type { CloseFigures } from './closeMonth.ts';

export type LastMonthView =
  | {
      readonly kind: 'closed';
      readonly month: string;
      readonly cameIn: readonly Money[];
      readonly spent: readonly Money[];
      readonly saved: readonly Money[];
      /** The accounts the figures cover, and the accounts there are: the ones read, and the private ones the database counted. */
      readonly counted: number;
      readonly total: number;
      /** Purchases, sales and PPF entries of the month that named no account: their money is still in spent. */
      readonly unnamedEntries: number;
    }
  /** `noAccounts`: the household has no account in use, so the month can never be closed from balances; it is on what was entered. */
  | { readonly kind: 'open'; readonly month: string; readonly noAccounts: boolean }
  /** What the closed figures need is still being read, or could not be: neither is shown as an open month. */
  | { readonly kind: 'reading'; readonly month: string }
  | { readonly kind: 'failed'; readonly month: string };

export function lastMonthView(input: {
  readonly month: string;
  readonly close: CloseFigures;
  /** The accounts in the close that the caller reads. */
  readonly readable: number;
  /** What the database counted of the accounts the caller cannot read, for an owner or a partner. */
  readonly hidden: readonly { readonly counted: number; readonly total: number }[];
  /** Set while what the figures need is being read, or when it could not be. */
  readonly reading?: 'loading' | 'failed';
  /** How many of the month's purchases, sales and PPF entries the caller reads named no account. */
  readonly unnamedEntries?: number;
}): LastMonthView {
  const { month, close } = input;
  if (input.reading === 'loading') return { kind: 'reading', month };
  if (input.reading === 'failed') return { kind: 'failed', month };
  if (close.status !== 'figures') return { kind: 'open', month, noAccounts: close.status === 'no-accounts' };
  return {
    kind: 'closed',
    month,
    cameIn: close.currencies.map((line) => money(line.cameIn, line.currency)),
    spent: close.currencies.map((line) => money(line.spent, line.currency)),
    saved: close.currencies.map((line) => money(line.saved, line.currency)),
    counted: input.readable + input.hidden.reduce((total, line) => total + line.counted, 0),
    total: input.readable + input.hidden.reduce((total, line) => total + line.total, 0),
    unnamedEntries: input.unnamedEntries ?? 0,
  };
}

/** *from balances, 3 of 3 accounts*: where a closed month's figures come from, and how many accounts they cover. */
export function modeLine(counted: number, total: number): string {
  return `from balances, ${String(counted)} of ${String(total)} ${total === 1 ? 'account' : 'accounts'}`;
}
