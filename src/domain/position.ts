/**
 * How many units a position holds, and whether its history agrees.
 *
 * A position has been answering two questions from one source. *How much is it
 * worth* wants a count of units; *what did it cost* wants the purchases. A
 * statement requested for six months itemises six months of purchases and still
 * prints the closing balance of a folio ten years old — so deriving the count
 * from the purchases understated one real position by 93%, and said nothing.
 *
 * So the two come from the sources that know them:
 *
 *   Units are the registrar's closing balance as at its date, plus the net of
 *   whatever was recorded after it. That is right for a partial history and
 *   stays right for a household still running an SIP after the statement was
 *   cut.
 *
 *   Cost is never in this module. It is the sum of what was actually paid, and
 *   there is nothing to sum for units nobody itemised. Borrowing the closing
 *   balance to fill the gap would be inventing money.
 *
 * What this module does add is the disagreement: whether the purchases it was
 * given account for the balance the statement reported, judged as at the
 * statement's date. A caller that sees a qualified history refuses the return
 * rather than printing a gain measured against a cost that covers a tenth of
 * the units.
 *
 * Pure, and it takes no date. "As at" is the statement's own.
 */

import type { IsoDate } from '../lib/dates.ts';
import { QUANTITY_SCALE } from '../lib/quantity.ts';
import type { Disposal, Lot } from './lots.ts';

/** The registrar's count of units held, on a date. */
export interface StatedBalance {
  /** Scaled like every quantity. */
  readonly units: bigint;
  readonly asOf: IsoDate;
}

/**
 * Whether the recorded purchases account for the stated balance.
 *
 * 'short' is the ordinary case — a statement that began partway through a
 * holding's life. 'over' is the other way round, and is marked just the same:
 * purchases that add up to more than the registrar says is a wrong figure
 * somewhere, a doubled line or a redemption never recorded, and a return
 * computed across it would be wrong in a direction nobody expects.
 */
export type History =
  | { readonly kind: 'unstated' }
  | {
      readonly kind: 'complete' | 'short' | 'over';
      /** Purchases minus sales, up to and including the statement date. */
      readonly lotUnits: bigint;
      readonly statedUnits: bigint;
      readonly asOf: IsoDate;
    };

/**
 * A registrar prints units to three decimals, so a difference smaller than a
 * thousandth of a unit is rounding in the print, not a missing instalment.
 */
const PRINTED_PRECISION = 10n ** BigInt(QUANTITY_SCALE - 3);

interface Input {
  readonly lots: readonly Lot[];
  readonly disposals: readonly Disposal[];
  readonly stated: StatedBalance | null;
}

/**
 * Units to value the position at.
 *
 * `unstated` is whatever the caller already derived for a position with no
 * statement behind it, returned untouched — a household that never imported
 * anything sees no change at all.
 */
export function unitsHeld(input: Input & { readonly unstated: bigint }): bigint {
  const { stated } = input;
  if (stated === null) return input.unstated;

  const bought = sum(input.lots.filter((lot) => lot.acquiredOn > stated.asOf).map((lot) => lot.quantity));
  const sold = sum(
    input.disposals.filter((sale) => sale.disposedOn > stated.asOf).map((sale) => sale.quantity),
  );

  return stated.units + bought - sold;
}

export function historyOf(input: Input): History {
  const { stated } = input;
  if (stated === null) return { kind: 'unstated' };

  const lotUnits =
    sum(input.lots.filter((lot) => lot.acquiredOn <= stated.asOf).map((lot) => lot.quantity)) -
    sum(input.disposals.filter((sale) => sale.disposedOn <= stated.asOf).map((sale) => sale.quantity));

  const gap = stated.units - lotUnits;
  const kind = abs(gap) < PRINTED_PRECISION ? 'complete' : gap > 0n ? 'short' : 'over';

  return { kind, lotUnits, statedUnits: stated.units, asOf: stated.asOf };
}

/** Whether the cost and the gain measured against it should be refused. */
export function isQualified(history: History): boolean {
  return history.kind === 'short' || history.kind === 'over';
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
