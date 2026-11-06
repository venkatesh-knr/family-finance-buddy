/**
 * Adding gold (docs/design/gold.md sections 2 and 4; the AddGold board of docs/design/vibrant-canvas.html).
 *
 * Two things are added here. Physical gold is asked for in full, whatever the detail level (detail-level.md section 4): what it is,
 * whose, its purity, its weight in grams, the day it was bought, and its cost, which is typed either as the price paid or as the rate per
 * gram that day, with the other worked out beside it (GD-I8). A gold ETF or fund is a fund: its units, its cost and its ISIN, which is
 * what the price driver finds it by.
 *
 * Whatever way a cost is typed, one figure is stored: the cost of the lot, in paise. A rate typed is multiplied by the grams here, on the
 * device, and not kept (gold.md section 2).
 */

import { useMemo, useState } from 'react';
import { EARMARKS, EARMARK_LABELS, isEarmark, type Earmark } from '../../domain/earmark.ts';
import { isIsoDate, type IsoDate } from '../../lib/dates.ts';
import { money } from '../../lib/money.ts';
import { parseQuantity } from '../../lib/quantity.ts';
import { GOLD_PURITIES, type GoldForm, type GoldPurity, type HoldingListing, type Member, type NewGold } from '../../repo/types.ts';
import { Button, Field, Problem } from '../../ui/primitives.tsx';
import { amountOf, costNoteOf, GOLD_CURRENCY as CURRENCY, GoldCost, gramsOf, workedCost, type CostBy } from './GoldCost.tsx';

export function AddGold({
  listing,
  today,
  onAdd,
  onDone,
}: {
  listing: HoldingListing;
  today: IsoDate;
  onAdd: (input: NewGold) => Promise<unknown>;
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

  const [what, setWhat] = useState<'physical' | 'fund'>('physical');
  const [fundForm, setFundForm] = useState<Exclude<GoldForm, 'physical'>>('etf');
  const [name, setName] = useState('');
  const [memberId, setMemberId] = useState(listing.viewer.memberId);
  const [purity, setPurity] = useState<GoldPurity>('22k');
  const [quantity, setQuantity] = useState('');
  const [boughtOn, setBoughtOn] = useState<string>(today);
  const [costBy, setCostBy] = useState<CostBy>('price');
  const [typed, setTyped] = useState('');
  const [gift, setGift] = useState(false);
  const [isin, setIsin] = useState('');
  const [worth, setWorth] = useState('');
  const [earmark, setEarmark] = useState<Earmark>('none');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const physical = what === 'physical';
  const grams = physical ? gramsOf(quantity) : null;

  // The cost is one figure, whichever way it was typed (GD-I8): a fund's is the total typed, a physical purchase's is worked out.
  const costMinor: bigint | null = physical ? workedCost({ gift, costBy, typed, grams }) : amountOf(typed);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
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
        form: physical ? 'physical' : fundForm,
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

  return (
    <form
      className="inset-form flex flex-col gap-3"
      aria-label="Add gold"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="segmented w-fit" role="group" aria-label="Which gold">
        <button
          type="button"
          aria-pressed={physical}
          onClick={() => {
            setWhat('physical');
            // Physical gold is never the emergency fund (GD-I10), so a choice made for a fund is not carried over to it.
            if (earmark === 'emergency') setEarmark('none');
          }}
        >
          Physical gold
        </button>
        <button
          type="button"
          aria-pressed={!physical}
          onClick={() => {
            setWhat('fund');
          }}
        >
          ETF or fund
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-[220px] sm:shrink-0">
          <Field
            label={physical ? 'What it is' : 'Fund or ETF'}
            placeholder={physical ? 'Necklace' : 'Axis Gold ETF'}
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value);
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
        {!physical && (
          <div className="flex flex-col gap-1.5">
            <span className="label" id="gold-fund-form">
              It is
            </span>
            <div className="segmented" role="group" aria-labelledby="gold-fund-form">
              {(['etf', 'fund'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={fundForm === option}
                  onClick={() => {
                    setFundForm(option);
                  }}
                >
                  {option === 'etf' ? 'A gold ETF' : 'A gold fund'}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="flex w-full flex-col gap-1.5 sm:w-[190px] sm:shrink-0">
          <span className="label">Set aside for</span>
          <select
            className="field"
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
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {physical && (
          <div className="flex flex-col gap-1.5">
            <span className="label" id="gold-purity">
              Purity
            </span>
            <div className="segmented" role="group" aria-labelledby="gold-purity">
              {GOLD_PURITIES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={purity === option}
                  onClick={() => {
                    setPurity(option);
                  }}
                >
                  {option.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="w-full sm:w-[130px] sm:shrink-0">
          <Field
            label={physical ? 'Weight (g)' : 'Units'}
            numeric
            inputMode="decimal"
            required
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
            }}
          />
        </div>
        <div className="w-full sm:w-[150px] sm:shrink-0">
          <Field
            label="Bought on"
            type="date"
            required
            value={boughtOn}
            onChange={(event) => {
              setBoughtOn(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {physical ? (
          <GoldCost grams={grams} gift={gift} costBy={costBy} typed={typed} onCostBy={setCostBy} onTyped={setTyped} />
        ) : (
          <div className="w-full sm:w-[170px] sm:shrink-0">
            <Field
              label={`Total cost (${CURRENCY})`}
              numeric
              inputMode="decimal"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
          </div>
        )}
        {!physical && (
          <>
            <div className="w-full sm:w-[170px] sm:shrink-0">
              <Field
                label="ISIN"
                placeholder="INF846K01W80"
                maxLength={12}
                required
                hint="It is what prices it every day."
                value={isin}
                onChange={(event) => {
                  setIsin(event.target.value);
                }}
              />
            </div>
            <div className="w-full sm:w-[170px] sm:shrink-0">
              <Field
                label={`Worth today (${CURRENCY})`}
                numeric
                inputMode="decimal"
                hint="Optional: its first value."
                value={worth}
                onChange={(event) => {
                  setWorth(event.target.value);
                }}
              />
            </div>
          </>
        )}
      </div>

      {physical && (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={gift}
              onChange={(event) => {
                setGift(event.target.checked);
              }}
            />
            <span>A gift or inherited, cost not known</span>
          </label>
          <p className="note">
            For jewellery the price includes making charges and GST, so its value at the gold rate starts below what you paid. Not counted
            in your emergency fund or liquid money.
          </p>
        </>
      )}
      {!physical && <p className="note">An ETF or fund is priced every day by its ISIN, like any fund.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {problem !== null && <Problem>{problem}</Problem>}
    </form>
  );
}
