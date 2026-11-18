/**
 * What goes into the invested figure (docs/design/spending-capture.md section 10; SC-I11), built from what the holdings screens already read.
 *
 * One place, so the Overview's card and the Money card say the same thing about a month. Pure: the listing, the deposits' terms and renewals, the PPF payments and the
 * month are passed in. A deposit or bond cannot record a sale, so what it paid out is worked out from its terms, as Holdings does.
 */

import type { InvestedInput } from '../../domain/invested.ts';
import type { DepositRenewal, FixedIncomeTerms, HoldingListing, PpfEntryRow, Uuid } from '../../repo/types.ts';
import { ASSET_CLASSES } from '../../ui/assetClass.ts';
import { fixedIncomePayouts } from '../holdings/fixedIncomeRows.ts';

/** The classes in the order they are listed: the classes Holdings groups by (HD-I2). */
export const CLASS_ORDER: readonly string[] = ASSET_CLASSES.map((entry) => entry.kind);

export function investedInput(input: {
  readonly listing: HoldingListing;
  readonly terms: readonly FixedIncomeTerms[] | null;
  readonly renewals: readonly DepositRenewal[];
  readonly ppf: readonly PpfEntryRow[] | null;
  readonly month: string;
  /** `mine`: only this member's holdings. */
  readonly scope: 'mine' | 'household';
  readonly mine: Uuid | null;
  readonly today: string;
}): InvestedInput {
  const { listing, terms, renewals, ppf, month, scope, mine, today } = input;
  const held = listing.holdings.filter((h) => scope === 'household' || h.member.id === mine);
  const ids = new Set(held.map((h) => String(h.id)));
  const scopedTerms = (terms ?? []).filter((t) => ids.has(String(t.holdingId)));
  return {
    month,
    classOrder: CLASS_ORDER,
    holdings: held.map((h) => ({ id: String(h.id), kind: h.instrument.kind, openedOn: h.openedOn, cost: h.cost, scheme: h.instrument.scheme })),
    lots: listing.lots.filter((l) => ids.has(String(l.holdingId))).map((l) => ({ holdingId: String(l.holdingId), acquiredOn: l.acquiredOn, cost: l.cost, kind: l.kind })),
    disposals: listing.disposals
      .filter((d) => ids.has(String(d.holdingId)))
      .map((d) => ({ holdingId: String(d.holdingId), disposedOn: d.disposedOn, proceeds: d.proceeds, kind: d.kind })),
    terms: scopedTerms.map((t) => ({ holdingId: String(t.holdingId), start: t.start, principal: t.principal })),
    payouts: fixedIncomePayouts(scopedTerms, renewals, today).map((p) => ({ holdingId: String(p.holdingId), paidOn: p.paidOn, amount: p.amount })),
    ppfEntries: (ppf ?? [])
      .filter((e) => ids.has(String(e.holdingId)))
      .map((e) => ({ holdingId: String(e.holdingId), date: e.date, amount: e.amount, isVoided: e.isVoided })),
  };
}
