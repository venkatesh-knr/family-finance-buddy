/**
 * Adding an EPF, an NPS or a PPF (docs/decisions.md, Retirement): the fields follow the type, because what is typed once is
 * different for each.
 *
 * An EPF is a passbook balance, typed with the day it is as at. An NPS is units and the NAV, and the value is worked out from
 * them, not typed. A PPF is where it is and the balance it is worked out from (as at a 31 March credit, or the day it opened),
 * and what it is worth now is `ppfBalance`; the box offering to record that as its first reading is the deposit's, and for the
 * same reason: a value that is a calculation is offered and ticked, a value that is a judgement is left for the person.
 */

import { useEffect, useMemo, useState } from 'react';
import { EARMARKS, EARMARK_LABELS, isEarmark, type Earmark } from '../../domain/earmark.ts';
import { npsValue } from '../../domain/nps.ts';
import { ppfBalance } from '../../domain/ppf.ts';
import { isIsoDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney, money, parseAmountToMinor, type Money } from '../../lib/money.ts';
import { listPpf } from '../../repo/retirement.ts';
import type { HoldingListing, Member, RetirementType, SchemeRate } from '../../repo/types.ts';
import { Button, Caveat, Field, Problem } from '../../ui/primitives.tsx';
import type { useHoldings } from './useHoldings.ts';

export const RETIREMENT_LABEL: Record<RetirementType, string> = {
  epf: 'EPF',
  nps: 'NPS',
  ppf: 'PPF',
};

const TYPE_CHOICE: Record<RetirementType, string> = {
  epf: 'EPF: a balance from the passbook',
  nps: 'NPS: units and the NAV',
  ppf: 'PPF: worked out from what is paid in and the notified rate',
};

const CURRENCY = 'INR';

export function AddRetirement({
  listing,
  today,
  onAdd,
  onDone,
}: {
  listing: HoldingListing;
  today: IsoDate;
  onAdd: ReturnType<typeof useHoldings>['addRetirement'];
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

  const [type, setType] = useState<RetirementType>('epf');
  const [name, setName] = useState('');
  const [memberId, setMemberId] = useState(listing.viewer.memberId);
  const [earmark, setEarmark] = useState<Earmark>('none');
  // An EPF's balance, an NPS's units and NAV, a PPF's opening balance: each with the day it is as at.
  const [balance, setBalance] = useState('');
  const [units, setUnits] = useState('');
  const [nav, setNav] = useState('');
  const [asAt, setAsAt] = useState<string>(today);
  const [institution, setInstitution] = useState('');
  const [last4, setLast4] = useState('');
  const [recordFirst, setRecordFirst] = useState(true);
  const [rates, setRates] = useState<readonly SchemeRate[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The notified rate, for the offer to record a PPF's first reading. Not being able to read it only withdraws the offer.
  useEffect(() => {
    if (type !== 'ppf') return;
    let live = true;
    void listPpf(listing.household.id)
      .then((ppf) => {
        if (live) setRates(ppf.rates);
      })
      .catch(() => {
        if (live) setRates([]);
      });
    return () => {
      live = false;
    };
  }, [type, listing.household.id]);

  const heading = RETIREMENT_LABEL[type];

  /** An NPS's value from what is typed, so the person sees what the units and the NAV come to before they are added. */
  const npsWorked = useMemo<Money | null>(() => {
    if (type !== 'nps' || units.trim() === '' || nav.trim() === '') return null;
    const result = npsValue(units, nav, CURRENCY);
    return result.ok ? result.value : null;
  }, [type, units, nav]);

  /** A PPF's value on the day, worked out from its opening balance, when the rate is known: what the first reading would be. */
  const ppfWorked = useMemo<Money | null>(() => {
    if (type !== 'ppf' || balance.trim() === '' || !isIsoDate(asAt)) return null;
    let minor: bigint;
    try {
      minor = parseAmountToMinor(balance, CURRENCY);
    } catch {
      return null;
    }
    if (minor <= 0n) return null;
    const view = ppfBalance({
      opening: { date: asAt, balance: money(minor, CURRENCY) },
      entries: [],
      rates: rates.map((rate) => ({ from: rate.effectiveFrom, ratePct: rate.ratePct })),
      on: today,
    });
    return view.ok ? view.value : null;
  }, [type, balance, asAt, rates, today]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      const date = asAt;
      if (!isIsoDate(date) || Number(date.slice(0, 4)) < 1990) throw new Error('The date it is as at is not a date this can be: check the year.');
      if (date > today) throw new Error('It cannot be as at a day after today.');
      const label = name.trim() === '' ? heading : name.trim();
      const common = { householdId: listing.household.id, memberId, name: label, currency: CURRENCY } as const;
      const withEarmark = earmark === 'none' ? {} : { earmark };

      setBusy(true);
      let result: { valueProblem: string | null };
      if (type === 'epf') {
        if (balance.trim() === '') throw new Error('The balance from the passbook is needed.');
        const amount = money(parseAmountToMinor(balance, CURRENCY), CURRENCY);
        if (amount.minor <= 0n) throw new Error('The balance is above nothing.');
        result = await onAdd({ type, ...common, ...withEarmark }, { date, quantity: '1', amount, note: 'From the passbook' });
      } else if (type === 'nps') {
        const worked = npsValue(units, nav, CURRENCY);
        if (!worked.ok) {
          throw new Error(
            worked.reason === 'invalid-units'
              ? 'The units are a number, such as 1234.5678.'
              : 'The NAV is a number above nothing, to four decimal places, such as 45.6789.',
          );
        }
        result = await onAdd(
          { type, ...common, units: units.trim(), ...withEarmark },
          { date, quantity: units.trim(), amount: worked.value, note: `NAV ${nav.trim()}` },
        );
      } else {
        if (balance.trim() === '') throw new Error('The opening balance is needed: the passbook balance as at the day below.');
        const openingBalance = money(parseAmountToMinor(balance, CURRENCY), CURRENCY);
        if (openingBalance.minor < 0n) throw new Error('An opening balance cannot be negative.');
        result = await onAdd(
          {
            type,
            ...common,
            institution,
            accountLast4: last4.trim(),
            openingDate: date,
            openingBalance,
            ...withEarmark,
          },
          recordFirst && ppfWorked !== null
            ? { date: today, quantity: '1', amount: ppfWorked, note: 'Worked out from the opening balance' }
            : null,
        );
      }
      setName('');
      setBalance('');
      setUnits('');
      setNav('');
      setInstitution('');
      setLast4('');
      setEarmark('none');
      if (result.valueProblem !== null) {
        // Added; only its value is missing, and the holding is where to record it.
        setProblem(`Added, but its value could not be recorded: ${result.valueProblem} Record it on the holding.`);
      } else {
        onDone();
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not add that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="inset-form flex flex-col gap-3"
      aria-label="Add a retirement account"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-full flex-col gap-1.5 sm:w-[330px] sm:shrink-0">
          <span className="label">Which</span>
          <select
            className="field"
            value={type}
            onChange={(event) => {
              setType(event.target.value as RetirementType);
              setProblem(null);
            }}
          >
            {(Object.keys(TYPE_CHOICE) as RetirementType[]).map((option) => (
              <option key={option} value={option}>
                {TYPE_CHOICE[option]}
              </option>
            ))}
          </select>
        </label>
        <div className="w-full sm:w-auto sm:min-w-[170px] sm:flex-1">
          <Field
            label="Name"
            placeholder={type === 'nps' ? 'NPS Tier I' : heading}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
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
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {type === 'nps' ? (
          <>
            <div className="w-full sm:w-[160px] sm:shrink-0">
              <Field
                label="Units"
                numeric
                inputMode="decimal"
                placeholder="1234.5678"
                required
                value={units}
                onChange={(event) => {
                  setUnits(event.target.value);
                }}
              />
            </div>
            <div className="w-full sm:w-[140px] sm:shrink-0">
              <Field
                label="NAV"
                numeric
                inputMode="decimal"
                placeholder="45.6789"
                required
                value={nav}
                onChange={(event) => {
                  setNav(event.target.value);
                }}
              />
            </div>
          </>
        ) : (
          <div className="w-full sm:w-[190px] sm:shrink-0">
            <Field
              label={type === 'ppf' ? 'Opening balance' : 'Balance from the passbook'}
              numeric
              inputMode="decimal"
              placeholder="0.00"
              required
              value={balance}
              onChange={(event) => {
                setBalance(event.target.value);
              }}
            />
          </div>
        )}
        <div className="w-full sm:w-[160px] sm:shrink-0">
          <Field
            label="As at"
            type="date"
            required
            value={asAt}
            onChange={(event) => {
              setAsAt(event.target.value);
            }}
          />
        </div>
        <label className="flex w-full flex-col gap-1.5 sm:w-[190px] sm:shrink-0">
          <span className="label">Set aside for</span>
          <select
            className="field"
            value={earmark}
            onChange={(event) => {
              if (isEarmark(event.target.value)) setEarmark(event.target.value);
            }}
          >
            {EARMARKS.map((option) => (
              <option key={option} value={option}>
                {EARMARK_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {type === 'ppf' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-[220px] sm:shrink-0">
            <Field
              label="Bank or post office"
              maxLength={80}
              value={institution}
              onChange={(event) => {
                setInstitution(event.target.value);
              }}
            />
          </div>
          <div className="w-full sm:w-[140px] sm:shrink-0">
            <Field
              label="Last four"
              maxLength={4}
              value={last4}
              onChange={(event) => {
                setLast4(event.target.value);
              }}
            />
          </div>
          <p className="note w-full">
            The opening balance should be as at a 31 March credit, or the day the account opened.
            <Caveat tone="info" label="Why the opening balance is as at a 31 March credit">
              A PPF&rsquo;s interest is credited once a year, on 31 March, and the passbook balance on any other day leaves out
              what has accrued since. The app works the balance out from here, but it cannot know interest it was not told
              about, so an opening balance as at a credit (or the day the account opened) is the one it can be exact from.
            </Caveat>
          </p>
        </div>
      )}

      {type === 'nps' && npsWorked !== null && (
        <p className="note">
          {units.trim()} units at {nav.trim()} is <strong>{formatMoney(npsWorked)}</strong>, recorded as its first reading.
        </p>
      )}
      {type === 'epf' && (
        <p className="note">
          Typed from the passbook once the interest is credited, and again each quarter. Nothing is estimated between.
        </p>
      )}
      {type === 'ppf' && ppfWorked !== null && (
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-1"
            checked={recordFirst}
            onChange={(event) => {
              setRecordFirst(event.target.checked);
            }}
          />
          <span className="note">
            Record today&rsquo;s value, <strong>{formatMoney(ppfWorked)}</strong>, as its first reading, so it is counted
            from the start. Worked out from the opening balance.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Adding…' : `Add the ${heading}`}
        </Button>
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {problem !== null && <Problem>{problem}</Problem>}
    </form>
  );
}
