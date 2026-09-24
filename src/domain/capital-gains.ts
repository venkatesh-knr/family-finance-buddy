/**
 * Netting equity capital gains for a tax year, and the ₹1.25 lakh allowance.
 *
 * `docs/blueprint.md`'s pipeline, steps 3 and 4, for the one asset group the
 * annual exemption applies to — listed equity and equity mutual funds, which
 * `tax_rule` seeds as a single combined allowance rather than one each:
 *
 *   Net      short-term losses against any gains; long-term losses against
 *            long-term gains only.
 *   Exempt   apply the ₹1.25 lakh equity allowance to what is left of the
 *            long-term gain.
 *
 * Deliberately narrower than the whole engine. `loss_carry_forward` does not
 * exist yet, so an unrelieved loss is reported and not carried anywhere — the
 * screen can say what is left over; only a later migration can remember it
 * into next year. Gold, debt funds, foreign equity, unlisted equity and
 * property are out of scope: netting every asset class together, and the
 * general "short-term loss against any gain" rule that spans them, belongs to
 * a wider netter this is not attempting to be.
 *
 * Pure. No I/O, no `Date.now()` — the tax year is a plain number, and
 * `taxYearBounds` turns it into the dates this refuses sales outside of.
 */

import { taxYearBounds } from './budget.ts';
import type { Parcel } from './lots.ts';
import { classify, longTermRate, type AssetClass, type TaxRule } from './tax-rules.ts';
import type { IsoDate } from '../lib/dates.ts';
import { money, type Money } from '../lib/money.ts';

/** The two `tax_rule` asset classes the ₹1.25 lakh allowance is seeded for. */
const EQUITY_CLASSES: ReadonlySet<AssetClass> = new Set(['listed_equity', 'equity_fund']);

/**
 * Whether a class is one this module nets and the allowance covers.
 *
 * Exported so a screen listing sales says "netted" by asking the same question
 * the netter asks, rather than keeping a second list that drifts from it.
 */
export function isEquityClass(assetClass: AssetClass): boolean {
  return EQUITY_CLASSES.has(assetClass);
}

/**
 * The exemption is minor units of INR — "the jurisdiction's currency" the
 * `tax_rule` migration's own comment names. Equity funds and listed shares are
 * bought and sold in India regardless of what they expose to, so a parcel in
 * any other currency is a data problem this refuses rather than guesses past.
 */
const CURRENCY = 'INR';

export interface ExcludedParcel {
  readonly lotId: string;
  readonly disposalId: string;
  readonly instrumentId: string;
  /**
   * 'unclassified-asset' and 'no-rule-for-date' are `classify`'s own reasons,
   * carried through rather than re-decided. 'currency-mismatch' should not
   * occur for a real equity holding — see `CURRENCY` — and exists so a data
   * problem is named rather than silently netted into a total that would be
   * wrong in a currency nobody chose.
   */
  readonly reason: 'unclassified-asset' | 'no-rule-for-date' | 'currency-mismatch';
}

export interface EquityCapitalGains {
  readonly fy: number;
  readonly window: { readonly start: IsoDate; readonly end: IsoDate };
  readonly shortTerm: {
    /** Every short-term equity parcel in the year, summed. Can be negative — a net loss. */
    readonly net: Money;
    /** Never negative. A loss shows in `unrelieved.shortTerm`, not here. */
    readonly taxable: Money;
  };
  readonly longTerm: {
    /** Every long-term equity parcel in the year, summed, before set-off. */
    readonly net: Money;
    readonly exemption: {
      readonly available: Money;
      /** Never more than `available`, and never more than there was gain left to use it on. */
      readonly used: Money;
      readonly authority: string;
    } | null;
    /**
     * Null only when `exemption` is null — no rule covers this year, and a
     * taxable figure computed without one would be a number this app is not
     * willing to make up. Otherwise never negative.
     */
    readonly taxable: Money | null;
  };
  /** How much of a short-term loss was used to reduce the long-term gain. Zero when there was none of either. */
  readonly setOffAgainstLongTerm: Money;
  readonly unrelieved: {
    /** What is left of a short-term loss after set-off, or null. Not carried anywhere. */
    readonly shortTerm: Money | null;
    /** What is left of a long-term loss — never offered a short-term gain to absorb it. Not carried anywhere. */
    readonly longTerm: Money | null;
  };
  /** Parcels this could not place, and why. Never silently dropped from the total. */
  readonly excluded: readonly ExcludedParcel[];
}

/** The exemption band for this equity group, as of a date, or null. */
function exemptionOn(rules: readonly TaxRule[], on: IsoDate): TaxRule | null {
  let best: TaxRule | null = null;
  for (const rule of rules) {
    if (rule.kind !== 'exemption' || rule.assetClass === null || !EQUITY_CLASSES.has(rule.assetClass)) {
      continue;
    }
    if (rule.effectiveFrom > on) continue;
    if (rule.effectiveTo !== null && rule.effectiveTo < on) continue;
    if (best === null || rule.effectiveFrom > best.effectiveFrom) best = rule;
  }
  return best;
}

export function netEquityGains(options: {
  readonly parcels: readonly Parcel[];
  /** Every instrument's tax asset class this household holds, by id. Missing means unclassified. */
  readonly assetClassOf: ReadonlyMap<string, AssetClass | null>;
  readonly rules: readonly TaxRule[];
  readonly fy: number;
}): EquityCapitalGains {
  const window = taxYearBounds(options.fy);

  let shortTermMinor = 0n;
  let longTermMinor = 0n;
  const excluded: ExcludedParcel[] = [];

  for (const parcel of options.parcels) {
    if (parcel.disposedOn < window.start || parcel.disposedOn > window.end) continue;

    const assetClass = options.assetClassOf.get(parcel.instrumentId) ?? null;
    if (assetClass === null) {
      excluded.push({
        lotId: parcel.lotId,
        disposalId: parcel.disposalId,
        instrumentId: parcel.instrumentId,
        reason: 'unclassified-asset',
      });
      continue;
    }

    // Known, and known to be something this module does not net — a data
    // problem for a different screen, not a reason to stop here.
    if (!EQUITY_CLASSES.has(assetClass)) continue;

    if (parcel.gain.currency !== CURRENCY) {
      excluded.push({
        lotId: parcel.lotId,
        disposalId: parcel.disposalId,
        instrumentId: parcel.instrumentId,
        reason: 'currency-mismatch',
      });
      continue;
    }

    const classification = classify(options.rules, {
      assetClass,
      acquiredOn: parcel.acquiredOn,
      disposedOn: parcel.disposedOn,
    });
    if (!classification.known) {
      excluded.push({
        lotId: parcel.lotId,
        disposalId: parcel.disposalId,
        instrumentId: parcel.instrumentId,
        reason: classification.reason,
      });
      continue;
    }

    if (classification.term === 'long') longTermMinor += parcel.gain.minor;
    else shortTermMinor += parcel.gain.minor;
  }

  // Short-term losses reduce a long-term gain; long-term losses never touch a
  // short-term gain. "Long-term losses against long-term gains only" is the
  // whole reason this is two variables and not one net figure.
  const setOff =
    shortTermMinor < 0n && longTermMinor > 0n
      ? (-shortTermMinor < longTermMinor ? -shortTermMinor : longTermMinor)
      : 0n;

  const shortTermAfterSetOff = shortTermMinor + setOff;
  const longTermAfterSetOff = longTermMinor - setOff;

  const exemptionRule = exemptionOn(options.rules, window.end);
  const longTermGainToExempt = longTermAfterSetOff > 0n ? longTermAfterSetOff : 0n;

  const exemption =
    exemptionRule === null
      ? null
      : {
          available: money(exemptionRule.bandToMinor ?? 0n, CURRENCY),
          used: money(
            (exemptionRule.bandToMinor ?? 0n) < longTermGainToExempt
              ? (exemptionRule.bandToMinor ?? 0n)
              : longTermGainToExempt,
            CURRENCY,
          ),
          authority: exemptionRule.authority,
        };

  return {
    fy: options.fy,
    window,
    shortTerm: {
      net: money(shortTermMinor, CURRENCY),
      taxable: money(shortTermAfterSetOff > 0n ? shortTermAfterSetOff : 0n, CURRENCY),
    },
    longTerm: {
      net: money(longTermMinor, CURRENCY),
      exemption,
      taxable: exemption === null ? null : money(longTermGainToExempt - exemption.used.minor, CURRENCY),
    },
    setOffAgainstLongTerm: money(setOff, CURRENCY),
    unrelieved: {
      shortTerm: shortTermAfterSetOff < 0n ? money(-shortTermAfterSetOff, CURRENCY) : null,
      longTerm: longTermAfterSetOff < 0n ? money(-longTermAfterSetOff, CURRENCY) : null,
    },
    excluded,
  };
}

export interface TermTax {
  /** What was taxable in this term after set-off and the allowance. */
  readonly taxable: Money;
  /** The rate applied, as `tax_rule` holds it. Null when nothing was taxable and none was needed. */
  readonly ratePct: string | null;
  /** Where the rate came from, so a figure can be traced rather than argued about. */
  readonly authority: string | null;
  /**
   * Null when there is a taxable gain and no rate to apply to it — refused, not
   * assumed to be nothing. Zero, with no rate needed, when nothing was taxable.
   */
  readonly tax: Money | null;
}

export interface EquityTax {
  readonly shortTerm: TermTax;
  /** Null when the exemption is unknown: what is taxable long term cannot be said. */
  readonly longTerm: TermTax | null;
  /** Null unless every part of it is known. A total short by a refused part would read as complete. */
  readonly total: Money | null;
}

/**
 * The rate for a term, as of a date, when listed shares and equity funds agree.
 *
 * The allowance is combined across the two, and so is what is left of it, so
 * they are taxed as one bucket. Two rates for one bucket would mean choosing
 * one, which is a guess — so disagreement is a refusal. They are seeded equal
 * today; this is what makes that a fact the code checks rather than assumes.
 */
function equityRate(rules: readonly TaxRule[], term: 'long' | 'short', on: IsoDate): TaxRule | null {
  const listed = longTermRate(rules, 'listed_equity', term, on);
  const fund = longTermRate(rules, 'equity_fund', term, on);
  if (listed === null || fund === null || listed.ratePct === null || fund.ratePct === null) return null;
  return thousandths(listed.ratePct) === thousandths(fund.ratePct) ? listed : null;
}

/** A rate in `numeric(6,3)` text — `12.5`, `12.500` — as an integer count of thousandths of a percent. */
function thousandths(ratePct: string): bigint {
  const [whole = '0', fraction = ''] = ratePct.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0').slice(0, 3));
}

/**
 * `minor × rate%`, half a paisa rounding up, entirely in bigint.
 *
 * Half up rather than truncating: a tax that always rounds down is a small
 * standing error in one direction, and the sum of several terms would carry it.
 * Non-negative only — a taxable figure never is anything else.
 */
function percentOf(minor: bigint, ratePct: string): bigint {
  return (minor * thousandths(ratePct) + 50_000n) / 100_000n;
}

/**
 * What the netted gains cost, before surcharge and cess.
 *
 * Equity gains are taxed at rates of their own — 20% short term, 12.5% long
 * term after the allowance — and not at the slab, so this is a multiplication
 * and nothing more. Surcharge and the 4% cess sit on top of it, in a later step
 * that also needs the taxpayer's other income; nothing here pretends to be that.
 *
 * Rates are read as of the last day of the year, like the allowance. That is
 * sound while earlier regimes are not seeded, because a sale under one is
 * refused by `classify` and never reaches these totals.
 */
export function equityTax(gains: EquityCapitalGains, rules: readonly TaxRule[]): EquityTax {
  const on = gains.window.end;

  const termTax = (taxable: Money, term: 'long' | 'short'): TermTax => {
    if (taxable.minor === 0n) {
      return { taxable, ratePct: null, authority: null, tax: money(0n, CURRENCY) };
    }
    const rule = equityRate(rules, term, on);
    if (rule === null || rule.ratePct === null) {
      return { taxable, ratePct: null, authority: null, tax: null };
    }
    return {
      taxable,
      ratePct: rule.ratePct,
      authority: rule.authority,
      tax: money(percentOf(taxable.minor, rule.ratePct), CURRENCY),
    };
  };

  const shortTerm = termTax(gains.shortTerm.taxable, 'short');
  const longTerm = gains.longTerm.taxable === null ? null : termTax(gains.longTerm.taxable, 'long');

  const total =
    longTerm === null || shortTerm.tax === null || longTerm.tax === null
      ? null
      : money(shortTerm.tax.minor + longTerm.tax.minor, CURRENCY);

  return { shortTerm, longTerm, total };
}
