/**
 * How much of something is held.
 *
 * A quantity is not money and must not borrow the money representation. Money
 * is minor units of a currency whose exponent the currency fixes — two for the
 * rupee, none for the yen. A quantity is a count of units of an instrument,
 * and brokers sell fractions of a share: "Fractional shares are ordinary on US
 * brokers — INDmoney sells them" (`20260905120000_instrument_holding.sql`).
 * The column is `numeric(28, 8)` for that reason.
 *
 * So quantities live here, at a fixed scale of eight, as bigints. Never a
 * Number: 0.1 + 0.2 is the reason, and a position that drifts by a
 * hundred-millionth per edit compounds into a reconciliation nobody can
 * explain.
 *
 * The scale is the column's, deliberately. Anything this module accepts,
 * Postgres stores exactly; anything Postgres holds, this module reads back
 * without loss. A parser more generous than the column would round on the way
 * in, which is the same bug as rounding on the way out and harder to see.
 */

/** Decimal places, matching `numeric(28, 8)` throughout the schema. */
export const QUANTITY_SCALE = 8;

const FACTOR = 10n ** BigInt(QUANTITY_SCALE);

/**
 * Parse what a person typed into a scaled integer.
 *
 * Strict in the same way `parseAmountToMinor` is: it refuses precision it
 * cannot keep rather than discarding it silently. The string is taken apart
 * digit by digit and never becomes a Number.
 */
export function parseQuantity(input: string): bigint {
  // Whitespace (ordinary, non-breaking, narrow) and grouping commas, as the
  // money parser strips them — somebody typing 1,000 shares means a thousand.
  const stripped = input.trim().replace(/[\s  ,]/g, '');

  if (stripped.startsWith('-')) {
    throw new Error('A quantity is zero or positive; this app does not model a short position.');
  }

  const cleaned = stripped.replace(/^\+/, '');

  if (cleaned === '') {
    throw new Error('Enter a quantity.');
  }

  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) {
    throw new Error(`That is not a quantity: ${JSON.stringify(input)}`);
  }

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';

  if (fraction.length > QUANTITY_SCALE) {
    throw new Error(
      `A quantity carries eight decimal places, and this has ${String(fraction.length)}.`,
    );
  }

  return BigInt(whole + fraction.padEnd(QUANTITY_SCALE, '0'));
}

/**
 * Back to something a person reads: trailing padding goes, significant digits
 * stay. `formatQuantity(parseQuantity(x))` is `x` for everything the parser
 * accepts, which the tests hold to.
 */
export function formatQuantity(scaled: bigint): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(QUANTITY_SCALE + 1, '0');
  const whole = digits.slice(0, digits.length - QUANTITY_SCALE);
  const fraction = digits.slice(digits.length - QUANTITY_SCALE).replace(/0+$/, '');
  const sign = negative ? '-' : '';
  return fraction === '' ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/**
 * The form Postgres takes, with all eight places written out.
 *
 * A `numeric(28, 8)` column stores the scale it declared whatever it is given,
 * so this is about what crosses the wire: an unpadded string and a padded one
 * are the same value, and sending the padded one means what the repository
 * sent and what the row holds are the same characters. That is one fewer thing
 * to wonder about when a figure looks wrong.
 */
export function quantityToNumeric(scaled: bigint): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(QUANTITY_SCALE + 1, '0');
  const whole = digits.slice(0, digits.length - QUANTITY_SCALE);
  const fraction = digits.slice(digits.length - QUANTITY_SCALE);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** The scale factor, for callers doing their own arithmetic. `1` is `ONE`. */
export const ONE = FACTOR;
