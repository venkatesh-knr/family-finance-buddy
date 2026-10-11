import { trimRate, type FixedIncomePosition, type FixedIncomeView } from '../../domain/fixed-income.ts';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney } from '../../lib/money.ts';

/**
 * The one fact a holding's row carries beside the member (docs/design/holdings.md, "A row"): units for a fund or
 * a share, the terms for a deposit or a bond. A deposit has no units and a fund has no maturity, so each says
 * its own and not the other's ("1 units" on an FD is the bug the redesign fixes).
 *
 * Read from the recorded terms and the view they work out, never from a value: the row's figure is the latest
 * recorded reading (HD-I1), and a worked-out estimate belongs on the detail view beside the action that
 * records it.
 */
export function rowFact(options: {
  readonly kind: string;
  readonly symbol: string | null;
  readonly unitsText: string;
  readonly position: FixedIncomePosition | null;
  readonly view: FixedIncomeView | null;
  readonly institution: string | null;
  /** Privacy mode removes an amount from the page, and a coupon on a row is one. */
  readonly privacy?: boolean;
}): string {
  const { kind, symbol, unitsText, position, view, institution, privacy = false } = options;

  if (kind === 'deposit' || kind === 'bond') {
    if (position === null) return 'terms not recorded';
    const rate = `${trimRate(position.ratePct)}%`;
    if (view === null || !view.ok) return `${rate} · terms need attention`;

    if (view.kind === 'deposit') {
      const end = view.nextMaturity ?? position.maturity;
      return [institution, rate, `matures ${formatIsoDate(end)}`].filter((p): p is string => p !== null).join(' · ');
    }
    if (view.repay === 'payout' && view.nextCoupon !== null && view.couponAmount !== null) {
      return `${rate} · next ${formatMoney(view.couponAmount, { privacy })} on ${formatIsoDate(view.nextCoupon)}`;
    }
    return `${rate} · matures ${formatIsoDate(position.maturity)}`;
  }

  return [symbol, `${unitsText} units`].filter((p): p is string => p !== null && p !== '').join(' · ');
}
