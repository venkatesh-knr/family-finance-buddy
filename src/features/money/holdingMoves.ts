/**
 * The holdings' own entries that name an account, as the month close reads them (docs/design/ledger-income.md section 4a; LI-I28, LI-I30).
 *
 * A purchase is money into a holding from the account it names, and a sale, a redemption or a maturity is money out, paid into it; a PPF payment is in
 * and a withdrawal is out. What moved is the account's own figure: for a dollar purchase paid from a rupee account, the rupees that left it. A bonus issue,
 * a split, a transfer, a gift and an ESOP vest moved no money, and a voided PPF entry is no entry. What names no account moves nothing here and is counted,
 * so the screen can say how many there were: their money stays in spent, as it was before an entry could name an account.
 *
 * Pure: the entries are passed in, already read.
 */

import type { MonthHoldingMove } from '../../domain/money-month.ts';
import type { Disposal, Lot, PpfEntryRow } from '../../repo/types.ts';

export interface HoldingEntries {
  readonly lots: readonly Lot[];
  readonly disposals: readonly Disposal[];
  readonly ppf: readonly PpfEntryRow[];
}

const MONEY_OUT_KINDS: readonly string[] = ['sale', 'redemption', 'maturity'];

export function holdingMovesOf(entries: HoldingEntries): { readonly moves: readonly MonthHoldingMove[]; readonly unnamed: number } {
  const moves: MonthHoldingMove[] = [];
  let unnamed = 0;

  for (const lot of entries.lots) {
    if (lot.kind !== 'purchase') continue;
    if (lot.paidVia === null) unnamed += 1;
    else moves.push({ accountId: lot.paidVia.accountId, direction: 'into', amount: lot.paidVia.amount, date: lot.acquiredOn });
  }
  for (const sale of entries.disposals) {
    if (!MONEY_OUT_KINDS.includes(sale.kind)) continue;
    if (sale.paidVia === null) unnamed += 1;
    else moves.push({ accountId: sale.paidVia.accountId, direction: 'out', amount: sale.paidVia.amount, date: sale.disposedOn });
  }
  for (const entry of entries.ppf) {
    if (entry.isVoided) continue;
    if (entry.paidVia === null) unnamed += 1;
    else moves.push({ accountId: entry.paidVia.accountId, direction: entry.amount.minor > 0n ? 'into' : 'out', amount: entry.paidVia.amount, date: entry.date });
  }
  return { moves, unnamed };
}
