/**
 * Income tax on ordinary income: slabs, then rebate, then surcharge, then cess.
 *
 * `docs/blueprint.md`'s pipeline, steps 5 and 6, on top of the capital gains the
 * netter already produced:
 *
 *   5  Aggregate   add the other heads; apply the deduction the regime permits
 *   6  Rate        slabs → rebate → surcharge → 4% cess
 *
 * Every rate, band, ceiling and amount here is a dated row in `tax_rule`, read as
 * of the last day of the tax year. Nothing about a Budget is in this file: a new
 * one is new rows. What IS here is the mechanism — that a rebate is not given
 * against tax on capital gains, that a surcharge steps and is then softened by
 * marginal relief — because those are how the law works, not what it currently
 * charges, and they would change with a new Act rather than a new Budget.
 *
 * ── assumptions, stated because a working paper that hides them is not one ──
 *
 * A resident individual under sixty. The old regime has a higher basic exemption
 * for seniors and nothing here holds a date of birth, so it is not modelled.
 * Only the standard deduction is applied: no section 80C, 80D or any other. The
 * new regime has almost none, so its figure is close to whole; the old regime's is
 * NOT, and reads high for anyone who claims them. Tax is not rounded to the
 * nearest ₹10 as a return rounds it.
 *
 * ── what it refuses, and says so ─────────────────────────────────────────
 *
 * A surcharge on capital gains (its own 15% cap, and a relief that must be worked
 * across two kinds of income), and the rebate's marginal relief where there are
 * capital gains beside the salary. Both return no total, with the reason, because
 * a total that quietly left out a part reads as complete. A year no rule covers
 * returns none either, rather than using another year's slabs.
 *
 * Pure. No I/O, no `Date.now()`.
 */

import { taxYearBounds } from './budget.ts';
import { capitalGainsTax, type CapitalGains, type CapitalGainsTax } from './capital-gains.ts';
import { percentOf, thousandths } from './rate.ts';
import type { Regime, TaxRule } from './tax-rules.ts';
import type { IsoDate } from '../lib/dates.ts';
import { money, type Money } from '../lib/money.ts';

const CURRENCY = 'INR';

/** Why a total is not given. Each names something specific. */
export type Refusal =
  | 'no-rule-for-year'
  | 'surcharge-on-capital-gains'
  | 'rebate-relief-on-capital-gains'
  | 'capital-gains-tax-unknown';

export interface IncomeTaxComputation {
  readonly fy: number;
  readonly regime: Regime;

  // ── what went in ──
  readonly salary: Money;
  /** What was taken off the salary. Never more than the salary itself. */
  readonly standardDeduction: Money;
  readonly otherIncome: Money;
  /** Short-term gold and unlisted gains, which the slab taxes as income. */
  readonly shortTermAtSlab: Money;
  /** Income the slabs are applied to, after deductions. */
  readonly taxableOrdinary: Money;

  // ── the capital gains beside it ──
  /** How much of the basic exemption the gains used, because other income had not. */
  readonly basicExemptionAdjustment: Money;
  /** The gains as rated, after that adjustment. */
  readonly capitalGains: CapitalGainsTax;
  /** What the gains add to total income, after the adjustment. */
  readonly capitalGainsTaxable: Money;
  /** Ordinary plus capital gains: what the rebate ceiling and the surcharge tiers are tested against. */
  readonly totalIncome: Money;

  // ── the rating ──
  /** Null only where no rule covers the year. */
  readonly slabTax: Money | null;
  /** What the rebate gave. Zero where it does not apply. */
  readonly rebate: Money | null;
  /** What the new regime's marginal relief took off just above the rebate ceiling. */
  readonly marginalRelief: Money;
  readonly taxAfterRebate: Money | null;
  /** Null when it applies and cannot be given: see `refused`. */
  readonly surcharge: Money | null;
  /** What marginal relief took off the surcharge just over a threshold. */
  readonly surchargeRelief: Money;
  readonly cess: Money | null;
  /** Null unless every part is known. A total short by a refused part would read as complete. */
  readonly total: Money | null;

  readonly refused: readonly Refusal[];
  /**
   * The oldest check among the rules this used, so the weakest link is the one
   * that shows. Null when any of them was never checked.
   */
  readonly verifiedOn: IsoDate | null;
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const positive = (a: bigint): bigint => (a > 0n ? a : 0n);
const inr = (minor: bigint): Money => money(minor, CURRENCY);

const covers = (rule: TaxRule, on: IsoDate): boolean =>
  rule.jurisdiction === 'IN' &&
  rule.effectiveFrom <= on &&
  (rule.effectiveTo === null || rule.effectiveTo >= on);

/**
 * The bands of a kind for a regime in force on a date, lowest first.
 *
 * Where two rows start at the same floor, the later-dated one wins: a correction
 * supersedes what it corrects rather than sitting beside it.
 */
function bandsOf(rules: readonly TaxRule[], kind: string, regime: Regime, on: IsoDate): TaxRule[] {
  const byFloor = new Map<bigint, TaxRule>();
  for (const rule of rules) {
    if (rule.kind !== kind || rule.regime !== regime || !covers(rule, on)) continue;
    if (rule.bandFromMinor === null) continue;
    const held = byFloor.get(rule.bandFromMinor);
    if (held === undefined || rule.effectiveFrom > held.effectiveFrom) {
      byFloor.set(rule.bandFromMinor, rule);
    }
  }
  return [...byFloor.values()].sort((a, b) =>
    (a.bandFromMinor ?? 0n) < (b.bandFromMinor ?? 0n) ? -1 : 1,
  );
}

/** The single rule of a kind in force on a date, latest start winning, or null. */
function ruleOf(
  rules: readonly TaxRule[],
  kind: string,
  regime: Regime | null,
  on: IsoDate,
  subject: string | null = null,
): TaxRule | null {
  let best: TaxRule | null = null;
  for (const rule of rules) {
    if (rule.kind !== kind || rule.regime !== regime || rule.subject !== subject) continue;
    if (!covers(rule, on)) continue;
    if (best === null || rule.effectiveFrom > best.effectiveFrom) best = rule;
  }
  return best;
}

/**
 * The oldest check across the rules a figure used, or null when there were none
 * or any of them was never checked. One rule shared by the computation and the
 * card that explains it, so the two cannot show different dates.
 */
function oldestCheck(used: readonly (TaxRule | null)[]): IsoDate | null {
  const rules = used.filter((rule): rule is TaxRule => rule !== null);
  const dates = rules.map((rule) => rule.verifiedOn);
  return rules.length === 0 || dates.some((date) => date === null)
    ? null
    : (dates as IsoDate[]).reduce((oldest, date) => (date < oldest ? date : oldest));
}

export interface AppliedBand {
  readonly fromMinor: bigint;
  /** Null is "and above". */
  readonly toMinor: bigint | null;
  readonly ratePct: string;
}

/** What a tax year rates income with, for a regime. */
export interface RatesApplied {
  readonly fy: number;
  readonly regime: Regime;
  readonly slabs: readonly AppliedBand[];
  /** The most it gives, and the total income up to which it applies. Null where there is none. */
  readonly rebate: { readonly ceilingMinor: bigint; readonly maxMinor: bigint } | null;
  readonly standardDeductionMinor: bigint | null;
  readonly surcharge: readonly AppliedBand[];
  readonly cessPct: string | null;
  /** When the oldest of these was last checked against the law. Null when any never was. */
  readonly verifiedOn: IsoDate | null;
  /** Where the rates are meant to come from, each named once. */
  readonly authorities: readonly string[];
}

/**
 * The rates a tax year applies, read the way the computation reads them.
 *
 * For the card that shows a person what their figure was rated with. It goes
 * through the same lookups as `computeIncomeTax` and not a second query of its
 * own, so what is shown is what was used: a card that could disagree with the
 * calculation beside it would be worse than none. A year no rule covers is empty
 * and says so; it never borrows another year's.
 */
export function ratesApplied(options: {
  readonly rules: readonly TaxRule[];
  readonly regime: Regime;
  readonly fy: number;
}): RatesApplied {
  const { rules, regime, fy } = options;
  const on = taxYearBounds(fy).end;

  const slabs = bandsOf(rules, 'slab', regime, on);
  const tiers = bandsOf(rules, 'surcharge', regime, on);
  const cess = ruleOf(rules, 'cess', null, on);
  const rebate = ruleOf(rules, 'rebate', regime, on);
  const standard = ruleOf(rules, 'deduction_cap', regime, on, 'standard_deduction');

  const band = (rule: TaxRule): AppliedBand => ({
    fromMinor: rule.bandFromMinor ?? 0n,
    toMinor: rule.bandToMinor,
    ratePct: rule.ratePct ?? '0',
  });

  const used = [...slabs, ...tiers, cess, rebate, standard];
  const authorities: string[] = [];
  for (const rule of used) {
    if (rule !== null && !authorities.includes(rule.authority)) authorities.push(rule.authority);
  }

  return {
    fy,
    regime,
    slabs: slabs.map(band),
    rebate:
      rebate === null ? null : { ceilingMinor: rebate.bandToMinor ?? 0n, maxMinor: rebate.amountMinor ?? 0n },
    standardDeductionMinor: standard?.amountMinor ?? null,
    surcharge: tiers.map(band),
    cessPct: cess?.ratePct ?? null,
    verifiedOn: oldestCheck(used),
    authorities,
  };
}

/**
 * Tax on an income by progressive bands: each rate applies only to the part of
 * the income that falls inside its band.
 */
function slabTaxOn(income: bigint, bands: readonly TaxRule[]): bigint {
  let tax = 0n;
  for (const band of bands) {
    const from = band.bandFromMinor ?? 0n;
    if (income <= from || band.ratePct === null) continue;
    const top = band.bandToMinor === null ? income : min(income, band.bandToMinor);
    tax += percentOf(top - from, band.ratePct);
  }
  return tax;
}

export function computeIncomeTax(options: {
  readonly regime: Regime;
  readonly fy: number;
  readonly salary: Money;
  /** Interest, rent and the like: anything the slab taxes that is not salary. */
  readonly otherIncome: Money;
  /** The year's capital gains, already netted. Must be for the same year. */
  readonly gains: CapitalGains;
  readonly rules: readonly TaxRule[];
}): IncomeTaxComputation {
  const { regime, fy, gains, rules } = options;

  if (gains.fy !== fy) {
    throw new Error(`The gains are for tax year ${String(gains.fy)}, not ${String(fy)}.`);
  }
  if (options.salary.currency !== CURRENCY || options.otherIncome.currency !== CURRENCY) {
    throw new Error('Income tax is computed in rupees.');
  }

  const on = taxYearBounds(fy).end;
  const refused: Refusal[] = [];

  const slabs = bandsOf(rules, 'slab', regime, on);
  const tiers = bandsOf(rules, 'surcharge', regime, on);
  const cessRule = ruleOf(rules, 'cess', null, on);
  const rebateRule = ruleOf(rules, 'rebate', regime, on);
  const standardRule = ruleOf(rules, 'deduction_cap', regime, on, 'standard_deduction');

  const salary = options.salary.minor;
  const other = options.otherIncome.minor;
  const shortTermAtSlab = gains.otherShort.taxable.minor;

  const standardDeduction = standardRule === null ? 0n : min(salary, standardRule.amountMinor ?? 0n);
  const ordinary = positive(salary - standardDeduction + other + shortTermAtSlab);

  // The basic exemption: the top of the nil band. What other income has not used
  // of it is set against the gains before they are taxed.
  const first = slabs[0];
  const basicExemption =
    first !== undefined && first.ratePct !== null && thousandths(first.ratePct) === 0n
      ? (first.bandToMinor ?? 0n)
      : 0n;
  const shortfall = positive(basicExemption - ordinary);

  const capitalGains = capitalGainsTax(gains, rules, { basicExemptionShortfall: inr(shortfall) });
  const capitalGainsTaxable =
    capitalGains.equityShort.taxable.minor +
    (capitalGains.equityLong?.taxable.minor ?? 0n) +
    capitalGains.otherLong.taxable.minor;
  const totalIncome = ordinary + capitalGainsTaxable;

  const verifiedOn = oldestCheck([...slabs, ...tiers, cessRule, rebateRule, standardRule]);

  const shell = {
    fy,
    regime,
    salary: options.salary,
    standardDeduction: inr(standardDeduction),
    otherIncome: options.otherIncome,
    shortTermAtSlab: inr(shortTermAtSlab),
    taxableOrdinary: inr(ordinary),
    basicExemptionAdjustment: capitalGains.adjustedForBasicExemption,
    capitalGains,
    capitalGainsTaxable: inr(capitalGainsTaxable),
    totalIncome: inr(totalIncome),
    verifiedOn,
  };

  // No slab, no cess, or no standard deduction where there is a salary to take
  // it from: a year this cannot rate. Refused whole rather than run on another
  // year's rows or with a piece missing.
  if (slabs.length === 0 || cessRule === null || (salary > 0n && standardRule === null)) {
    return {
      ...shell,
      slabTax: null,
      rebate: null,
      marginalRelief: inr(0n),
      taxAfterRebate: null,
      surcharge: null,
      surchargeRelief: inr(0n),
      cess: null,
      total: null,
      refused: ['no-rule-for-year'],
    };
  }

  const slabTax = slabTaxOn(ordinary, slabs);

  // ── the rebate, against tax on ordinary income and never on a gain ──
  let rebate = 0n;
  let marginalRelief = 0n;
  let taxAfterRebate = slabTax;

  if (rebateRule !== null) {
    const ceiling = rebateRule.bandToMinor ?? 0n;
    if (totalIncome <= ceiling) {
      rebate = min(slabTax, rebateRule.amountMinor ?? 0n);
      taxAfterRebate = slabTax - rebate;
    } else if (regime === 'new') {
      // Just above the ceiling the new regime softens the cliff: the tax may not
      // exceed the income above it. The old regime has no such relief — its
      // rebate ends at ₹5 lakh and the whole of it is lost.
      const excess = totalIncome - ceiling;
      if (slabTax > excess) {
        if (capitalGainsTaxable > 0n) {
          refused.push('rebate-relief-on-capital-gains');
        } else {
          marginalRelief = slabTax - excess;
          taxAfterRebate = excess;
        }
      }
    }
  }

  // ── the surcharge, on the tax after rebate ──
  let surcharge: bigint | null = 0n;
  let surchargeRelief = 0n;

  const tierIndex = tiers.reduce((found, tier, at) => ((tier.bandFromMinor ?? 0n) < totalIncome ? at : found), -1);
  const tier = tierIndex === -1 ? undefined : tiers[tierIndex];

  if (tier !== undefined && tier.ratePct !== null) {
    if (capitalGainsTaxable > 0n) {
      // The surcharge on a capital gain is capped at 15% and its relief has to be
      // worked across two kinds of income. Not modelled: no figure, and the reason.
      refused.push('surcharge-on-capital-gains');
      surcharge = null;
    } else {
      const raw = percentOf(taxAfterRebate, tier.ratePct);
      const threshold = tier.bandFromMinor ?? 0n;
      const before = tierIndex === 0 ? undefined : tiers[tierIndex - 1];
      const rateBelow = before?.ratePct ?? '0';

      // Tax including surcharge may not exceed the tax at the threshold, with the
      // surcharge that applied below it, plus the income above the threshold.
      const taxAtThreshold = slabTaxOn(threshold, slabs);
      const limit = taxAtThreshold + percentOf(taxAtThreshold, rateBelow) + (totalIncome - threshold);

      if (taxAfterRebate + raw > limit) {
        surcharge = positive(limit - taxAfterRebate);
        surchargeRelief = raw - surcharge;
      } else {
        surcharge = raw;
      }
    }
  }

  if (capitalGains.total === null) refused.push('capital-gains-tax-unknown');

  // ── the cess, on everything: tax, surcharge and the tax on gains ──
  const known = refused.length === 0 && surcharge !== null && capitalGains.total !== null;
  const cess =
    known && cessRule.ratePct !== null
      ? percentOf(taxAfterRebate + (surcharge ?? 0n) + (capitalGains.total?.minor ?? 0n), cessRule.ratePct)
      : null;
  const total =
    known && cess !== null
      ? taxAfterRebate + (surcharge ?? 0n) + (capitalGains.total?.minor ?? 0n) + cess
      : null;

  return {
    ...shell,
    slabTax: inr(slabTax),
    rebate: inr(rebate),
    marginalRelief: inr(marginalRelief),
    taxAfterRebate: inr(taxAfterRebate),
    surcharge: surcharge === null ? null : inr(surcharge),
    surchargeRelief: inr(surchargeRelief),
    cess: cess === null ? null : inr(cess),
    total: total === null ? null : inr(total),
    refused,
  };
}
