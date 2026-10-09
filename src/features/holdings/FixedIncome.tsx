/**
 * Deposits and bonds, as a ladder.
 *
 * The prototype puts the fixed-income ladder on the investments screen rather than on a
 * tab of its own, and so does this: a deposit is a holding, and it lives where holdings do.
 * What differs is how it is known. The app asks for the terms (principal, rate, dates,
 * compounding) and works the value out on a day, so there is no figure to type every month
 * and none to go stale. A renewal the bank has made is recorded from its advice; one it
 * has not is projected, and said to be a projection.
 *
 * Nothing worked out here is stored unless somebody asks. "Record as today's reading"
 * writes the day's value as an ordinary reading, which is how a deposit comes to be in
 * net worth, the line over time and the month close without any of them learning about
 * terms. A projected renewal is an estimate, and is not offered for recording.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fixedIncomeView, trimRate, type FixedIncomePosition, type FixedIncomeRefusal } from '../../domain/fixed-income.ts';
import { formatIsoDate, istCalendarDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney, money, parseAmountToMinor } from '../../lib/money.ts';
import { addDepositRenewal, addFixedIncome, listFixedIncome } from '../../repo/fixedIncome.ts';
import { recordValuation } from '../../repo/holdings.ts';
import {
  COMPOUNDINGS,
  COUPON_FREQUENCIES,
  type CompoundingKind,
  type CouponFrequencyKind,
  type FixedIncomeListing,
  type HoldingListing,
} from '../../repo/types.ts';
import { Button, Card, Caveat, Field, Pill, Problem, Stat } from '../../ui/primitives.tsx';

const RATE = /^\d{1,3}(\.\d{1,3})?$/;

const COMPOUNDING_LABEL: Record<CompoundingKind, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
  simple: 'Simple, paid at the end',
};

const FREQUENCY_LABEL: Record<CouponFrequencyKind, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
};

const REFUSAL: Record<FixedIncomeRefusal, string> = {
  'before-start': 'It has not started yet, so there is nothing to value.',
  'broken-chain':
    'The renewals recorded do not follow on from one another: there is a gap or an overlap. It is not valued until the dates are put right.',
  'cannot-project':
    'Its term is not a whole number of months, so a renewal cannot be projected. Record the renewal from the bank’s advice.',
  'invalid-terms': 'Its terms cannot be read, so it is not valued.',
};

interface Row {
  readonly holdingId: string;
  readonly name: string;
  readonly member: string;
  readonly position: FixedIncomePosition;
  readonly institution: string | null;
  readonly last4: string | null;
  readonly rating: string | null;
  readonly view: ReturnType<typeof fixedIncomeView>;
  /** The end of the last recorded term: where a renewal begins. */
  readonly lastEnd: IsoDate;
}

export function FixedIncome({
  listing,
  privacy,
  canWrite,
  onChanged,
}: {
  listing: HoldingListing;
  privacy: boolean;
  canWrite: boolean;
  /** Called after a write that changes holdings or readings, so the screen above reloads. */
  onChanged: () => void;
}) {
  const [data, setData] = useState<FixedIncomeListing | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  // Read once at the edge; the calculation takes it as an argument.
  const [today] = useState(() => istCalendarDate(new Date()));

  const householdId = listing.household.id;
  const load = useCallback(async () => {
    try {
      setData(await listFixedIncome(householdId));
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not read the deposits and bonds.');
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<readonly Row[]>(() => {
    if (data === null) return [];
    const holdings = new Map(listing.holdings.map((h) => [h.id, h]));
    const built: Row[] = [];
    for (const terms of data.terms) {
      const holding = holdings.get(terms.holdingId);
      // Archived, or another member's private holding: not here, and not asked about.
      if (holding === undefined) continue;
      const renewals = data.renewals
        .filter((r) => r.holdingId === terms.holdingId)
        .map((r) => ({
          start: r.start,
          maturity: r.maturity,
          principal: r.principal,
          ratePct: r.ratePct,
          compounding: r.compounding,
        }));
      const position: FixedIncomePosition = {
        holdingId: terms.holdingId,
        kind: terms.kind,
        principal: terms.principal,
        ratePct: terms.ratePct,
        start: terms.start,
        maturity: terms.maturity,
        compounding: terms.compounding,
        couponFrequency: terms.couponFrequency,
        autoRenew: terms.autoRenew,
        renewalRatePct: terms.renewalRatePct,
        renewals,
      };
      const ends = [terms.maturity, ...renewals.map((r) => r.maturity)].sort();
      built.push({
        holdingId: terms.holdingId,
        name: holding.instrument.name,
        member: holding.member.displayName,
        position,
        institution: terms.institution,
        last4: terms.accountLast4,
        rating: terms.rating,
        view: fixedIncomeView(position, today),
        lastEnd: ends[ends.length - 1] ?? terms.maturity,
      });
    }
    // A ladder: what matures first, first. Matured ones after, and what could not be valued last.
    const rank = (row: Row): number => (!row.view.ok ? 2 : row.view.matured ? 1 : 0);
    const when = (row: Row): string =>
      row.view.ok && row.view.kind === 'deposit' && row.view.nextMaturity !== null
        ? row.view.nextMaturity
        : row.view.ok && row.view.kind === 'bond' && !row.view.matured
          ? row.position.maturity
          : row.lastEnd;
    return built.sort((a, b) => rank(a) - rank(b) || (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0));
  }, [data, listing.holdings, today]);

  const totals = useMemo(() => {
    const byCurrency = new Map<string, { value: bigint; projected: number; refused: number }>();
    for (const row of rows) {
      const currency = row.position.principal.currency;
      const bucket = byCurrency.get(currency) ?? { value: 0n, projected: 0, refused: 0 };
      if (row.view.ok) {
        bucket.value += row.view.value.minor;
        if (row.view.kind === 'deposit' && row.view.projected) bucket.projected += 1;
      } else {
        bucket.refused += 1;
      }
      byCurrency.set(currency, bucket);
    }
    return [...byCurrency.entries()];
  }, [rows]);

  if (loading) return null;

  if (problem !== null && data === null) {
    return (
      <Card title="Deposits and bonds">
        <Problem>{problem}</Problem>
        <div className="mt-3">
          <Button type="button" variant="quiet" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  // Nothing recorded and nobody who can record: the card has nothing to say.
  if (rows.length === 0 && !canWrite) return null;

  return (
    <Card
      title="Deposits and bonds"
      aside={
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="note">worked out from the terms, as at {formatIsoDate(today)}</span>
          <Caveat tone="info" label="How these are valued">
            You give the terms, not a value: principal, rate, dates and how it compounds. The value
            is worked out for the day, so it does not go stale. A deposit that renews itself is a
            chain of terms; a renewal you have recorded is the bank’s figure, and one you have
            not is projected on the same term and marked as a projection. A bond is valued at par,
            its face plus the interest accrued since the last coupon, because there is no market
            price for it.
          </Caveat>
        </span>
      }
    >
      {problem !== null && <Problem>{problem}</Problem>}

      {canWrite && (
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="quiet"
            aria-expanded={adding}
            onClick={() => {
              setAdding((was) => !was);
            }}
          >
            {adding ? 'Cancel' : 'Add a deposit or bond'}
          </Button>
        </div>
      )}

      {canWrite && adding && (
        <AddFixedIncome
          listing={listing}
          onDone={() => {
            setAdding(false);
            void load();
            onChanged();
          }}
        />
      )}

      {rows.length === 0 ? (
        <p className="note">
          None recorded. Give the terms of a fixed deposit or a bond and it is valued from them,
          today and on any day.
        </p>
      ) : (
        <>
          {totals.map(([currency, bucket]) => (
            <dl key={currency} className="mb-3.5 flex flex-wrap gap-x-9 gap-y-2.5">
              <Stat label={totals.length > 1 ? `Worked out, ${currency}` : 'Worked out'}>
                {formatMoney(money(bucket.value, currency), { privacy })}
                {(bucket.projected > 0 || bucket.refused > 0) && (
                  <Caveat tone="warn" label="What this total contains">
                    {bucket.projected > 0 && (
                      <>
                        {bucket.projected}{' '}
                        {bucket.projected === 1 ? 'deposit is' : 'deposits are'} in a renewal that has
                        not been recorded yet, so {bucket.projected === 1 ? 'its' : 'their'} value is an
                        assumption, not the bank’s figure.{' '}
                      </>
                    )}
                    {bucket.refused > 0 && (
                      <>
                        {bucket.refused} could not be valued and {bucket.refused === 1 ? 'is' : 'are'} not
                        in it; each says why below.
                      </>
                    )}
                  </Caveat>
                )}
              </Stat>
            </dl>
          ))}

          <ul className="row-separated">
            {rows.map((row) => (
              <li key={row.holdingId} className="py-3">
                <PositionRow
                  row={row}
                  today={today}
                  privacy={privacy}
                  canWrite={canWrite}
                  householdId={householdId}
                  onChanged={() => {
                    void load();
                    onChanged();
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function PositionRow({
  row,
  today,
  privacy,
  canWrite,
  householdId,
  onChanged,
}: {
  row: Row;
  today: IsoDate;
  privacy: boolean;
  canWrite: boolean;
  householdId: string;
  onChanged: () => void;
}) {
  const { position, view } = row;
  const [renewing, setRenewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  const terms =
    position.kind === 'deposit'
      ? `${trimRate(position.ratePct)}% · ${COMPOUNDING_LABEL[position.compounding ?? 'yearly'].toLowerCase()}`
      : `${trimRate(position.ratePct)}% coupon · ${FREQUENCY_LABEL[position.couponFrequency ?? 'yearly'].toLowerCase()}`;

  const record = async () => {
    if (!view.ok) return;
    setBusy(true);
    setProblem(null);
    try {
      await recordValuation({
        householdId,
        holdingId: row.holdingId,
        date: today,
        quantity: '1',
        amount: view.value,
        source: 'manual',
        note: 'Worked out from the terms',
      });
      setRecorded(true);
      onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0">
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{row.name}</span>{' '}
          <span className="note">
            {[row.member, row.institution, row.last4 === null ? null : `…${row.last4}`]
              .filter((part) => part !== null)
              .join(' · ')}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone="neutral">{position.kind === 'deposit' ? 'Deposit' : 'Bond'}</Pill>
          {row.rating !== null && <Pill tone="neutral">{row.rating}</Pill>}
          {position.autoRenew && <Pill tone="own">Renews itself</Pill>}
          {view.ok && view.matured && <Pill tone="neutral">Matured</Pill>}
          {view.ok && view.kind === 'deposit' && view.projected && <Pill tone="warn">Projected renewal</Pill>}
        </span>
      </div>

      <p className="note">
        {terms} · {position.autoRenew ? 'first term ' : ''}
        {formatIsoDate(position.start)} to {formatIsoDate(position.maturity)}
        {position.autoRenew && position.renewals.length > 0 && ` · renewed ${String(position.renewals.length)}×`}
      </p>

      {!view.ok ? (
        <p className="note" style={{ color: 'var(--ink-2)' }}>
          {REFUSAL[view.reason]}
        </p>
      ) : (
        <dl className="flex flex-wrap gap-x-9 gap-y-2.5">
          <Stat label={view.kind === 'bond' ? 'Value at par' : 'Value today'}>
            {formatMoney(view.value, { privacy })}
          </Stat>
          {view.kind === 'deposit' ? (
            <>
              <Stat label={view.matured ? 'Paid out' : 'This term pays'}>
                {formatMoney(view.maturityValue, { privacy })}
              </Stat>
              <Stat label="Interest so far">{formatMoney(view.interestToDate, { privacy })}</Stat>
              {view.nextMaturity !== null && view.daysToMaturity !== null && (
                <Stat label="Matures">
                  {formatIsoDate(view.nextMaturity)}{' '}
                  <span className="note">{daysPhrase(view.daysToMaturity)}</span>
                </Stat>
              )}
            </>
          ) : (
            <>
              <Stat label="Accrued">{formatMoney(view.accrued, { privacy })}</Stat>
              {view.nextCoupon !== null && (
                <Stat label="Next coupon">
                  {formatIsoDate(view.nextCoupon)}{' '}
                  <span className="note">{formatMoney(view.couponAmount, { privacy })}</span>
                </Stat>
              )}
              {view.daysToMaturity !== null && (
                <Stat label="Matures">
                  {formatIsoDate(position.maturity)}{' '}
                  <span className="note">{daysPhrase(view.daysToMaturity)}</span>
                </Stat>
              )}
            </>
          )}
        </dl>
      )}

      {problem !== null && <Problem>{problem}</Problem>}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {view.ok && !(view.kind === 'deposit' && view.projected) && (
            <button
              type="button"
              className="note underline"
              disabled={busy || recorded}
              onClick={() => void record()}
            >
              {recorded ? 'Recorded as today’s reading' : 'Record as today’s reading'}
            </button>
          )}
          {view.ok && view.kind === 'deposit' && view.projected && (
            <span className="note">A projection is not offered as a reading.</span>
          )}
          {position.kind === 'deposit' && (
            <button
              type="button"
              className="note underline"
              aria-expanded={renewing}
              onClick={() => {
                setRenewing((was) => !was);
              }}
            >
              {renewing ? 'Cancel the renewal' : 'Record a renewal'}
            </button>
          )}
        </div>
      )}

      {renewing && position.kind === 'deposit' && (
        <RenewalForm
          row={row}
          householdId={householdId}
          onDone={() => {
            setRenewing(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function daysPhrase(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${String(days)} days`;
}

function RenewalForm({
  row,
  householdId,
  onDone,
}: {
  row: Row;
  householdId: string;
  onDone: () => void;
}) {
  const currency = row.position.principal.currency;
  const [start, setStart] = useState<string>(row.lastEnd);
  const [maturity, setMaturity] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [compounding, setCompounding] = useState<CompoundingKind>(row.position.compounding ?? 'yearly');
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
      await addDepositRenewal({
        householdId,
        holdingId: row.holdingId,
        start,
        maturity,
        principal: money(minor, currency),
        ratePct: rate.trim(),
        compounding,
      });
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded p-3"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[150px]">
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
      <div className="w-full sm:w-[150px]">
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
      <div className="w-full sm:w-[150px]">
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
      <div className="w-full sm:w-[100px]">
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
      <label className="flex w-full flex-col gap-1.5 sm:w-[170px]">
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
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Record the renewal'}
      </Button>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}

function AddFixedIncome({ listing, onDone }: { listing: HoldingListing; onDone: () => void }) {
  const members = useMemo(
    () =>
      listing.viewer.canFileForOthers
        ? listing.members.filter((member) => !member.isArchived)
        : listing.members.filter((member) => member.id === listing.viewer.memberId),
    [listing.members, listing.viewer.canFileForOthers, listing.viewer.memberId],
  );

  const [kind, setKind] = useState<'deposit' | 'bond'>('deposit');
  const [name, setName] = useState('');
  const [memberId, setMemberId] = useState(listing.viewer.memberId);
  const [currency, setCurrency] = useState('INR');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [start, setStart] = useState('');
  const [maturity, setMaturity] = useState('');
  // Offered as yearly because this household's compound yearly; it is still a visible choice.
  const [compounding, setCompounding] = useState<CompoundingKind>('yearly');
  const [frequency, setFrequency] = useState<CouponFrequencyKind>('yearly');
  const [autoRenew, setAutoRenew] = useState(false);
  const [renewalRate, setRenewalRate] = useState('');
  const [rating, setRating] = useState('');
  const [institution, setInstitution] = useState('');
  const [last4, setLast4] = useState('');
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
      await addFixedIncome({
        householdId: listing.household.id,
        memberId,
        name: name.trim(),
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
      className="mb-4 flex flex-wrap items-end gap-3 rounded p-3.5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="segmented w-full sm:w-auto" role="group" aria-label="What is being added">
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

      <div className="w-full sm:min-w-[200px] sm:flex-1">
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

      <label className="flex w-full flex-col gap-1.5 sm:w-[150px]">
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

      <label className="flex w-full flex-col gap-1.5 sm:w-[90px]">
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

      <div className="w-full sm:w-[150px]">
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

      <div className="w-full sm:w-[100px]">
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

      <div className="w-full sm:w-[150px]">
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

      <div className="w-full sm:w-[150px]">
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
          <label className="flex w-full flex-col gap-1.5 sm:w-[190px]">
            <span className="label">
              Compounds
              <Caveat tone="info" label="Why compounding is asked for">
                It differs between banks and between deposits, so it is never assumed. Yearly is
                offered because it is what this household’s deposits do; the bank’s
                receipt says which.
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

          <label className="flex w-full items-center gap-2 sm:w-auto">
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
            <div className="w-full sm:w-[170px]">
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
          <label className="flex w-full flex-col gap-1.5 sm:w-[160px]">
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
          <div className="w-full sm:w-[120px]">
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

      <div className="w-full sm:w-[170px]">
        <Field
          label="Bank or issuer"
          maxLength={80}
          value={institution}
          onChange={(event) => {
            setInstitution(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[130px]">
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

      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : `Add the ${kind}`}
      </Button>

      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}
