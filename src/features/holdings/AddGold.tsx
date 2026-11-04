/**
 * Adding a jeweller's gold savings scheme (docs/design/gold.md section 3; docs/decisions.md, Gold).
 *
 * Every term is asked for, whatever the detail level (detail-level.md section 4): the jeweller, whether it is by amount or by weight,
 * the instalment and how many, the day the first falls due (which fixes the day of the month, 1 to 28), the bonus as the jeweller
 * states it and what it is worth if it is a sum, the purity if it is by weight, and the last four of the scheme number. No
 * instalment is recorded here: the first is a separate act on the scheme's own screen, and a scheme says what is paid so far as none.
 */

import { useMemo, useState } from 'react';
import { EARMARKS, EARMARK_LABELS, isEarmark, type Earmark } from '../../domain/earmark.ts';
import { isIsoDate, type IsoDate } from '../../lib/dates.ts';
import { money, parseAmountToMinor } from '../../lib/money.ts';
import { GOLD_PURITIES, type GoldPurity, type GoldVariant, type HoldingListing, type Member, type NewGoldScheme } from '../../repo/types.ts';
import { Button, Field, Problem } from '../../ui/primitives.tsx';

const ONE_INSTALMENT = /^\s*(one|1)\s+instal+ment/i;

const CURRENCY = 'INR';

export function AddGold({
  listing,
  today,
  onAdd,
  onDone,
}: {
  listing: HoldingListing;
  today: IsoDate;
  onAdd: (input: NewGoldScheme) => Promise<void>;
  onDone: () => void;
}) {
  // The same rule as everywhere: a contributor records only against their own.
  const members: readonly Member[] = useMemo(
    () =>
      listing.viewer.canFileForOthers
        ? listing.members.filter((member) => !member.isArchived)
        : listing.members.filter((member) => member.id === listing.viewer.memberId),
    [listing.members, listing.viewer.canFileForOthers, listing.viewer.memberId],
  );

  const [name, setName] = useState('');
  const [memberId, setMemberId] = useState(listing.viewer.memberId);
  const [jeweller, setJeweller] = useState('');
  const [variant, setVariant] = useState<GoldVariant>('amount');
  const [purity, setPurity] = useState<GoldPurity>('22k');
  const [instalment, setInstalment] = useState('');
  const [count, setCount] = useState('11');
  const [start, setStart] = useState<string>(today);
  const [bonusText, setBonusText] = useState('');
  const [bonusWorth, setBonusWorth] = useState('');
  const [last4, setLast4] = useState('');
  const [earmark, setEarmark] = useState<Earmark>('none');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      if (jeweller.trim() === '') throw new Error('The jeweller the scheme is with is needed.');
      if (instalment.trim() === '') throw new Error('The instalment is needed.');
      const instalmentMinor = parseAmountToMinor(instalment, CURRENCY);
      if (instalmentMinor <= 0n) throw new Error('An instalment is above nothing.');
      const instalments = Number(count);
      if (!Number.isInteger(instalments) || instalments < 1 || instalments > 120) throw new Error('A scheme has between 1 and 120 instalments.');
      if (!isIsoDate(start) || Number(start.slice(0, 4)) < 2000) throw new Error('The day the first instalment falls due is not a date this can be: check the year.');
      const dueDay = Number(start.slice(8, 10));
      if (dueDay > 28) throw new Error('Instalments fall due on a day from 1 to 28, so that the day exists in every month. Choose the first due day within them.');
      if (bonusWorth.trim() !== '' && parseAmountToMinor(bonusWorth, CURRENCY) < 0n) throw new Error('A bonus is not a negative sum.');
      if (last4.trim() !== '' && !/^[0-9A-Za-z]{4}$/.test(last4.trim())) throw new Error('Keep only the last four characters of the scheme number, and nothing more.');

      setBusy(true);
      await onAdd({
        householdId: listing.household.id,
        memberId,
        name: name.trim() === '' ? `Gold savings (${jeweller.trim()})` : name.trim(),
        jeweller: jeweller.trim(),
        variant,
        instalment: money(instalmentMinor, CURRENCY),
        instalments,
        startDate: start,
        dueDay,
        bonusText: bonusText.trim() === '' ? null : bonusText.trim(),
        // "One instalment" is a known sum, so it is worked out from the instalment and not left as words (gold.md section 3).
        bonus:
          bonusWorth.trim() !== ''
            ? money(parseAmountToMinor(bonusWorth, CURRENCY), CURRENCY)
            : ONE_INSTALMENT.test(bonusText)
              ? money(instalmentMinor, CURRENCY)
              : null,
        purity: variant === 'weight' ? purity : null,
        schemeLast4: last4.trim() === '' ? null : last4.trim(),
        ...(earmark === 'none' ? {} : { earmark }),
      });
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not add that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="inset-form flex flex-col gap-3"
      aria-label="Add a gold savings scheme"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-[220px] sm:shrink-0">
          <Field
            label="Jeweller"
            value={jeweller}
            required
            onChange={(event) => {
              setJeweller(event.target.value);
            }}
          />
        </div>
        <label className="flex w-full flex-col gap-1.5 sm:w-[150px] sm:shrink-0">
          <span className="label">Whose</span>
          <select
            className="field"
            value={memberId}
            onChange={(event) => {
              setMemberId(event.target.value);
            }}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-full flex-col gap-1.5 sm:w-[190px] sm:shrink-0">
          <span className="label">Set aside for</span>
          <select
            className="field"
            value={earmark}
            onChange={(event) => {
              if (isEarmark(event.target.value)) setEarmark(event.target.value);
            }}
          >
            {/* Jewellery is not emergency cover: a gold scheme is never offered the emergency fund. */}
            {EARMARKS.filter((option) => option !== 'emergency').map((option) => (
              <option key={option} value={option}>
                {EARMARK_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-full flex-col gap-1.5 sm:w-[260px] sm:shrink-0">
          <span className="label">Kind</span>
          <select
            className="field"
            value={variant}
            onChange={(event) => {
              setVariant(event.target.value === 'weight' ? 'weight' : 'amount');
            }}
          >
            <option value="amount">By amount (the instalments paid)</option>
            <option value="weight">By weight (grams at the day&rsquo;s rate)</option>
          </select>
        </label>
        {variant === 'weight' && (
          <label className="flex w-full flex-col gap-1.5 sm:w-[110px] sm:shrink-0">
            <span className="label">Purity</span>
            <select
              className="field"
              value={purity}
              onChange={(event) => {
                if ((GOLD_PURITIES as readonly string[]).includes(event.target.value)) setPurity(event.target.value as GoldPurity);
              }}
            >
              {GOLD_PURITIES.map((option) => (
                <option key={option} value={option}>
                  {option.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="w-full sm:w-[140px] sm:shrink-0">
          <Field
            label={`Instalment (${CURRENCY})`}
            numeric
            inputMode="decimal"
            value={instalment}
            required
            onChange={(event) => {
              setInstalment(event.target.value);
            }}
          />
        </div>
        <div className="w-full sm:w-[110px] sm:shrink-0">
          <Field
            label="Instalments"
            numeric
            inputMode="numeric"
            value={count}
            onChange={(event) => {
              setCount(event.target.value);
            }}
          />
        </div>
        <div className="w-full sm:w-[150px] sm:shrink-0">
          <Field
            label="First falls due"
            type="date"
            required
            hint="Its day is the day each month."
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-[240px] sm:shrink-0">
          <Field
            label="Bonus, as the jeweller says it"
            hint="For example: one instalment, at maturity."
            value={bonusText}
            onChange={(event) => {
              setBonusText(event.target.value);
            }}
          />
        </div>
        <div className="w-full sm:w-[140px] sm:shrink-0">
          <Field
            label={`Bonus worth (${CURRENCY})`}
            numeric
            inputMode="decimal"
            hint="If it is a sum. Left blank, one instalment is worked out."
            value={bonusWorth}
            onChange={(event) => {
              setBonusWorth(event.target.value);
            }}
          />
        </div>
        <div className="w-full sm:w-[120px] sm:shrink-0">
          <Field
            label="Scheme number, last four"
            maxLength={4}
            value={last4}
            onChange={(event) => {
              setLast4(event.target.value);
            }}
          />
        </div>
        <div className="w-full sm:w-[220px] sm:shrink-0">
          <Field
            label="Name in the list (optional)"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
      </div>

      <p className="note">
        Held by a jeweller, not a bank, and redeemable only as jewellery. Not counted in your emergency fund or liquid money.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add the scheme'}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {problem !== null && <Problem>{problem}</Problem>}
    </form>
  );
}
