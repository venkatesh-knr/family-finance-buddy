/**
 * Money — integer minor units, always carrying a currency.
 *
 * Two rules from CLAUDE.md drive every line here:
 *   * money is integer minor units (paise, cents) in bigint, never a float;
 *   * every amount carries a currency, and formatting happens only at the
 *     display edge.
 *
 * Nothing in this module converts between currencies. Conversion is a dated
 * lookup against fx_rate at the transaction's own date, and it belongs in the
 * domain layer once that table exists — not in a formatter.
 */

/** An ISO 4217 code, upper case. */
export type CurrencyCode = string;

export interface Money {
  readonly minor: bigint;
  readonly currency: CurrencyCode;
}

const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * The codes that actually exist, from ICU.
 *
 * Deliberately separate from `isCurrencyCode`, and the split matters.
 *
 * `isCurrencyCode` is a shape test, and reading stays on it. Rows already
 * written with a code this list does not recognise still have to load: a
 * holding recorded before the check existed is data, and refusing to map it
 * would take the screen down rather than let somebody go and fix the row.
 *
 * `isKnownCurrency` is for input, where the answer can still be changed. That
 * is where "ABC" was getting in — three capitals passes a shape test, and the
 * form asked for three capitals.
 *
 * `Intl.supportedValuesOf` is not in every runtime this could end up in, so a
 * missing implementation means the shape test alone rather than an app that
 * cannot record anything.
 */
let knownCurrencies: ReadonlySet<string> | null = null;

function currencyList(): ReadonlySet<string> | null {
  if (knownCurrencies !== null) return knownCurrencies;
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported !== 'function') return null;
  try {
    knownCurrencies = new Set(supported('currency'));
    return knownCurrencies;
  } catch {
    return null;
  }
}

/** Every ISO 4217 code this runtime knows, sorted. Empty when ICU cannot say. */
export function knownCurrencyCodes(): readonly string[] {
  const list = currencyList();
  return list === null ? [] : [...list].sort();
}

/** Whether a code names a real currency. Falls back to the shape test. */
export function isKnownCurrency(value: string): boolean {
  const list = currencyList();
  if (list === null) return isCurrencyCode(value);
  return list.has(value);
}

/** The display locale. Indian grouping for the rupee, sane output for the rest. */
const LOCALE = 'en-IN';

export function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODE.test(value);
}

export function money(minor: bigint, currency: CurrencyCode): Money {
  if (!isCurrencyCode(currency)) {
    throw new Error(`Not an ISO 4217 currency code: ${JSON.stringify(currency)}`);
  }
  return { minor, currency };
}

/**
 * How many decimal places the currency has: 2 for INR and USD, 0 for JPY.
 * Read from ICU rather than kept in a table here, so a currency we have not
 * thought about still behaves correctly.
 */
export function minorUnitExponent(currency: CurrencyCode): number {
  if (!isCurrencyCode(currency)) {
    throw new Error(`Not an ISO 4217 currency code: ${JSON.stringify(currency)}`);
  }
  const resolved = new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
  }).resolvedOptions();
  // ICU always resolves this for a currency format; the fallback is only here
  // because the type says it may be absent, and two is right for most of the
  // world when it is.
  return resolved.maximumFractionDigits ?? 2;
}

/**
 * Parse what a person typed into minor units.
 *
 * Deliberately strict. It refuses more precision than the currency has instead
 * of rounding it away, because silently discarding a paise is exactly the class
 * of bug this whole representation exists to prevent. The string is taken apart
 * digit by digit; it never becomes a Number.
 */
export function parseAmountToMinor(input: string, currency: CurrencyCode): bigint {
  const exponent = minorUnitExponent(currency);

  // Strip whitespace (ordinary, non-breaking and narrow) and grouping commas.
  const stripped = input.trim().replace(/[\s  ,]/g, '');

  // The sign is checked before any symbol is removed. Stripping a leading
  // currency symbol first would quietly swallow a minus along with it, and a
  // negative expense would land in the ledger as a positive one.
  if (/[+-]/.test(stripped)) {
    throw new Error('An expense is a positive amount.');
  }

  // Now the leading or trailing currency symbol or code can go.
  const cleaned = stripped.replace(/^[^\d.]+/, '').replace(/[^\d.]+$/, '');

  if (cleaned === '') {
    throw new Error('Enter an amount.');
  }

  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) {
    throw new Error(`That is not an amount: ${JSON.stringify(input)}`);
  }

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';

  if (fraction.length > exponent) {
    throw new Error(
      exponent === 0
        ? `${currency} has no minor unit, so it takes a whole number.`
        : `${currency} carries two decimal places, and this has ${String(fraction.length)}.`,
    );
  }

  const padded = fraction.padEnd(exponent, '0');
  return BigInt(whole + padded);
}

export interface FormatMoneyOptions {
  /**
   * Privacy mode (docs/tokens.md §8): the amount becomes bullets while the
   * currency symbol stays. A formatter switch rather than a CSS blur, because
   * a blur is recoverable from a screenshot and this needs to survive one.
   */
  readonly privacy?: boolean;
  /**
   * Keep `.00` on a whole amount.
   *
   * Off by default, because most figures in a household ledger are whole
   * rupees and two zeros after every one of them is noise that crowds a phone
   * screen. An amount with actual paise always keeps them — this drops a
   * fraction that says nothing, never one that does.
   *
   * Worth turning on for a column of figures that must align digit for digit,
   * where a ragged right edge costs more than the zeros do.
   */
  readonly alwaysShowMinorUnits?: boolean;
  /**
   * Abbreviate a large figure: ₹1.25 Cr rather than ₹1,25,50,000.
   *
   * For headline figures only — a net worth, a portfolio total, a FIRE
   * target. Those are read at a glance and compared against each other, and
   * eight digits with three group separators is a number somebody has to
   * count their way through before they know its size.
   *
   * Never for a ledger, a form, or anything reconciled against a statement.
   * Abbreviating loses precision by design, and a figure that has to match a
   * bank to the paise must not lose any. Callers opt in one figure at a time
   * for exactly that reason — the default stays exact.
   *
   * Lakh and crore for the rupee, because that is how the figure is spoken
   * where this app is used. Not for other currencies: a dollar total has no
   * lakhs, and printing one would be inventing a unit nobody reading it uses.
   */
  readonly compact?: boolean;
}

/** Where abbreviation starts: one lakh, and one crore. */
const LAKH = 100000n;
const CRORE = 10000000n;

/**
 * Two decimal places at most, and no trailing zeros.
 *
 * "1.5 Cr" rather than "1.50 Cr", "1 Cr" rather than "1.00 Cr" — the zeros
 * are precision the abbreviation does not have, and printing them claims
 * accuracy it cannot deliver.
 */
function scaled(units: bigint, divisor: bigint): string {
  // Two extra digits, rounded half away from zero, entirely in bigint: the
  // whole point of this representation is that no figure passes through a
  // double, and a display path is no exception.
  const doubled = units * 200n;
  const quotient = doubled / divisor;
  const hundredths = quotient >= 0n ? (quotient + 1n) / 2n : (quotient - 1n) / 2n;

  const whole = hundredths / 100n;
  const rest = (hundredths < 0n ? -hundredths : hundredths) % 100n;
  if (rest === 0n) return whole.toString();
  const two = rest.toString().padStart(2, '0');
  return `${whole.toString()}.${two.replace(/0$/, '')}`;
}

export function formatMoney(value: Money, options: FormatMoneyOptions = {}): string {
  const exponent = minorUnitExponent(value.currency);
  const negative = value.minor < 0n;

  // Privacy first: it outranks every other option here, and a compact figure
  // is still a figure.
  if (options.compact === true && options.privacy !== true) {
    const compact = formatCompact(value, exponent, negative);
    if (compact !== null) return compact;
  }
  const digits = (negative ? -value.minor : value.minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const minorPart = exponent === 0 ? '' : digits.slice(digits.length - exponent);

  // A whole amount loses its zeros unless somebody asked to keep them. Paise
  // that exist are always shown: this drops a fraction that says nothing, and
  // never one that does.
  const isWhole = minorPart === '' || /^0+$/.test(minorPart);
  const fractionDigits = isWhole && options.alwaysShowMinorUnits !== true ? 0 : exponent;

  const formatter = new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  if (options.privacy === true) {
    const symbol = formatter
      .formatToParts(0)
      .filter((part) => part.type === 'currency')
      .map((part) => part.value)
      .join('');
    return `${symbol}•••••`;
  }

  const fraction = minorPart === '' ? '' : `.${minorPart}`;

  // The string goes to Intl as a string, so a large figure is never squeezed
  // through a double on the way to being displayed.
  return formatter.format(`${negative ? '-' : ''}${whole}${fraction}` as unknown as number);
}

/**
 * The abbreviated form, or null when the figure is small enough to show whole.
 *
 * Below a lakh there is nothing to gain: the full number is short enough to
 * read and abbreviating it would only lose paise.
 */
function formatCompact(value: Money, exponent: number, negative: boolean): string | null {
  const magnitude = negative ? -value.minor : value.minor;
  const major = magnitude / 10n ** BigInt(exponent);

  const symbol = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: value.currency })
    .formatToParts(0)
    .filter((part) => part.type === 'currency')
    .map((part) => part.value)
    .join('');

  // Lakh and crore are how a rupee figure is spoken in India. Everywhere else
  // gets the local compact notation instead of a unit its readers do not use.
  if (value.currency !== 'INR') {
    if (major < 1000n) return null;
    // en-US, not the app's display locale. Compact notation follows the
    // LOCALE, so asking en-IN for a compact dollar gives "$1.00L" — Indian
    // units on an American figure, which is the confusion this branch exists
    // to avoid rather than a formatting detail.
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: value.currency,
      notation: 'compact',
      // A currency format defaults to two fraction digits, which in compact
      // notation prints "$100.00K". The zeros are precision the abbreviation
      // does not have, same as on the rupee side.
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(Number(major) * (negative ? -1 : 1));
  }

  if (major < LAKH) return null;

  const sign = negative ? '-' : '';
  return major >= CRORE
    ? `${sign}${symbol}${scaled(major, CRORE)} Cr`
    : `${sign}${symbol}${scaled(major, LAKH)} L`;
}

/**
 * The figure without abbreviation, for the title on a compact one.
 *
 * Null under privacy. A tooltip that gives away the amount the bullets are
 * hiding would make the whole mode decorative — "a privacy control nobody can
 * observe working is indistinguishable from one that does nothing", and one
 * that can be defeated by hovering is worse than that.
 */
export function exactMoney(value: Money, privacy = false): string | null {
  return privacy ? null : formatMoney(value);
}

/**
 * A gain as a percentage of what was put in, signed.
 *
 * The sign is not decoration. "Never encode meaning in colour alone" — a
 * figure tinted coral means nothing to somebody who cannot see the tint, and
 * "-25%" means the same thing to everybody.
 *
 * Null when nothing was invested. Not "0%", which is a claim about
 * performance nobody made, and not infinity: a holding whose cost was never
 * recorded has no return to report, and saying so is the honest answer.
 *
 * One decimal place, trailing zero dropped: "+7.5%", "+50%". Percentages are
 * compared at a glance and a second decimal is noise at that size.
 */
export function percentOfCost(gainMinor: bigint, investedMinor: bigint): string | null {
  if (investedMinor === 0n) return null;

  // Tenths, rounded half away from zero, in bigint — the same discipline as
  // every other figure here. A ratio of two large amounts is exactly where a
  // double starts to drift.
  const doubled = gainMinor * 2000n;
  const quotient = doubled / investedMinor;
  const tenths = quotient >= 0n ? (quotient + 1n) / 2n : (quotient - 1n) / 2n;

  const negative = tenths < 0n;
  const magnitude = negative ? -tenths : tenths;
  const whole = magnitude / 10n;
  const rest = magnitude % 10n;

  const sign = negative ? '-' : tenths > 0n ? '+' : '';
  return `${sign}${whole.toString()}${rest === 0n ? '' : `.${rest.toString()}`}%`;
}
