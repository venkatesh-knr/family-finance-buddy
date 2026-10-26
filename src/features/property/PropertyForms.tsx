/**
 * The forms of the property screen: a property (new, or corrected in place), a piece of work, and a valuation.
 *
 * Each says only what somebody knows. The cost basis, the share and the equity are worked out from what is typed
 * (`src/domain/property.ts`) and are never typed. A blank stamp duty or registration is nothing, as on a gift or an
 * inheritance; a blank price is not allowed, because it is what everything else is measured against.
 */

import { useState } from 'react';
import { isIsoDate, type IsoDate } from '../../lib/dates.ts';
import { money, parseAmountToMinor, type Money } from '../../lib/money.ts';
import { toAmountInput } from '../insurance/MoneyField.tsx';
import {
  addProperty,
  addPropertyImprovement,
  recordPropertyValuation,
  updateProperty,
} from '../../repo/property.ts';
import {
  PROPERTY_KINDS,
  VALUATION_BASES,
  type Member,
  type Property,
  type PropertyKind,
  type PropertyListing,
  type ValuationBasis,
} from '../../repo/types.ts';
import { Button, Caveat, Field, Problem } from '../../ui/primitives.tsx';
import { CurrencyOptions } from '../holdings/holdingParts.tsx';
import { BASIS_LABEL, KIND_LABEL } from './propertyLabels.ts';

const SHARE = /^\d{1,3}(\.\d{1,2})?$/;

/** A typed date must be a real one in a sensible year, and says so in a sentence when it is not. */
function checkedDate(text: string, what: string): IsoDate {
  const year = Number(text.slice(0, 4));
  if (!isIsoDate(text) || year < 1900 || year > 2100) throw new Error(`${what} is not a date this can be: check the year.`);
  return text;
}

/** An amount typed in the property's currency. Blank is nothing only where `blankIsNothing`. */
function amountOf(text: string, currency: string, what: string, blankIsNothing: boolean): Money {
  if (text.trim() === '') {
    if (blankIsNothing) return money(0n, currency);
    throw new Error(`${what} is needed.`);
  }
  try {
    return money(parseAmountToMinor(text, currency), currency);
  } catch (error) {
    throw new Error(`${what}: ${error instanceof Error ? error.message : 'that is not an amount.'}`);
  }
}

// ─── a property ───────────────────────────────────────────────────────────────────────────────────────────────────

export function PropertyForm({
  listing,
  existing,
  today,
  onDone,
  onCancel,
}: {
  listing: PropertyListing;
  /** Given to correct a property in place; omitted to file a new one. */
  existing?: Property;
  today: IsoDate;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const editing = existing !== undefined;
  const members: readonly Member[] = listing.viewer.canFileForOthers
    ? listing.members.filter((member) => !member.isArchived)
    : listing.members.filter((member) => member.id === listing.viewer.memberId);

  const [label, setLabel] = useState(existing?.label ?? '');
  const [kind, setKind] = useState<PropertyKind>(existing?.kind ?? 'apartment');
  const [memberId, setMemberId] = useState(existing?.member.id ?? listing.viewer.memberId);
  const [currency, setCurrency] = useState(existing?.currency ?? listing.household.baseCurrency);
  const [boughtOn, setBoughtOn] = useState<string>(existing?.purchaseDate ?? '');
  const [price, setPrice] = useState(existing === undefined ? '' : toAmountInput(existing.purchaseCost.minor, existing.currency));
  const [duty, setDuty] = useState(
    existing === undefined || existing.stampDuty.minor === 0n ? '' : toAmountInput(existing.stampDuty.minor, existing.currency),
  );
  const [registration, setRegistration] = useState(
    existing === undefined || existing.registration.minor === 0n
      ? ''
      : toAmountInput(existing.registration.minor, existing.currency),
  );
  const [sharePct, setSharePct] = useState(existing?.sharePct ?? '100');
  const [selfOccupied, setSelfOccupied] = useState(existing?.isSelfOccupied ?? false);
  const [loanId, setLoanId] = useState(existing?.linkedLiabilityId ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      if (label.trim() === '') throw new Error('A property needs a name.');
      const date = checkedDate(boughtOn, 'The date it was bought');
      if (date > today) throw new Error('It cannot have been bought after today.');
      if (!SHARE.test(sharePct.trim()) || Number(sharePct) <= 0 || Number(sharePct) > 100) {
        throw new Error('The household’s share is a percentage above 0 and up to 100, such as 50 or 33.33.');
      }
      const purchaseCost = amountOf(price, currency, 'The price paid', false);
      const stampDuty = amountOf(duty, currency, 'The stamp duty', true);
      const reg = amountOf(registration, currency, 'The registration', true);

      setBusy(true);
      if (editing) {
        await updateProperty(existing.id, {
          label,
          kind,
          purchaseDate: date,
          purchaseCost,
          stampDuty,
          registration: reg,
          sharePct: sharePct.trim(),
          isSelfOccupied: selfOccupied,
          linkedLiabilityId: loanId === '' ? null : loanId,
          note,
        });
      } else {
        await addProperty({
          householdId: listing.household.id,
          memberId,
          kind,
          label,
          currency,
          purchaseDate: date,
          purchaseCost,
          stampDuty,
          registration: reg,
          sharePct: sharePct.trim(),
          isSelfOccupied: selfOccupied,
          linkedLiabilityId: loanId === '' ? null : loanId,
          note,
        });
      }
      await onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  const loans = listing.loans.filter((loan) => !loan.isClosed || loan.id === existing?.linkedLiabilityId);

  return (
    <form
      className="inset-form flex flex-col gap-3"
      aria-label={editing ? `Correct ${existing.label}` : 'Add a property'}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto sm:min-w-[170px] sm:flex-1">
          <Field
            label="Name"
            placeholder="House"
            required
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
        </div>
        <label className="flex w-full flex-col gap-1.5 sm:w-[150px] sm:shrink-0">
          <span className="label">Kind</span>
          <select
            className="field"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as PropertyKind);
            }}
          >
            {PROPERTY_KINDS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
        {!editing && (
          <label className="flex w-full flex-col gap-1.5 sm:w-[150px] sm:shrink-0">
            <span className="label">Held by</span>
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
        )}
        <label className="flex w-full flex-col gap-1.5 sm:w-[110px] sm:shrink-0">
          <span className="label">Priced in</span>
          {editing ? (
            <span className="field" aria-label="Priced in" style={{ color: 'var(--ink-2)' }}>
              {currency}
            </span>
          ) : (
            <select
              className="field"
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value);
              }}
            >
              <CurrencyOptions />
            </select>
          )}
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-[160px] sm:shrink-0">
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
        <div className="w-full sm:w-[150px] sm:shrink-0">
          <Field
            label="Price paid"
            numeric
            inputMode="decimal"
            placeholder="0.00"
            required
            value={price}
            onChange={(event) => {
              setPrice(event.target.value);
            }}
          />
        </div>
        <div className="w-full sm:w-[150px] sm:shrink-0">
          <Field
            label="Stamp duty"
            numeric
            inputMode="decimal"
            placeholder="none"
            value={duty}
            onChange={(event) => {
              setDuty(event.target.value);
            }}
          />
        </div>
        <div className="w-full sm:w-[150px] sm:shrink-0">
          <Field
            label="Registration"
            numeric
            inputMode="decimal"
            placeholder="none"
            value={registration}
            onChange={(event) => {
              setRegistration(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-[190px] sm:shrink-0">
          <Field
            label="Household’s share, %"
            numeric
            inputMode="decimal"
            value={sharePct}
            onChange={(event) => {
              setSharePct(event.target.value);
            }}
          />
        </div>
        <label className="flex w-full flex-col gap-1.5 sm:w-[230px] sm:shrink-0">
          <span className="label">Home loan</span>
          <select
            className="field"
            value={loanId}
            onChange={(event) => {
              setLoanId(event.target.value);
            }}
          >
            <option value="">None</option>
            {loans.map((loan) => (
              <option key={loan.id} value={loan.id}>
                {loan.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2.5 pb-2.5">
          <input
            type="checkbox"
            checked={selfOccupied}
            onChange={(event) => {
              setSelfOccupied(event.target.checked);
            }}
          />
          <span className="note">Lived in by the family</span>
        </label>
      </div>

      <div className="w-full sm:max-w-[28rem]">
        <Field
          label="Note"
          maxLength={500}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </div>

      <div className="note">
        Stamp duty and registration are part of what it cost, which is what a future gain is measured against.
        <Caveat tone="info" label="Why these are three figures">
          They are kept apart, and not folded into one cost, because nobody reconstructs them fifteen years later from
          memory, and a property bought before 23 July 2024 may be taxed with indexation, which needs each by the year
          it was paid.
        </Caveat>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save the corrections' : 'Add the property'}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {problem !== null && <Problem>{problem}</Problem>}
    </form>
  );
}

// ─── a piece of work ──────────────────────────────────────────────────────────────────────────────────────────────

export function ImprovementForm({
  householdId,
  property,
  today,
  onDone,
}: {
  householdId: string;
  property: Property;
  today: IsoDate;
  onDone: () => Promise<void>;
}) {
  const [date, setDate] = useState<string>(today);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'capital' | 'repair'>('capital');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      const when = checkedDate(date, 'The date of the work');
      // Work after today would be left out of the cost and listed as though it counted; work before the purchase is
      // not work on this property at all.
      if (when > today) throw new Error('Work cannot be dated after today.');
      if (when < property.purchaseDate) throw new Error('Work cannot be dated before the property was bought.');
      if (description.trim() === '') throw new Error('Say what the work was.');
      const cost = amountOf(amount, property.currency, 'The cost', false);
      if (cost.minor <= 0n) throw new Error('Work has a cost above nothing.');

      setBusy(true);
      await addPropertyImprovement({
        householdId,
        propertyId: property.id,
        date: when,
        description,
        amount: cost,
        isCapital: type === 'capital',
      });
      setDescription('');
      setAmount('');
      await onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-label={`Record work on ${property.label}`}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[150px] sm:shrink-0">
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
      <div className="w-full sm:w-auto sm:min-w-[170px] sm:flex-1">
        <Field
          label="Work"
          placeholder="Modular kitchen"
          maxLength={200}
          required
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </div>
      <label className="flex w-full flex-col gap-1.5 sm:w-[130px] sm:shrink-0">
        <span className="label">Type</span>
        <select
          className="field"
          value={type}
          onChange={(event) => {
            setType(event.target.value === 'repair' ? 'repair' : 'capital');
          }}
        >
          <option value="capital">Capital</option>
          <option value="repair">Repair</option>
        </select>
      </label>
      <div className="w-full sm:w-[140px] sm:shrink-0">
        <Field
          label="Cost"
          numeric
          inputMode="decimal"
          placeholder="0.00"
          required
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Record work'}
      </Button>
      <p className="note w-full">Capital work adds to what the property cost; a repair is recorded and does not.</p>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}

// ─── a valuation ──────────────────────────────────────────────────────────────────────────────────────────────────

export function ValuationForm({
  householdId,
  property,
  today,
  onDone,
}: {
  householdId: string;
  property: Property;
  today: IsoDate;
  onDone: () => Promise<void>;
}) {
  const [asOf, setAsOf] = useState<string>(today);
  const [value, setValue] = useState('');
  const [basis, setBasis] = useState<ValuationBasis>('own_estimate');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      const when = checkedDate(asOf, 'The date of the valuation');
      if (when > today) throw new Error('A valuation cannot be dated after today.');
      const worth = amountOf(value, property.currency, 'The value', false);

      setBusy(true);
      await recordPropertyValuation({ householdId, propertyId: property.id, asOf: when, value: worth, basis, note });
      setValue('');
      setNote('');
      await onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-label={`Record a valuation of ${property.label}`}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[150px] sm:shrink-0">
        <Field
          label="As at"
          type="date"
          required
          value={asOf}
          onChange={(event) => {
            setAsOf(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[170px] sm:shrink-0">
        <Field
          label="Worth"
          numeric
          inputMode="decimal"
          placeholder="0.00"
          required
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      </div>
      <label className="flex w-full flex-col gap-1.5 sm:w-[220px] sm:shrink-0">
        <span className="label">How you arrived at it</span>
        <select
          className="field"
          value={basis}
          onChange={(event) => {
            setBasis(event.target.value as ValuationBasis);
          }}
        >
          {VALUATION_BASES.map((option) => (
            <option key={option} value={option}>
              {BASIS_LABEL[option]}
            </option>
          ))}
        </select>
      </label>
      <div className="w-full sm:w-auto sm:min-w-[150px] sm:flex-1">
        <Field
          label="Note"
          maxLength={500}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Record valuation'}
      </Button>
      <p className="note w-full">The worth is the whole property, not the household’s share: the share is taken for you.</p>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}
