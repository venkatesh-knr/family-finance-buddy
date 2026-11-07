/**
 * The cost of a purchase of physical gold, typed one of two ways (docs/design/gold.md section 2; GD-I8).
 *
 * A switch, Price paid or Rate per gram. Whichever is typed, the other is worked out and shown beside it, and what is stored is one
 * figure: the cost of the lot, in paise. A rate typed is multiplied by the grams on the device and is not kept.
 */

import { costFromRate, formatGrams, ratePerGram } from '../../domain/gold.ts';
import { formatMoney, money, parseAmountToMinor } from '../../lib/money.ts';
import { parseQuantity } from '../../lib/quantity.ts';
import { Field } from '../../ui/primitives.tsx';

export const GOLD_CURRENCY = 'INR';

/** Grams as a bill shows them: up to three decimals. */
const GRAMS = /^\s*\d[\d,]*(\.\d{0,3})?\s*$/;

/** A number of grams above nothing, or null for what is not yet one. */
export function gramsOf(text: string): bigint | null {
  if (!GRAMS.test(text)) return null;
  try {
    const grams = parseQuantity(text);
    return grams > 0n ? grams : null;
  } catch {
    return null;
  }
}

/** An amount above nothing, or null for what is not yet one. */
export function amountOf(text: string): bigint | null {
  if (text.trim() === '') return null;
  try {
    const minor = parseAmountToMinor(text, GOLD_CURRENCY);
    return minor > 0n ? minor : null;
  } catch {
    return null;
  }
}

export type CostBy = 'price' | 'rate';

/** The cost of the lot, in paise, from what was typed: null until there is enough to work it out. A gift costs nothing that is known. */
export function workedCost(input: { readonly gift: boolean; readonly costBy: CostBy; readonly typed: string; readonly grams: bigint | null }): bigint | null {
  if (input.gift) return 0n;
  const typed = amountOf(input.typed);
  if (typed === null) return null;
  if (input.costBy === 'price') return typed;
  return input.grams === null ? null : costFromRate(typed, input.grams);
}

/** What the lot's note says of how its cost was typed (GD-I8 stores one figure; the note records the way in). */
export function costNoteOf(input: { readonly costBy: CostBy; readonly typed: string; readonly grams: bigint | null }): string {
  const typed = amountOf(input.typed);
  if (input.costBy === 'price' || typed === null || input.grams === null) return 'Price paid.';
  return `Rate per gram ${formatMoney(money(typed, GOLD_CURRENCY))} on the day, times ${formatGrams(input.grams)} g.`;
}

/** The other way of saying the cost, to show beside the one typed: the rate for a price, the price for a rate. */
function otherWay(input: { readonly costBy: CostBy; readonly typed: string; readonly grams: bigint | null }): string | null {
  const typed = amountOf(input.typed);
  if (typed === null || input.grams === null) return null;
  return input.costBy === 'price'
    ? `= ${formatMoney(money(ratePerGram(typed, input.grams) ?? 0n, GOLD_CURRENCY))} a gram`
    : `= ${formatMoney(money(costFromRate(typed, input.grams), GOLD_CURRENCY))} in all`;
}

export function GoldCost({
  grams,
  gift,
  costBy,
  typed,
  onCostBy,
  onTyped,
  error = null,
}: {
  /** What is wrong with the cost typed, in words, under the field. */
  error?: string | null;
  grams: bigint | null;
  gift: boolean;
  costBy: CostBy;
  typed: string;
  onCostBy: (next: CostBy) => void;
  onTyped: (next: string) => void;
}) {
  const other = gift ? null : otherWay({ costBy, typed, grams });
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="label" id="gold-cost-by">
          Cost, entered as
        </span>
        <div className="text-tabs" role="group" aria-labelledby="gold-cost-by">
          {(['price', 'rate'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={costBy === option}
              disabled={gift}
              onClick={() => {
                onCostBy(option);
                onTyped('');
              }}
            >
              {option === 'price' ? 'Price paid' : 'Rate per gram'}
            </button>
          ))}
        </div>
      </div>
      <div className="w-full">
        <Field
          label={costBy === 'price' ? `Price paid (${GOLD_CURRENCY})` : `Rate per gram (${GOLD_CURRENCY})`}
          numeric
          inputMode="decimal"
          disabled={gift}
          error={gift ? null : error}
          value={gift ? '' : typed}
          onChange={(event) => {
            onTyped(event.target.value);
          }}
        />
      </div>
      {other !== null && (
        <p className="field-help tabular-nums" data-testid="gold-other-way">
          {other}
        </p>
      )}
    </>
  );
}
