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
import type { IsoDate } from '../../lib/dates.ts';
import type { OpeningCost } from '../../repo/holdingEntries.ts';
import type { DepositRenewal, Disposal, FixedIncomeTerms, Lot, PpfEntryRow } from '../../repo/types.ts';
import { fixedIncomePayouts } from '../holdings/fixedIncomeRows.ts';

export type { OpeningCost };

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

/**
 * A deposit's or a bond's principal, its payout, and the cost of a holding opened with one, as the close reads them (docs/design/ledger-income.md
 * section 4b; LI-I32 to LI-I35). The rules `investedInMonth` counts them by: the principal on the day the terms start, a payout on the day the deposit
 * paid out at what it paid (worked out from the terms, not stored), an opening cost on the day the holding was opened and only if nothing else (a
 * purchase, terms) says what went in. A recurring deposit is kept out of all of it. Not the same in one case, which no screen reaches: a purchase lot on a
 * holding that has terms is counted by `holdingMovesOf` and skipped by `investedInMonth` (section 4b).
 *
 * What names no account moves nothing and is counted, as for a lot. Pure: the terms, the renewals and the openings are passed in, already read.
 */
export function fixedIncomeMovesOf(input: {
  readonly terms: readonly FixedIncomeTerms[];
  readonly renewals: readonly DepositRenewal[];
  readonly openings: readonly OpeningCost[];
  /** The holdings of a recurring deposit (scheme `rd`). */
  readonly recurring: ReadonlySet<string>;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly today: IsoDate;
}): { readonly moves: readonly MonthHoldingMove[]; readonly unnamed: number } {
  const moves: MonthHoldingMove[] = [];
  let unnamed = 0;
  const inMonth = (date: IsoDate): boolean => date >= input.from && date <= input.to;
  const live = input.terms.filter((terms) => !input.recurring.has(terms.holdingId));

  for (const terms of live) {
    if (!inMonth(terms.start)) continue;
    if (terms.paidVia === null) unnamed += 1;
    else moves.push({ accountId: terms.paidVia.accountId, direction: 'into', amount: terms.paidVia.amount, date: terms.start });
  }

  const payoutAccount = new Map(live.map((terms) => [terms.holdingId, terms.payoutAccountId]));
  for (const payout of fixedIncomePayouts(live, input.renewals, input.today)) {
    if (!inMonth(payout.paidOn)) continue;
    const accountId = payoutAccount.get(payout.holdingId) ?? null;
    if (accountId === null) unnamed += 1;
    else moves.push({ accountId, direction: 'out', amount: payout.amount, date: payout.paidOn });
  }

  const hasTerms = new Set(input.terms.map((terms) => terms.holdingId));
  for (const opening of input.openings) {
    if (opening.hasLot || hasTerms.has(opening.holdingId) || input.recurring.has(opening.holdingId)) continue;
    if (opening.openedOn === null || !inMonth(opening.openedOn) || opening.cost === null) continue;
    if (opening.accountId === null) unnamed += 1;
    else moves.push({ accountId: opening.accountId, direction: 'into', amount: opening.cost, date: opening.openedOn });
  }
  return { moves, unnamed };
}
