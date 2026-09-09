/**
 * Applying dated tax rules to a gain.
 *
 * "Tax rules — slabs, rates, thresholds, holding periods — are dated rows in
 * `tax_rule`, not constants in code. A Budget change is a data edit. Prior
 * years recompute on the rules that applied then."
 *
 * `src/domain/lots.ts` derives parcels and stops short of saying whether each
 * is long or short term, because that is policy rather than arithmetic. This
 * is where the policy is applied — and it is applied by looking up the rule
 * that covered the sale's own date, never the rule in force today. Gold sold
 * in June 2024 was under a thirty-six-month rule; the same holding sold in
 * August was under twenty-four. Both answers are correct for their own sale,
 * and neither may change because the law moved afterwards.
 *
 * ── it refuses more than it answers, and that is the design ──────────────
 *
 * Three ways this returns nothing rather than a guess:
 *
 *   No rule covers the date. Earlier regimes are not seeded, so a 2019 sale
 *   has no holding period. Applying the current one would give a confident,
 *   plausible, wrong number — the exact failure mode this app is built
 *   against, and the one nobody would catch by reading the screen.
 *
 *   The instrument has no asset class. A fund's treatment depends on what it
 *   holds, not on what kind of wrapper it is, so the app asks rather than
 *   inferring from `kind`.
 *
 *   The class has no rate of its own. Short-term gain on gold is taxed at the
 *   taxpayer's slab, which is not a capital-gains rate; there is no row, and
 *   none is invented.
 *
 * None of this is tax advice, and the app says so wherever it shows a figure:
 * "It is not tax advice, not a filing, and not a substitute for your CA."
 */

import type { IsoDate } from '../lib/dates.ts';

export type AssetClass =
  | 'listed_equity'
  | 'equity_fund'
  | 'debt_fund'
  | 'gold'
  | 'foreign_equity'
  | 'unlisted_equity'
  | 'property';

export type Term = 'long' | 'short';

export interface TaxRule {
  readonly jurisdiction: string;
  readonly kind: string;
  readonly assetClass: AssetClass | null;
  readonly months: number | null;
  /**
   * A decimal string, not a number.
   *
   * `numeric(6,3)` so 12.5 is exactly 12.5, and it stays a string for the same
   * reason an exchange rate does — a rate that arrives as a double has already
   * lost whatever the column was chosen to keep.
   */
  readonly ratePct: string | null;
  readonly term: Term | null;
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null;
  readonly authority: string;
}

export type Classification =
  | {
      readonly known: true;
      readonly term: Term;
      /** The threshold that was applied, so a screen can show its working. */
      readonly months: number;
      readonly authority: string;
    }
  | {
      readonly known: false;
      readonly reason: 'no-rule-for-date' | 'unclassified-asset';
    };

/** The rule of a kind that covered a date, or null. */
function ruleOn(
  rules: readonly TaxRule[],
  kind: string,
  assetClass: AssetClass,
  on: IsoDate,
): TaxRule | null {
  let best: TaxRule | null = null;
  for (const rule of rules) {
    if (rule.kind !== kind || rule.assetClass !== assetClass) continue;
    if (rule.effectiveFrom > on) continue;
    if (rule.effectiveTo !== null && rule.effectiveTo < on) continue;
    // Latest start wins where two overlap — a correction supersedes what it
    // corrects rather than sitting beside it.
    if (best === null || rule.effectiveFrom > best.effectiveFrom) best = rule;
  }
  return best;
}

/**
 * Whether `disposedOn` is more than `months` calendar months after
 * `acquiredOn`.
 *
 * Calendar months, not a day count. "Twelve months" in the Act is twelve
 * calendar months, and 365 days is a different threshold in a leap year —
 * close enough to look right and wrong on exactly the sales that sit near the
 * boundary, which are the ones somebody is checking.
 *
 * A month that has no such day clamps to its last: 31 August plus one month is
 * 30 September, not 1 October.
 */
function isPastMonths(acquiredOn: IsoDate, disposedOn: IsoDate, months: number): boolean {
  const [ay = 0, am = 0, ad = 0] = acquiredOn.split('-').map(Number);
  const total = am - 1 + months;
  const year = ay + Math.floor(total / 12);
  const month = (total % 12) + 1;

  // The last day of the target month, so 31 January + 1 month is 28 or 29
  // February rather than rolling into March.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(ad, lastDay);

  const threshold = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Strictly after. Held for exactly the period is not held for longer than
  // it — the Act says "more than", and the boundary day belongs to short term.
  return disposedOn > threshold;
}

export function classify(
  rules: readonly TaxRule[],
  parcel: {
    readonly assetClass: AssetClass | null;
    readonly acquiredOn: IsoDate;
    readonly disposedOn: IsoDate;
  },
): Classification {
  if (parcel.assetClass === null) {
    return { known: false, reason: 'unclassified-asset' };
  }

  // Looked up on the DISPOSAL date. The rule that governs a sale is the one in
  // force when it happened, not when the units were bought — otherwise a
  // holding bought under an old regime would keep it forever.
  const rule = ruleOn(rules, 'holding_period', parcel.assetClass, parcel.disposedOn);
  if (rule === null || rule.months === null) {
    return { known: false, reason: 'no-rule-for-date' };
  }

  return {
    known: true,
    term: isPastMonths(parcel.acquiredOn, parcel.disposedOn, rule.months) ? 'long' : 'short',
    months: rule.months,
    authority: rule.authority,
  };
}

/**
 * The capital-gains rate for a class, term and date — or null.
 *
 * Null is common and correct: short-term gain outside equity is taxed at the
 * taxpayer's slab, which is not a capital-gains rate and has no row here.
 */
export function longTermRate(
  rules: readonly TaxRule[],
  assetClass: AssetClass,
  term: Term,
  on: IsoDate,
): TaxRule | null {
  let best: TaxRule | null = null;
  for (const rule of rules) {
    if (rule.kind !== 'cg_rate' || rule.assetClass !== assetClass || rule.term !== term) continue;
    if (rule.effectiveFrom > on) continue;
    if (rule.effectiveTo !== null && rule.effectiveTo < on) continue;
    if (best === null || rule.effectiveFrom > best.effectiveFrom) best = rule;
  }
  return best;
}
