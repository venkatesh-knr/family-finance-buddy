/**
 * A deposit or bond as the calculation reads it, built from what the repository returns.
 *
 * The Deposits and bonds card and the Overview's Needs attention both ask what a position
 * is worth, when it matures and whether it has been downgraded, and they must get the same
 * answer from the same rows. One place builds the position from its terms and its recorded
 * renewals; neither screen assembles its own.
 */

import {
  fixedIncomeView,
  MATURITY_NOTICE_DAYS,
  type FixedIncomePosition,
} from '../../domain/fixed-income.ts';
import { DOWNGRADE_NOTICE_DAYS, recentDowngrade } from '../../domain/ratings.ts';
import type { IsoDate } from '../../lib/dates.ts';
import type { DepositRenewal, FixedIncomeTerms, RatingChange } from '../../repo/types.ts';

export function buildPosition(
  terms: FixedIncomeTerms,
  renewals: readonly DepositRenewal[],
): FixedIncomePosition {
  return {
    holdingId: terms.holdingId,
    kind: terms.kind,
    principal: terms.principal,
    ratePct: terms.ratePct,
    start: terms.start,
    maturity: terms.maturity,
    compounding: terms.compounding,
    couponFrequency: terms.couponFrequency,
    repayMode: terms.repayMode,
    autoRenew: terms.autoRenew,
    renewalRatePct: terms.renewalRatePct,
    renewals: renewals
      .filter((r) => r.holdingId === terms.holdingId)
      .map((r) => ({
        start: r.start,
        maturity: r.maturity,
        principal: r.principal,
        ratePct: r.ratePct,
        compounding: r.compounding,
      })),
  };
}

export interface FixedIncomeAlert {
  readonly holdingId: string;
  readonly kind: 'matures' | 'downgraded';
  /** For a maturity: the day, and how many days off. For a downgrade: the day it was noticed. */
  readonly on: IsoDate;
  readonly daysAway?: number;
  readonly from?: string | null;
  readonly to?: string | null;
}

/**
 * What a household should hear about without opening the Holdings screen: a deposit or bond
 * that matures within the notice period, and a bond downgraded recently.
 *
 * Only positions the caller was given are asked about, so another member's private deposit is
 * neither here nor counted. A position that cannot be valued has no maturity to speak of and
 * is said on its own row, not here.
 */
export function fixedIncomeAlerts(options: {
  readonly terms: readonly FixedIncomeTerms[];
  readonly renewals: readonly DepositRenewal[];
  readonly ratingChanges: readonly RatingChange[];
  /** The holdings in view: archived ones and other people's private ones are not in it. */
  readonly visibleHoldingIds: ReadonlySet<string>;
  readonly today: IsoDate;
}): readonly FixedIncomeAlert[] {
  const alerts: FixedIncomeAlert[] = [];
  for (const terms of options.terms) {
    if (!options.visibleHoldingIds.has(terms.holdingId)) continue;

    const view = fixedIncomeView(buildPosition(terms, options.renewals), options.today);
    if (view.ok && !view.matured && view.daysToMaturity !== null && view.daysToMaturity <= MATURITY_NOTICE_DAYS) {
      const on = view.kind === 'deposit' ? (view.nextMaturity ?? terms.maturity) : terms.maturity;
      alerts.push({ holdingId: terms.holdingId, kind: 'matures', on, daysAway: view.daysToMaturity });
    }

    const downgrade = recentDowngrade(
      options.ratingChanges
        .filter((c) => c.holdingId === terms.holdingId)
        .map((c) => ({ seq: c.seq, from: c.from, to: c.to, changedOn: c.changedOn })),
      options.today,
      DOWNGRADE_NOTICE_DAYS,
    );
    if (downgrade !== null) {
      alerts.push({
        holdingId: terms.holdingId,
        kind: 'downgraded',
        on: downgrade.changedOn,
        from: downgrade.from,
        to: downgrade.to,
      });
    }
  }
  return alerts;
}
