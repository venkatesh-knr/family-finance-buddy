/**
 * The forms behind the Deposits and bonds card: terms (new, for a holding already held, or
 * corrected in place) and a renewal (new, or corrected).
 *
 * Laid out on a grid, not as a wrapping row. A row that wraps and aligns its items to the
 * bottom put the input of any field with a hint a line higher than its neighbours', which is
 * how the first version came out crooked. On a grid every label sits on one line and every
 * input beneath it on the next; a hint hangs below and moves nothing.
 */

import { useMemo, useState } from 'react';
import { trimRate } from '../../domain/fixed-income.ts';
import { minorUnitExponent, money, parseAmountToMinor, type Money } from '../../lib/money.ts';
import type { IsoDate } from '../../lib/dates.ts';
import {
  addDepositRenewal,
  addFixedIncome,
  addTermsToHolding,
  updateDepositRenewal,
  updateTerms,
} from '../../repo/fixedIncome.ts';
import { updateHolding } from '../../repo/holdings.ts';
import {
  COMPOUNDINGS,
  COUPON_FREQUENCIES,
  type CompoundingKind,
  type CouponFrequencyKind,
  type DepositRenewal,
  type FixedIncomeTerms,
  type Holding,
  type HoldingListing,
} from '../../repo/types.ts';
import { Button, Caveat, Field, Problem } from '../../ui/primitives.tsx';

export const RATE = /^\d{1,3}(\.\d{1,3})?$/;

export const COMPOUNDING_LABEL: Record<CompoundingKind, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
  simple: 'Simple, paid at the end',
};

export const FREQUENCY_LABEL: Record<CouponFrequencyKind, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
};

/** An amount as it is typed into a field: digits and a point, no symbol, no grouping. */
export function plainAmount(value: Money): string {
  const exponent = minorUnitExponent(value.currency);
  const digits = (value.minor < 0n ? -value.minor : value.minor).toString().padStart(exponent + 1, '0');
  const sign = value.minor < 0n ? '-' : '';
  if (exponent === 0) return `${sign}${digits}`;
  const whole = digits.slice(0, -exponent);
  const fraction = digits.slice(-exponent).replace(/0+$/, '');
  return `${sign}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}

export type TermsMode =
  | { readonly kind: 'new' }
  | { readonly kind: 'existing'; readonly holding: Holding }
  | { readonly kind: 'edit'; readonly holding: Holding; readonly terms: FixedIncomeTerms };

const FORM_CLASS = 'grid items-start gap-3 rounded p-3.5 sm:grid-cols-2 lg:grid-cols-4';
const FORM_STYLE = { background: 'var(--surface-2)', border: '1px solid var(--line)' } as const;

export function TermsForm({
  listing,
  mode,
  onDone,
  onCancel,
}: {
  listing: HoldingListing;
  mode: TermsMode;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const members = useMemo(
    () =>
      listing.viewer.canFileForOthers
        ? listing.members.filter((member) => !member.isArchived)
        : listing.members.filter((member) => member.id === listing.viewer.memberId),
    [listing.members, listing.viewer.canFileForOthers, listing.viewer.memberId],
  );

  const held = mode.kind === 'new' ? undefined : mode.holding;
  const old = mode.kind === 'edit' ? mode.terms : undefined;

  const [kind, setKind] = useState<'deposit' | 'bond'>(
    old !== undefined ? old.kind : held?.instrument.kind === 'bond' ? 'bond' : 'deposit',
  );
  const [name, setName] = useState('');
  const [memberId, setMemberId] = useState(listing.viewer.memberId);
  const [currency, setCurrency] = useState(old?.principal.currency ?? held?.instrument.currency ?? 'INR');
  const [amount, setAmount] = useState(old === undefined ? '' : plainAmount(old.principal));
  const [rate, setRate] = useState(old === undefined ? '' : trimRate(old.ratePct));
  const [start, setStart] = useState<string>(old?.start ?? held?.openedOn ?? '');
  const [maturity, setMaturity] = useState<string>(old?.maturity ?? '');
  // Offered as yearly because this household's compound yearly; it is still a visible choice.
  const [compounding, setCompounding] = useState<CompoundingKind>(old?.compounding ?? 'yearly');
  const [frequency, setFrequency] = useState<CouponFrequencyKind>(old?.couponFrequency ?? 'yearly');
  const [autoRenew, setAutoRenew] = useState(old?.autoRenew ?? false);
  const [renewalRate, setRenewalRate] = useState(
    old?.renewalRatePct === null || old?.renewalRatePct === undefined ? '' : trimRate(old.renewalRatePct),
  );
  const [rating, setRating] = useState(old?.rating ?? '');
  const [institution, setInstitution] = useState(old?.institution ?? '');
  const [last4, setLast4] = useState(old?.accountLast4 ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);

    if (!RATE.test(rate.trim()) || Number(rate) > 100) {
      setProblem('The rate is a percentage such as 7.25.');
      return;
    }
    if (autoRenew && renewalRate.trim() !== '' && (!RATE.test(renewalRate.trim()) || Number(renewalRate) > 100)) {
      setProblem('The rate to project renewals at is a percentage such as 7.25, or leave it empty.');
      return;
    }
    if (last4.trim() !== '' && !/^[0-9A-Za-z]{4}$/.test(last4.trim())) {
      setProblem('Keep only the last four characters of the account or certificate, and nothing more.');
      return;
    }
    let minor: bigint;
    try {
      minor = parseAmountToMinor(amount, currency);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That amount is not a number.');
      return;
    }

    setBusy(true);
    try {
      const terms = {
        householdId: listing.household.id,
        kind,
        principal: money(minor, currency),
        ratePct: rate.trim(),
        start,
        maturity,
        ...(kind === 'deposit'
          ? { compounding, autoRenew, renewalRatePct: autoRenew ? renewalRate : null }
          : { couponFrequency: frequency, rating }),
        institution,
        accountLast4: last4,
      } as const;

      if (mode.kind === 'new') {
        await addFixedIncome({ ...terms, memberId, name: name.trim() });
      } else if (mode.kind === 'existing') {
        await addTermsToHolding({ ...terms, holdingId: mode.holding.id });
      } else {
        await updateTerms({ ...terms, holdingId: mode.holding.id });
        // The holding's own cost and opening date were set from these terms, so they follow
        // when they still agree with what is being replaced. A cost somebody set by hand to
        // something else is theirs, and is left alone.
        const sync: { cost?: Money; openedOn?: IsoDate } = {};
        if (
          mode.holding.cost !== null &&
          mode.holding.cost.minor === mode.terms.principal.minor &&
          mode.terms.principal.minor !== minor
        ) {
          sync.cost = money(minor, currency);
        }
        if (mode.holding.openedOn === mode.terms.start && mode.terms.start !== start) {
          sync.openedOn = start;
        }
        if (sync.cost !== undefined || sync.openedOn !== undefined) {
          await updateHolding(mode.holding.id, mode.holding.instrument.id, sync);
        }
      }
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={`mb-4 ${FORM_CLASS}`}
      style={FORM_STYLE}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {held !== undefined && (
        <p className="col-span-full" style={{ color: 'var(--ink)', fontWeight: 600 }}>
          {mode.kind === 'edit' ? 'Correct the terms of' : 'Terms for'} {held.instrument.name}{' '}
          <span className="note">{held.member.displayName}</span>
        </p>
      )}

      {mode.kind === 'new' && (
        <>
          <div className="segmented col-span-full w-fit" role="group" aria-label="What is being added">
            {(['deposit', 'bond'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                onClick={() => {
                  setKind(option);
                }}
              >
                {option === 'deposit' ? 'Fixed deposit' : 'Bond'}
              </button>
            ))}
          </div>

          <div className="min-w-0 sm:col-span-2">
            <Field
              label="Name"
              required
              placeholder={kind === 'deposit' ? 'HDFC FD, 3 years' : 'Muthoot NCD 2027'}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>

          <label className="flex min-w-0 flex-col gap-1.5">
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

          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="label">Currency</span>
            <select
              className="field"
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value);
              }}
            >
              <option value="INR">INR</option>
              <option value="USD">USD</option>
            </select>
          </label>
        </>
      )}

      <div className="min-w-0">
        <Field
          label={kind === 'deposit' ? 'Principal' : 'Face value'}
          numeric
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </div>

      <div className="min-w-0">
        <Field
          label={kind === 'deposit' ? 'Rate %' : 'Coupon %'}
          numeric
          inputMode="decimal"
          required
          value={rate}
          onChange={(event) => {
            setRate(event.target.value);
          }}
        />
      </div>

      <div className="min-w-0">
        <Field
          label="Starts"
          type="date"
          required
          value={start}
          onChange={(event) => {
            setStart(event.target.value);
          }}
        />
      </div>

      <div className="min-w-0">
        <Field
          label="Matures"
          type="date"
          required
          value={maturity}
          onChange={(event) => {
            setMaturity(event.target.value);
          }}
        />
      </div>

      {kind === 'deposit' ? (
        <>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="label">
              Compounds
              <Caveat tone="info" label="Why compounding is asked for">
                It differs between banks and between deposits, so it is never assumed. Yearly is
                offered because it is what this household’s deposits do; the bank’s receipt says
                which.
              </Caveat>
            </span>
            <select
              className="field"
              value={compounding}
              onChange={(event) => {
                setCompounding(event.target.value as CompoundingKind);
              }}
            >
              {COMPOUNDINGS.map((option) => (
                <option key={option} value={option}>
                  {COMPOUNDING_LABEL[option]}
                </option>
              ))}
            </select>
          </label>

          {/* Level with the inputs beside it: a label's height of space above the box. */}
          <label className="flex min-w-0 items-center gap-2 sm:mt-7">
            <input
              type="checkbox"
              checked={autoRenew}
              onChange={(event) => {
                setAutoRenew(event.target.checked);
              }}
            />
            <span>Renews itself at maturity</span>
          </label>

          {autoRenew && (
            <div className="min-w-0">
              <Field
                label="Project renewals at %"
                numeric
                inputMode="decimal"
                hint="empty means the same rate"
                value={renewalRate}
                onChange={(event) => {
                  setRenewalRate(event.target.value);
                }}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="label">Coupon paid</span>
            <select
              className="field"
              value={frequency}
              onChange={(event) => {
                setFrequency(event.target.value as CouponFrequencyKind);
              }}
            >
              {COUPON_FREQUENCIES.map((option) => (
                <option key={option} value={option}>
                  {FREQUENCY_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <div className="min-w-0">
            <Field
              label="Rating"
              placeholder="CRISIL A"
              maxLength={12}
              value={rating}
              onChange={(event) => {
                setRating(event.target.value);
              }}
            />
          </div>
        </>
      )}

      <div className="min-w-0 sm:col-span-2">
        <Field
          label="Bank or issuer"
          maxLength={80}
          value={institution}
          onChange={(event) => {
            setInstitution(event.target.value);
          }}
        />
      </div>
      <div className="min-w-0">
        <Field
          label="Last four"
          maxLength={4}
          hint="of the account, nothing more"
          value={last4}
          onChange={(event) => {
            setLast4(event.target.value);
          }}
        />
      </div>

      <div className="col-span-full flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy
            ? 'Saving…'
            : mode.kind === 'new'
              ? `Add the ${kind}`
              : mode.kind === 'existing'
                ? 'Save the terms'
                : 'Save the corrections'}
        </Button>
        {onCancel !== undefined && (
          <Button type="button" variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {problem !== null && (
        <div className="col-span-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}

export function RenewalForm({
  holdingId,
  householdId,
  currency,
  defaultCompounding,
  defaultStart,
  editing,
  onDone,
  onCancel,
}: {
  holdingId: string;
  householdId: string;
  currency: string;
  defaultCompounding: CompoundingKind;
  /** Where a new renewal begins: the day the last term ended. */
  defaultStart: IsoDate;
  /** A renewal already recorded, to be corrected. */
  editing?: DepositRenewal;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState<string>(editing?.start ?? defaultStart);
  const [maturity, setMaturity] = useState<string>(editing?.maturity ?? '');
  const [principal, setPrincipal] = useState(editing === undefined ? '' : plainAmount(editing.principal));
  const [rate, setRate] = useState(editing === undefined ? '' : trimRate(editing.ratePct));
  const [compounding, setCompounding] = useState<CompoundingKind>(editing?.compounding ?? defaultCompounding);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    if (!RATE.test(rate.trim()) || Number(rate) > 100) {
      setProblem('The rate is a percentage such as 7.25.');
      return;
    }
    let minor: bigint;
    try {
      minor = parseAmountToMinor(principal, currency);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That amount is not a number.');
      return;
    }
    setBusy(true);
    try {
      const fields = {
        start,
        maturity,
        principal: money(minor, currency),
        ratePct: rate.trim(),
        compounding,
      };
      if (editing === undefined) await addDepositRenewal({ householdId, holdingId, ...fields });
      else await updateDepositRenewal(editing.id, fields);
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid items-start gap-3 rounded p-3 sm:grid-cols-2 lg:grid-cols-5"
      style={FORM_STYLE}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="min-w-0">
        <Field
          label="New term starts"
          type="date"
          required
          hint="the day the last one ended"
          value={start}
          onChange={(event) => {
            setStart(event.target.value);
          }}
        />
      </div>
      <div className="min-w-0">
        <Field
          label="Matures"
          type="date"
          required
          value={maturity}
          onChange={(event) => {
            setMaturity(event.target.value);
          }}
        />
      </div>
      <div className="min-w-0">
        <Field
          label={`Starts from (${currency})`}
          numeric
          inputMode="decimal"
          required
          hint="as the bank’s advice states it"
          value={principal}
          onChange={(event) => {
            setPrincipal(event.target.value);
          }}
        />
      </div>
      <div className="min-w-0">
        <Field
          label="Rate %"
          numeric
          inputMode="decimal"
          required
          value={rate}
          onChange={(event) => {
            setRate(event.target.value);
          }}
        />
      </div>
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="label">Compounds</span>
        <select
          className="field"
          value={compounding}
          onChange={(event) => {
            setCompounding(event.target.value as CompoundingKind);
          }}
        >
          {COMPOUNDINGS.map((option) => (
            <option key={option} value={option}>
              {COMPOUNDING_LABEL[option]}
            </option>
          ))}
        </select>
      </label>
      <div className="col-span-full flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : editing === undefined ? 'Record the renewal' : 'Save the corrections'}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {problem !== null && (
        <div className="col-span-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}
