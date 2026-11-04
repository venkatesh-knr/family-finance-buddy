/**
 * A gold savings scheme's own screen (docs/design/gold.md; the GoldScheme board of docs/design/vibrant-canvas.html; GD-I2 to GD-I7).
 *
 * What is paid and what is left, when the next instalment falls due, what is redeemable at maturity if every instalment is paid, the
 * terms, the instalments, and a way to record one. The value net worth counts is the latest reading, as for every holding (HD-I1);
 * recording an instalment on an amount scheme records the value, which is the instalments paid, and the bonus is not in it until it is
 * credited (GD-I2). A weight scheme is valued from a rate for its purity and no rate is held yet, so it says it is not valued and
 * why (GD-I3). The caveat is always on the screen, in either detail mode: a scheme is held by a jeweller and redeemed as jewellery.
 *
 * Redemption is not here. It converts the scheme into physical gold and waits on the maintainer's answer about its cost basis
 * (docs/decisions.md, Open).
 */

import { useMemo, useState } from 'react';
import { minorToMajorText } from '../../domain/export/cells.ts';
import { goldValue, schemeState, type GoldTerms, type Instalment } from '../../domain/gold.ts';
import { formatIsoDate, isIsoDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney, minorUnitExponent, money, parseAmountToMinor } from '../../lib/money.ts';
import { formatQuantity, parseQuantity } from '../../lib/quantity.ts';
import { recordInstalment } from '../../repo/gold.ts';
import type { GoldSchemeTerms } from '../../repo/types.ts';
import { Attention, Button, Field, Problem, Stat } from '../../ui/primitives.tsx';
import type { GoldData } from './useGold.ts';
import type { HoldingRow } from './useHoldings.ts';

interface Shared {
  readonly row: HoldingRow;
  readonly gold: GoldData;
  readonly householdId: string;
  readonly today: IsoDate;
  readonly privacy: boolean;
  readonly canWrite: boolean;
  readonly onChanged: () => Promise<void>;
}

function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${String(day)}${suffix}`;
}

/** A scheme worked out on the day: its terms and instalments as the domain takes them, and the state and the value they give. */
function useWorkedGold(holdingId: string, gold: GoldData, today: IsoDate) {
  return useMemo(() => {
    const terms = gold.gold?.schemes.find((scheme) => scheme.holdingId === holdingId) ?? null;
    if (terms === null) return null;
    const paid = (gold.gold?.instalments ?? []).filter((instalment) => instalment.holdingId === holdingId);
    const domainTerms: GoldTerms = {
      variant: terms.variant,
      instalmentMinor: terms.instalment.minor,
      currency: terms.instalment.currency,
      instalments: terms.instalments,
      startDate: terms.startDate,
      dueDay: terms.dueDay,
      bonusMinor: terms.bonus === null ? null : terms.bonus.minor,
      bonusText: terms.bonusText,
      purity: terms.purity,
    };
    const instalments: Instalment[] = paid.map((instalment) => ({ date: instalment.date, amountMinor: instalment.amount.minor, grams: instalment.grams }));
    // No gold rate is written anywhere yet, so a weight scheme says why it is not valued (GD-I3): it is never valued from what was paid.
    return {
      terms,
      paid,
      state: schemeState(domainTerms, instalments, today),
      value: goldValue(domainTerms, instalments, [], today),
    };
  }, [holdingId, gold.gold, today]);
}

/** In the value card: what is paid, what is next, what is redeemable, and the caveat. */
export function GoldValue(props: Shared) {
  const { row, gold, today, privacy } = props;
  const worked = useWorkedGold(row.holding.id, gold, today);

  if (gold.failed) {
    return (
      <div className="mt-2">
        <Problem>The scheme could not be read, so nothing is said of it here. Reload to try again.</Problem>
      </div>
    );
  }
  if (worked === null) {
    return <p className="note mt-2">{gold.gold === null ? 'Reading the scheme…' : 'No terms are recorded for this scheme.'}</p>;
  }

  const { terms, state, value } = worked;
  const instalment = formatMoney(terms.instalment, { privacy });
  const missed = state.missed;

  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="gold-worked">
      <p className="note">
        paid so far · {state.paidCount} of {terms.instalments} instalments
        {state.overpaid && ' (more are recorded than the scheme has)'}
      </p>
      {state.nextDue !== null && (
        <p className="note" data-testid="gold-next">
          Next {instalment} on {formatIsoDate(state.nextDue)}
        </p>
      )}

      {missed.length > 0 && (
        <Attention
          headline={
            missed.length === 1
              ? `Instalment for ${formatIsoDate(missed[0] ?? today)} not recorded`
              : `${String(missed.length)} instalments not recorded, the earliest for ${formatIsoDate(missed[0] ?? today)}`
          }
        >
          Record {missed.length === 1 ? 'it' : 'them'}, or the bonus may not apply.
        </Attention>
      )}

      {terms.variant === 'amount' && state.atMaturity !== null && (
        <div>
          <span className="label block">At maturity, {formatIsoDate(state.matures)}</span>
          <span className="block text-[1.0625rem] font-medium tabular-nums" data-testid="gold-at-maturity">
            {formatMoney(money(state.atMaturity.minor, state.atMaturity.currency), { privacy })}
          </span>
          <p className="note">
            in jewellery
            {state.atMaturity.includesBonus && terms.bonusText !== null ? `, with a bonus of ${terms.bonusText}` : state.atMaturity.includesBonus ? ', with its bonus' : ''}
            {!state.atMaturity.includesBonus && terms.bonusText !== null ? `; the bonus (${terms.bonusText}) is not a figure, so it is not in this` : ''}
            {' · '}if every instalment is paid
          </p>
        </div>
      )}

      {terms.variant === 'weight' && (
        <div>
          <span className="label block">Bought so far</span>
          <span className="tabular-nums">{formatQuantity(state.gramsPaid ?? 0n)} g</span>
          {!value.ok && (
            <p className="note" role="status" data-testid="gold-not-valued">
              {value.reason === 'no-rate'
                ? `Not valued: there is no gold rate for ${terms.purity ?? 'its purity'} yet. A scheme by weight is worth its grams at the day's rate, and never what was paid.`
                : value.reason === 'no-grams'
                  ? 'Not valued: an instalment has no grams recorded. They are on the receipt.'
                  : 'Not valued.'}
            </p>
          )}
        </div>
      )}

      {/* Always, in either detail mode: it is what makes the figure honest (DL-I4). */}
      <p className="note" data-testid="gold-caveat">
        Held by a jeweller, not a bank, and redeemable only as jewellery. Not counted in your emergency fund or liquid money.
      </p>
    </div>
  );
}

/** Below the value card: the terms, the instalments, and a way to record one; then what the screen is given (purpose, archive). */
export function GoldCards(props: Shared & { readonly children?: React.ReactNode }) {
  const { row, gold, householdId, today, privacy, canWrite, onChanged, children } = props;
  const worked = useWorkedGold(row.holding.id, gold, today);
  const [recording, setRecording] = useState(false);

  if (worked === null) return <>{children}</>;
  const { terms, paid, state } = worked;
  const currency = terms.instalment.currency;

  return (
    <>
      <section className="card" aria-label="Terms">
        <h2 className="label">Terms</h2>
        <dl className="term-stats mt-1.5">
          <Stat label="With">
            {terms.jeweller}
            {terms.schemeLast4 !== null && <span className="note"> · …{terms.schemeLast4}</span>}
          </Stat>
          <Stat label="Kind">
            {terms.variant === 'amount' ? 'By amount' : 'By weight'}
            <span className="note">{terms.variant === 'amount' ? ' · rupees, not grams' : ` · grams at the day's rate, ${terms.purity ?? ''}`}</span>
          </Stat>
          <Stat label="Instalment">
            {formatMoney(terms.instalment, { privacy })}
            <span className="note"> on the {ordinal(terms.dueDay)}</span>
          </Stat>
          <Stat label="Instalments">
            {terms.instalments}
            <span className="note"> from {formatIsoDate(terms.startDate)}</span>
          </Stat>
          <Stat label="Bonus">{terms.bonusText ?? <span className="note">none stated</span>}</Stat>
          <Stat label="Redeems as">jewellery only</Stat>
        </dl>
      </section>

      <section className="card" aria-label="Instalments">
        <h2 className="label">Instalments</h2>
        {paid.length === 0 ? (
          <p className="note mt-1.5">None recorded yet.</p>
        ) : (
          <ul className="row-separated mt-1">
            {[...paid].reverse().map((instalment) => (
              <li key={instalment.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  {formatIsoDate(instalment.date)}
                  {instalment.grams !== null && <span className="note"> · {instalment.grams} g</span>}
                </span>
                <span className="tabular-nums">{formatMoney(instalment.amount, { privacy })}</span>
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <div className="mt-2.5">
            <Button
              type="button"
              variant="quiet"
              aria-expanded={recording}
              onClick={() => {
                setRecording((was) => !was);
              }}
            >
              {recording ? 'Cancel this instalment' : 'Record an instalment'}
            </Button>
          </div>
        )}
        {canWrite && recording && (
          <InstalmentForm
            householdId={householdId}
            holdingId={row.holding.id}
            terms={terms}
            today={today}
            suggestedDate={state.nextDue !== null && state.nextDue <= today ? state.nextDue : today}
            currency={currency}
            onDone={async () => {
              setRecording(false);
              await gold.reload();
              await onChanged();
            }}
          />
        )}
      </section>

      {children}
    </>
  );
}

function InstalmentForm({
  householdId,
  holdingId,
  terms,
  today,
  suggestedDate,
  currency,
  onDone,
}: {
  householdId: string;
  holdingId: string;
  terms: GoldSchemeTerms;
  today: IsoDate;
  suggestedDate: IsoDate;
  currency: string;
  onDone: () => Promise<void>;
}) {
  const [date, setDate] = useState<string>(suggestedDate);
  const [amount, setAmount] = useState(minorToMajorText(terms.instalment.minor, minorUnitExponent(currency)));
  const [grams, setGrams] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      if (!isIsoDate(date) || Number(date.slice(0, 4)) < 1990) throw new Error('That date is not one this can be: check the year.');
      if (date > today) throw new Error('An instalment cannot be dated after today.');
      if (date < terms.startDate) throw new Error('An instalment cannot be dated before the scheme started.');
      if (amount.trim() === '') throw new Error('The amount is needed.');
      const minor = parseAmountToMinor(amount, currency);
      if (minor <= 0n) throw new Error('The amount is above nothing.');
      if (terms.variant === 'weight') {
        if (grams.trim() === '') throw new Error('The grams it bought are on the receipt: they are needed.');
        if (parseQuantity(grams) <= 0n) throw new Error('The grams are above nothing.');
      }

      setBusy(true);
      await recordInstalment({
        householdId,
        holdingId,
        date,
        amount: money(minor, currency),
        ...(terms.variant === 'weight' ? { grams } : {}),
        valueOn: today,
      });
      await onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="inset-form mt-3 flex flex-wrap items-end gap-3"
      aria-label="Record an instalment"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[9.375rem] sm:shrink-0">
        <Field
          label="Date"
          type="date"
          required
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[9rem] sm:shrink-0">
        <Field
          label={`Amount (${currency})`}
          numeric
          inputMode="decimal"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </div>
      {terms.variant === 'weight' && (
        <div className="w-full sm:w-[9rem] sm:shrink-0">
          <Field
            label="Grams bought"
            numeric
            inputMode="decimal"
            hint="From the receipt."
            value={grams}
            onChange={(event) => {
              setGrams(event.target.value);
            }}
          />
        </div>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Recording…' : 'Record'}
      </Button>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}
