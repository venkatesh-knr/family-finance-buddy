/**
 * Adding gold, in steps (docs/design/gold.md sections 2 and 4; docs/design/simple-layout.md section 4; the AddStep1 and AddStep2 boards).
 *
 * Step one is what it is: the type, the form (physical gold, a gold ETF or a gold fund), what it is called, whose, and for physical
 * gold its purity. Step two is the figures: the weight in grams and the day it was bought, and its cost, which is typed either as the
 * price paid or as the rate per gram that day, with the other worked out beneath it (GD-I8). A gold ETF or fund is a fund: its units,
 * its cost, and a third step for its ISIN, which is what the price driver finds it by, and what it is worth today.
 *
 * Whatever way a cost is typed, one figure is stored: the cost of the lot, in paise. A rate typed is multiplied by the grams here, on the
 * device, and not kept (gold.md section 2). Nothing is written until the last step's button, and Back keeps every value (SL-I6).
 */

import { useMemo, useState } from 'react';
import { EARMARKS, EARMARK_LABELS, isEarmark, type Earmark } from '../../domain/earmark.ts';
import { isIsoDate, type IsoDate } from '../../lib/dates.ts';
import { money } from '../../lib/money.ts';
import { parseQuantity } from '../../lib/quantity.ts';
import { GOLD_PURITIES, type GoldForm, type GoldPurity, type HoldingListing, type Member, type NewGold } from '../../repo/types.ts';
import { Field } from '../../ui/primitives.tsx';
import { Select } from '../../ui/Select.tsx';
import { Stepper } from '../../ui/Stepper.tsx';
import { amountOf, costNoteOf, GOLD_CURRENCY as CURRENCY, GoldCost, gramsOf, workedCost, type CostBy } from './GoldCost.tsx';

const FORM_LABEL: Record<GoldForm, string> = { physical: 'Physical gold', etf: 'A gold ETF', fund: 'A gold fund' };

export function AddGold({
  listing,
  today,
  onAdd,
  onDone,
  typeField,
}: {
  listing: HoldingListing;
  today: IsoDate;
  onAdd: (input: NewGold) => Promise<unknown>;
  /** Closes the form: from its first step, or once it is added. Nothing has been written unless it was added. */
  onDone: () => void;
  /** The Add panel's choice of what is being added, which sits first on the first step. */
  typeField: React.ReactNode;
}) {
  // The same rule as everywhere: a contributor records only against their own.
  const members: readonly Member[] = useMemo(
    () =>
      listing.viewer.canFileForOthers
        ? listing.members.filter((member) => !member.isArchived)
        : listing.members.filter((member) => member.id === listing.viewer.memberId),
    [listing.members, listing.viewer.canFileForOthers, listing.viewer.memberId],
  );

  const [form, setForm] = useState<GoldForm>('physical');
  const [name, setName] = useState('');
  const [memberId, setMemberId] = useState(listing.viewer.memberId);
  const [purity, setPurity] = useState<GoldPurity>('22k');
  const [quantity, setQuantity] = useState('');
  const [boughtOn, setBoughtOn] = useState<string>(today);
  // A date is marked wrong once it has lost focus, or a step has been tried: typing a year digit by digit passes through years that are not
  // wrong yet, and a mark (read aloud as an alert) for each would call a right entry wrong.
  const [boughtTouched, setBoughtTouched] = useState(false);
  const [costBy, setCostBy] = useState<CostBy>('price');
  const [typed, setTyped] = useState('');
  const [gift, setGift] = useState(false);
  const [isin, setIsin] = useState('');
  const [worth, setWorth] = useState('');
  const [earmark, setEarmark] = useState<Earmark>('none');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [show, setShow] = useState<{ step: number; key: number } | null>(null);

  const physical = form === 'physical';
  const grams = physical ? gramsOf(quantity) : null;

  // The cost is one figure, whichever way it was typed (GD-I8): a fund's is the total typed, a physical purchase's is worked out.
  const costMinor: bigint | null = physical ? workedCost({ gift, costBy, typed, grams }) : amountOf(typed);

  // Every field is checked as it is typed, and what is wrong is said on the field, in words (docs/design/simple-layout.md section 3). A step's
  // Next waits for its fields to be right, so a problem is never found on the last step about a field on an earlier one.
  const unitsOk = (): boolean => {
    try {
      return quantity.trim() !== '' && parseQuantity(quantity) > 0n;
    } catch {
      return false;
    }
  };
  const errors: Partial<Record<'quantity' | 'boughtOn' | 'cost' | 'isin' | 'worth', string>> = {};
  if (quantity.trim() !== '' && (physical ? grams === null : !unitsOk())) {
    errors.quantity = physical ? 'The weight is in grams, above nothing, to three decimals at most.' : 'The units are a number above nothing, such as 50 or 12.5.';
  }
  if (boughtOn !== '' && (!isIsoDate(boughtOn) || Number(boughtOn.slice(0, 4)) < 1990)) errors.boughtOn = 'That is not a date this can be: check the year.';
  else if (isIsoDate(boughtOn) && boughtOn > today) errors.boughtOn = 'It cannot be bought after today.';
  if (!gift && typed.trim() !== '' && costMinor === null) {
    errors.cost = physical && costBy === 'rate' ? 'The rate per gram is an amount above nothing.' : 'What it cost is an amount above nothing.';
  }
  if (!physical && isin.trim() !== '' && !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin.trim().toUpperCase())) {
    errors.isin = 'An ISIN is twelve letters and digits, such as INF846K01W80.';
  }
  if (!physical && worth.trim() !== '' && amountOf(worth) === null) errors.worth = 'What it is worth today is an amount above nothing, or left out.';
  const weightError = errors.quantity ?? null;
  const dateError = boughtTouched || show !== null ? (errors.boughtOn ?? null) : null;
  const STEP_OF = { quantity: 1, boughtOn: 1, cost: 1, isin: 2, worth: 2 } as const;

  const submit = async () => {
    setProblem(null);
    const wrong = (Object.keys(errors) as (keyof typeof errors)[]).map((field) => STEP_OF[field]);
    if (wrong.length > 0) {
      setShow({ step: Math.min(...wrong), key: Date.now() });
      return;
    }
    try {
      if (name.trim() === '') throw new Error(physical ? 'Say what it is: a necklace, a coin, a bar.' : 'The name of the fund is needed.');
      if (!isIsoDate(boughtOn) || Number(boughtOn.slice(0, 4)) < 1990) throw new Error('That is not a date this can be: check the year.');
      if (boughtOn > today) throw new Error('It cannot be bought after today.');
      if (physical) {
        if (grams === null) throw new Error('The weight is in grams, above nothing, to three decimals at most.');
      } else if (quantity.trim() === '' || parseQuantity(quantity) <= 0n) {
        throw new Error('The units are above nothing.');
      }
      if (costMinor === null) throw new Error(costBy === 'rate' && physical ? 'The rate per gram is needed.' : 'What it cost is needed. If it was a gift, say so.');
      const worthMinor = physical || worth.trim() === '' ? null : amountOf(worth);
      if (!physical && worth.trim() !== '' && worthMinor === null) throw new Error('What it is worth today is above nothing, or left out.');

      setBusy(true);
      await onAdd({
        householdId: listing.household.id,
        memberId,
        name: name.trim(),
        form,
        ...(physical ? { purity } : {}),
        quantity: quantity.trim(),
        boughtOn,
        cost: money(costMinor, CURRENCY),
        isGift: gift,
        ...(physical ? { costNote: costNoteOf({ costBy, typed, grams }) } : {}),
        ...(physical || isin.trim() === '' ? {} : { isin: isin.trim().toUpperCase() }),
        ...(worthMinor === null ? {} : { worth: money(worthMinor, CURRENCY) }),
        ...(earmark === 'none' ? {} : { earmark }),
      });
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not add that.');
    } finally {
      setBusy(false);
    }
  };

  const setAside = (
    <Select
      label="Set aside for"
      value={earmark}
      onChange={(event) => {
        if (isEarmark(event.target.value)) setEarmark(event.target.value);
      }}
    >
      {/* Jewellery and coin are not emergency cover (GD-I10); a gold ETF or fund is, as any fund is. */}
      {EARMARKS.filter((option) => !physical || option !== 'emergency').map((option) => (
        <option key={option} value={option}>
          {EARMARK_LABELS[option]}
        </option>
      ))}
    </Select>
  );

  const whatItIs = {
    name: 'What it is',
    ready: name.trim() !== '',
    content: (
      <>
        {typeField}
        <Select
          label="Form"
          value={form}
          onChange={(event) => {
            const next = event.target.value as GoldForm;
            setForm(next);
            // Physical gold is never the emergency fund (GD-I10), so a choice made for a fund is not carried over to it.
            if (next === 'physical' && earmark === 'emergency') setEarmark('none');
          }}
        >
          {(['physical', 'etf', 'fund'] as const).map((option) => (
            <option key={option} value={option}>
              {FORM_LABEL[option]}
            </option>
          ))}
        </Select>
        <Field
          label="What it is"
          placeholder={physical ? 'Necklace' : 'Axis Gold ETF'}
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Select
          label="Whose"
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
        </Select>
        {physical && (
          <Select
            label="Purity"
            value={purity}
            onChange={(event) => {
              setPurity(event.target.value as GoldPurity);
            }}
          >
            {GOLD_PURITIES.map((option) => (
              <option key={option} value={option}>
                {option.toUpperCase()}
              </option>
            ))}
          </Select>
        )}
      </>
    ),
  };

  const figures = physical
    ? {
        name: 'Weight and cost',
        ready: grams !== null && costMinor !== null && isIsoDate(boughtOn) && Object.keys(errors).length === 0,
        content: (
          <>
            <Field label="Weight (g)" numeric inputMode="decimal" required hint="grams" error={weightError} value={quantity} onChange={(event) => { setQuantity(event.target.value); }} />
            <Field label="Bought on" type="date" required error={dateError} onBlur={() => { setBoughtTouched(true); }} value={boughtOn} onChange={(event) => { setBoughtOn(event.target.value); }} />
            <GoldCost grams={grams} gift={gift} costBy={costBy} typed={typed} onCostBy={setCostBy} onTyped={setTyped} error={errors.cost ?? null} />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={gift} onChange={(event) => { setGift(event.target.checked); }} />
              <span>A gift or inherited, cost not known</span>
            </label>
            <p className="field-help">
              For jewellery the price includes making charges and GST, so its value at the gold rate starts below what you paid. Not counted
              in your emergency fund or liquid money.
            </p>
            {setAside}
          </>
        ),
      }
    : {
        name: 'Units and cost',
        ready: unitsOk() && costMinor !== null && isIsoDate(boughtOn) && Object.keys(errors).length === 0,
        content: (
          <>
            <Field label="Units" numeric inputMode="decimal" required error={errors.quantity ?? null} value={quantity} onChange={(event) => { setQuantity(event.target.value); }} />
            <Field label="Bought on" type="date" required error={dateError} onBlur={() => { setBoughtTouched(true); }} value={boughtOn} onChange={(event) => { setBoughtOn(event.target.value); }} />
            <Field label={`Total cost (${CURRENCY})`} numeric inputMode="decimal" required error={errors.cost ?? null} value={typed} onChange={(event) => { setTyped(event.target.value); }} />
          </>
        ),
      };

  const steps = physical
    ? [whatItIs, figures]
    : [
        whatItIs,
        figures,
        {
          name: 'Priced by',
          ready: isin.trim() !== '' && errors.isin === undefined && errors.worth === undefined,
          content: (
            <>
              <Field label="ISIN" placeholder="INF846K01W80" maxLength={12} required hint="It is what prices it every day, like any fund." error={errors.isin ?? null} value={isin} onChange={(event) => { setIsin(event.target.value); }} />
              <Field label={`Worth today (${CURRENCY})`} numeric inputMode="decimal" hint="Optional: its first value." error={errors.worth ?? null} value={worth} onChange={(event) => { setWorth(event.target.value); }} />
              {setAside}
            </>
          ),
        },
      ];

  return (
    <Stepper
      title="Add a holding"
      finishLabel={physical ? 'Add gold' : `Add the gold ${form === 'etf' ? 'ETF' : 'fund'}`}
      busy={busy}
      problem={problem}
      show={show}
      onCancel={onDone}
      onFinish={submit}
      steps={steps}
    />
  );
}
