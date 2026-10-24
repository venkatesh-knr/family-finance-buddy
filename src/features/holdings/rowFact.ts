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

/**
 * The term a deposit is in the middle of, from its start to its end, and what it was lent for: the first term until
 * the bank has renewed it, and then the latest renewal that has begun. A bond has one life and its face value.
 *
 * Read for the holding's own screen, which draws how far through the term it is: a bar over the first term for a
 * deposit that has been renewed twice would show a term fully passed beside a maturity that is a year off.
 */
export function currentTerm(
  position: FixedIncomePosition,
  today: string,
): { readonly start: string; readonly end: string; readonly principal: FixedIncomePosition['principal'] } {
  if (position.kind === 'bond') return { start: position.start, end: position.maturity, principal: position.principal };
  const begun = [...position.renewals].filter((r) => r.start <= today).sort((a, b) => (a.start < b.start ? -1 : 1));
  const latest = begun[begun.length - 1];
  return latest === undefined
    ? { start: position.start, end: position.maturity, principal: position.principal }
    : { start: latest.start, end: latest.maturity, principal: latest.principal };
}

/**
 * The term the progress bar is drawn over, with its dates.
 *
 * The term the deposit is in: the recorded one, or, where a deposit that renews itself has run past its last recorded
 * term and the bank's advice has not been entered, the projected one, which begins where the recorded one ended. The
 * bar, the maturity and the days to go are then one term and not two, which a bar from the first start to a projected
 * end would not be.
 */
export function barTerm(
  position: FixedIncomePosition,
  view: FixedIncomeView | null,
  today: string,
): { readonly start: string; readonly end: string } {
  const current = currentTerm(position, today);
  if (view !== null && view.ok && view.kind === 'deposit' && view.nextMaturity !== null) {
    return view.projected ? { start: current.end, end: view.nextMaturity } : { start: current.start, end: view.nextMaturity };
  }
  return { start: current.start, end: current.end };
}
