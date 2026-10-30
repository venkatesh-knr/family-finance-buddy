/**
 * A retirement holding's own screen, in the shape of its type (docs/design/holdings.md, HD-I6: the detail view takes its kind's
 * shape; docs/decisions.md, Retirement).
 *
 * An EPF is a passbook balance and the screen records one. An NPS is units and a NAV and the screen records a NAV, the value being
 * worked out from them. A PPF is its account, its payments and the notified rate, and the screen works the balance out and offers
 * to record it as today's reading, as a deposit does: the row and net worth show the latest *recorded* reading (HD-I1) and a
 * calculation is the person's to record. Nothing is worked out here that `src/domain/ppf.ts` and `src/domain/nps.ts` do not.
 */

import { useMemo, useState } from 'react';
import { npsValue } from '../../domain/nps.ts';
import { ppfBalance, type PpfView } from '../../domain/ppf.ts';
import { formatIsoDate, isIsoDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney, money, parseAmountToMinor, type Money } from '../../lib/money.ts';
import { formatQuantity, formatQuantityGrouped } from '../../lib/quantity.ts';
import { addPpfEntry, updatePpfAccount, addPpfAccount, voidPpfEntry } from '../../repo/retirement.ts';
import type { HoldingListing, NewValuation, PpfAccount, PpfEntryRow, PpfListing } from '../../repo/types.ts';
import { Button, Caveat, Field, Pill, Problem, Stat } from '../../ui/primitives.tsx';
import { RecordReading } from './holdingParts.tsx';
import type { HoldingRow } from './useHoldings.ts';

interface Shared {
  readonly row: HoldingRow;
  readonly listing: HoldingListing;
  readonly ppf: { readonly ppf: PpfListing | null; readonly failed: boolean; readonly reload: () => Promise<void> };
  readonly today: IsoDate;
  readonly privacy: boolean;
  readonly canWrite: boolean;
  readonly record: (valuation: NewValuation) => Promise<void>;
  readonly onChanged: () => Promise<void>;
}

const INR = 'INR';

/** A PPF worked out from its account, its payments and the rate: the pieces and the view, for the screen to say. */
function useWorkedPpf(
  holdingId: string,
  ppf: PpfListing | null,
  today: IsoDate,
): {
  account: PpfAccount | null;
  entries: readonly PpfEntryRow[];
  counted: readonly PpfEntryRow[];
  view: PpfView | null;
  /** The same account worked out as at another day: what the passbook should have said then. */
  at: (on: IsoDate) => PpfView | null;
} {
  return useMemo(() => {
    if (ppf === null) return { account: null, entries: [], counted: [], view: null, at: () => null };
    const account = ppf.accounts.find((entry) => entry.holdingId === holdingId) ?? null;
    const entries = ppf.entries.filter((entry) => entry.holdingId === holdingId);
    const counted = entries.filter((entry) => !entry.isVoided);
    const at = (on: IsoDate): PpfView =>
      ppfBalance({
        ...(account === null ? {} : { opening: { date: account.openingDate, balance: account.openingBalance } }),
        entries: counted.map((entry) => ({ date: entry.date, amount: entry.amount })),
        rates: ppf.rates.map((rate) => ({ from: rate.effectiveFrom, ratePct: rate.ratePct })),
        on,
      });
    return { account, entries, counted, view: at(today), at };
  }, [holdingId, ppf, today]);
}

// ─── in the value card: what to record, by type ───────────────────────────────────────────────────────────────────

export function RetirementValue(props: Shared) {
  const { row, listing, today, canWrite, record, onChanged } = props;
  const type = row.holding.instrument.retirementType;
  const [recording, setRecording] = useState(false);
  if (!canWrite) return type === 'ppf' ? <PpfWorked {...props} /> : null;

  const action = (label: string) => (
    <div className="value-actions">
      <button
        type="button"
        className="quiet-button"
        aria-expanded={recording}
        onClick={() => {
          setRecording((was) => !was);
        }}
      >
        {recording ? 'Cancel this reading' : label}
      </button>
    </div>
  );

  if (type === 'epf') {
    return (
      <>
        {action('Record the passbook balance')}
        {recording && (
          <RecordReading
            listing={listing}
            holdingId={row.holding.id}
            quantity="1"
            currency={INR}
            today={today}
            label="Passbook balance"
            onRecord={async (valuation) => {
              await record(valuation);
              setRecording(false);
            }}
          />
        )}
      </>
    );
  }

  if (type === 'nps') {
    return (
      <>
        {action('Record the NAV')}
        {recording && (
          <NavForm
            householdId={listing.household.id}
            row={row}
            today={today}
            privacy={props.privacy}
            onRecord={async (valuation) => {
              await record(valuation);
              setRecording(false);
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <PpfWorked {...props} />
      {action('Record a passbook balance')}
      {recording && (
        <RecordReading
          listing={listing}
          holdingId={row.holding.id}
          quantity="1"
          currency={INR}
          today={today}
          label="Passbook balance"
          onRecord={async (valuation) => {
            await record(valuation);
            setRecording(false);
            await onChanged();
          }}
        />
      )}
    </>
  );
}

/** An NPS's NAV: typed with the day it is of, and the value worked out from the units, so a value is never typed. */
function NavForm({
  householdId,
  row,
  today,
  privacy,
  onRecord,
}: {
  householdId: string;
  row: HoldingRow;
  today: IsoDate;
  privacy: boolean;
  onRecord: (valuation: NewValuation) => Promise<void>;
}) {
  const units = formatQuantity(row.unitsHeld);
  const [nav, setNav] = useState('');
  const [date, setDate] = useState<string>(today);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const worked = npsValue(units, nav, INR);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    if (!isIsoDate(date) || date > today) {
      setProblem('The NAV is of a day that is not after today.');
      return;
    }
    if (!worked.ok) {
      setProblem('The NAV is a number above nothing, to four decimal places, such as 45.6789.');
      return;
    }
    setBusy(true);
    try {
      await onRecord({
        householdId,
        holdingId: row.holding.id,
        date,
        quantity: units,
        amount: worked.value,
        source: date === today ? 'manual' : 'backfill',
        note: `NAV ${nav.trim()}`,
      });
      setNav('');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="inset-form mt-3.5 flex flex-wrap items-end gap-3"
      aria-label="Record the NAV"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[9rem] sm:shrink-0">
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
      <div className="w-full sm:w-[9.375rem] sm:shrink-0">
        <Field
          label="Of"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Record'}
      </Button>
      <p className="note w-full">
        {formatQuantityGrouped(row.unitsHeld)} units
        {nav.trim() !== '' && worked.ok ? <> at {nav.trim()} is <strong>{formatMoney(worked.value, { privacy })}</strong>.</> : '.'}
      </p>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}

/**
 * What a PPF is worth today, worked out, and how to make it the reading: the same as a deposit's, and for the same reason.
 * The value is the passbook's, which steps on 31 March; what has accrued since is said beside it and is not in it.
 */
function PpfWorked({ row, ppf, today, privacy, canWrite, record, listing, onChanged }: Shared) {
  const { account, view, at } = useWorkedPpf(row.holding.id, ppf.ppf, today);
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (ppf.failed) {
    return (
      <p className="note" role="alert">
        The account could not be read, so what it is worth cannot be worked out. Reload to try again.
      </p>
    );
  }
  if (ppf.ppf === null) return null;
  if (account === null) {
    return <p className="note">No account is recorded for this PPF, so there is nothing to work its balance out from. Give it one below.</p>;
  }
  if (view === null) return null;
  if (!view.ok) {
    return (
      <p className="note" role="alert">
        {view.reason === 'no-rate'
          ? `It cannot be worked out: no rate is in force for ${view.month}.`
          : view.reason === 'before-opening'
            ? 'A payment is dated before the opening balance, which the balance already includes. Correct the date or the opening balance.'
            : view.reason === 'overdrawn'
              ? 'The balance would go below nothing: a withdrawal is more than was in the account.'
              : 'It cannot be worked out from what is recorded.'}
      </p>
    );
  }

  // A passbook balance somebody typed (a reading with no note) that the account does not work out for that day. The bank's figure
  // is not overwritten with the app's: the difference says the opening balance or a payment is wrong, and the way to put it right is
  // to correct those, after which the two agree.
  const typed = listing.valuations
    .filter((reading) => reading.holdingId === row.holding.id && reading.note === null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
  const thatDay = typed === undefined ? null : at(typed.date);
  const discrepancy =
    typed !== undefined && thatDay !== null && thatDay.ok && thatDay.value.minor !== typed.amount.minor
      ? { typed, worked: thatDay.value }
      : null;

  const latest = row.latest;
  const same = latest !== null && latest.date === today && latest.amountMinor === view.value.minor;
  const change = latest === null ? view.value.minor : view.value.minor - latest.amountMinor;

  return (
    <div className="worked-out" data-testid="ppf-worked-out">
      <p className="worked-out-line">
        <span>Worked out today</span>
        <span className="tabular-nums">{formatMoney(view.value, { privacy })}</span>
      </p>
      {!same && (
        <p className="worked-out-line worked-out-sub">
          <span>
            not in net worth until recorded
            <Caveat tone="info" label="Why this is not in net worth yet">
              Net worth counts the latest reading, not the figure worked out from the account. Record it as today&rsquo;s
              reading and it is counted from today.
            </Caveat>
          </span>
          {latest !== null && (
            <span className="tabular-nums">
              {change < 0n ? '−' : change > 0n ? '+' : ''}
              {formatMoney(money(change < 0n ? -change : change, INR), { privacy })}
            </span>
          )}
        </p>
      )}
      <p className="worked-out-line worked-out-sub">
        <span>
          Interest accrued since the last credit, not in the figure above
          <Caveat tone="info" label="When the interest is credited">
            A PPF&rsquo;s interest is credited once a year, on 31 March, and the passbook steps then. Until it does, what has
            accrued is not part of the balance, and is not counted here.
          </Caveat>
        </span>
        <span className="tabular-nums">{formatMoney(view.accrued, { privacy })}</span>
      </p>
      {discrepancy !== null && (
        <p className="note" role="status" data-testid="ppf-discrepancy">
          Your passbook said <strong>{formatMoney(discrepancy.typed.amount, { privacy })}</strong> on{' '}
          {formatIsoDate(discrepancy.typed.date)}; the account works out{' '}
          <strong>{formatMoney(discrepancy.worked, { privacy })}</strong> for that day. The difference means the opening balance or a
          payment is not right: correct the account or the payments below, and the two will agree. The passbook&rsquo;s figure is
          not replaced by the worked-out one.
        </p>
      )}
      {canWrite &&
        discrepancy === null &&
        (recorded || same ? (
          <p className="note" role="status">
            Recorded as today’s reading
          </p>
        ) : (
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setProblem(null);
              record({
                householdId: listing.household.id,
                holdingId: row.holding.id,
                date: today,
                quantity: '1',
                amount: view.value,
                source: 'manual',
                note: 'Worked out from the account',
              })
                .then(async () => {
                  setRecorded(true);
                  await onChanged();
                })
                .catch((error: unknown) => {
                  setProblem(error instanceof Error ? error.message : 'Could not record that.');
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            Record as today’s reading
          </Button>
        ))}
      {problem !== null && (
        <p className="note" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

// ─── the cards under the value: the shape of each type ────────────────────────────────────────────────────────────

export function RetirementCards(props: Shared & { readonly children?: React.ReactNode }) {
  const { row, listing, privacy, children } = props;
  const type = row.holding.instrument.retirementType;
  const mine = listing.valuations
    .filter((reading) => reading.holdingId === row.holding.id)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 12);

  return (
    <>
      {type === 'ppf' && <PpfCards {...props} />}

      {type === 'nps' && (
        <section className="card" aria-label="Position">
          <h2 className="label">Position</h2>
          <dl className="term-stats mt-1.5">
            <Stat label="Units">{formatQuantityGrouped(row.unitsHeld)}</Stat>
            <Stat label="Latest reading">
              {row.latest === null ? <span className="note">none yet</span> : formatIsoDate(row.latest.date)}
            </Stat>
          </dl>
          <p className="note mt-2">
            Units are from the statement of transactions and the NAV is the one the regulator publishes. Change the units
            under Edit.
          </p>
        </section>
      )}

      {type === 'epf' && (
        <section className="card" aria-label="Passbook">
          <h2 className="label">Passbook</h2>
          <p className="note mt-1.5">
            Typed from the passbook once the interest is credited, and again each quarter. Nothing is estimated between the
            readings.
          </p>
        </section>
      )}

      <section className="card" aria-label="Readings">
        <h2 className="label">Readings</h2>
        {mine.length === 0 ? (
          <p className="note mt-1.5">None recorded.</p>
        ) : (
          <ul className="row-separated mt-1">
            {mine.map((reading) => (
              <li key={`${reading.date}-${reading.source}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  {formatIsoDate(reading.date)}
                  {reading.note !== null && <span className="note"> · {reading.note}</span>}
                </span>
                <span className="tabular-nums">{formatMoney(reading.amount, { privacy })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {children}
    </>
  );
}

function PpfCards(props: Shared) {
  const { row, listing, ppf, today, privacy, canWrite, onChanged } = props;
  const { account, entries, view } = useWorkedPpf(row.holding.id, ppf.ppf, today);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A PPF that could not be read, or has not been yet, is not a PPF with no account and no payments, and must not be offered an
  // account it already has.
  if (ppf.failed) {
    return (
      <section className="card" aria-label="Account">
        <h2 className="label">Account</h2>
        <div className="mt-1.5">
          <Problem>The account and its payments could not be read, so nothing is said of them here. Reload to try again.</Problem>
        </div>
      </section>
    );
  }
  if (ppf.ppf === null) {
    return (
      <section className="card" aria-label="Account">
        <h2 className="label">Account</h2>
        <p className="note mt-1.5">Reading the account…</p>
      </section>
    );
  }

  const rateInForce = view !== null && view.ok ? view.rateInForce : null;
  const rate = ppf.ppf?.rates.filter((entry) => entry.effectiveFrom <= today).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];

  return (
    <>
      <section className="card" aria-label="Account">
        <div className="flex items-center justify-between gap-3">
          <h2 className="label">Account</h2>
          {canWrite && (
            <button
              type="button"
              className="quiet-button"
              aria-expanded={editing}
              onClick={() => {
                setEditing((was) => !was);
              }}
            >
              {editing ? 'Cancel' : account === null ? 'Give it an account' : 'Correct the account'}
            </button>
          )}
        </div>
        {account === null ? (
          <p className="note mt-1.5">No account is recorded: where it is and the balance to work it out from.</p>
        ) : (
          <dl className="term-stats mt-1.5">
            <Stat label="Where">
              {account.institution ?? <span className="note">not said</span>}
              {account.accountLast4 !== null && <span className="note"> · …{account.accountLast4}</span>}
            </Stat>
            <Stat label="Opening balance">
              {formatMoney(account.openingBalance, { privacy })}
              <span className="note"> as at {formatIsoDate(account.openingDate)}</span>
            </Stat>
            <Stat label="Notified rate">
              {rateInForce === null || rate === undefined ? (
                <span className="note">none in force</span>
              ) : (
                <>
                  {rateInForce.replace(/0+$/, '').replace(/\.$/, '')}%<span className="note"> since {formatIsoDate(rate.effectiveFrom)}</span>
                </>
              )}
            </Stat>
          </dl>
        )}
        {canWrite && editing && (
          <PpfAccountForm
            householdId={listing.household.id}
            holdingId={row.holding.id}
            account={account}
            today={today}
            onDone={async () => {
              setEditing(false);
              await ppf.reload();
              await onChanged();
            }}
          />
        )}
      </section>

      {view !== null && view.ok && view.credits.length > 0 && (
        <section className="card" aria-label="Interest, as worked out">
          <h2 className="label">Interest, as worked out</h2>
          <ul className="row-separated mt-1">
            {[...view.credits].reverse().map((credit) => (
              <li key={credit.on} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  {formatIsoDate(credit.on)} <span className="note">· due on 31 March, to the nearest rupee</span>
                </span>
                <span className="tabular-nums">{formatMoney(credit.interest, { privacy })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-label="Payments">
        <h2 className="label">Payments</h2>
        {problem !== null && <Problem>{problem}</Problem>}
        {entries.length === 0 ? (
          <p className="note mt-1.5">None recorded since the opening balance.</p>
        ) : (
          <ul className="row-separated mt-1">
            {[...entries].reverse().map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span style={entry.isVoided ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>
                    {formatIsoDate(entry.date)}
                  </span>
                  <Pill tone={entry.amount.minor < 0n ? 'due' : 'ok'}>{entry.amount.minor < 0n ? 'Withdrawal' : 'Payment'}</Pill>
                  {entry.isVoided && <Pill tone="due">Voided</Pill>}
                  {entry.note !== null && <span className="note">{entry.note}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span
                    className="tabular-nums"
                    style={entry.isVoided ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}
                  >
                    {formatMoney(money(entry.amount.minor < 0n ? -entry.amount.minor : entry.amount.minor, INR), { privacy })}
                  </span>
                  {canWrite && !entry.isVoided && (
                    <button
                      type="button"
                      className="quiet-button"
                      disabled={busy}
                      aria-label={`Void the ${entry.amount.minor < 0n ? 'withdrawal' : 'payment'} of ${formatIsoDate(entry.date)}`}
                      onClick={() => {
                        setBusy(true);
                        setProblem(null);
                        voidPpfEntry(entry.id)
                          .then(async () => {
                            await ppf.reload();
                          })
                          .catch((error: unknown) => {
                            setProblem(error instanceof Error ? error.message : 'Could not void that.');
                          })
                          .finally(() => {
                            setBusy(false);
                          });
                      }}
                    >
                      Void
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canWrite && account !== null && (
          <PpfEntryForm
            householdId={listing.household.id}
            holdingId={row.holding.id}
            openingDate={account.openingDate}
            today={today}
            onDone={async () => {
              await ppf.reload();
            }}
          />
        )}
        <p className="note mt-2">
          A payment made after the 5th earns from the next month. The year&rsquo;s interest is credited on 31 March.
        </p>
      </section>
    </>
  );
}

function PpfEntryForm({
  householdId,
  holdingId,
  openingDate,
  today,
  onDone,
}: {
  householdId: string;
  holdingId: string;
  openingDate: IsoDate;
  today: IsoDate;
  onDone: () => Promise<void>;
}) {
  const [date, setDate] = useState<string>(today);
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'payment' | 'withdrawal'>('payment');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      if (!isIsoDate(date) || Number(date.slice(0, 4)) < 1990) throw new Error('That date is not one this can be: check the year.');
      if (date > today) throw new Error('A payment cannot be dated after today.');
      if (date < openingDate) throw new Error('A payment cannot be dated before the opening balance, which already includes it.');
      if (amount.trim() === '') throw new Error('The amount is needed.');
      const minor = parseAmountToMinor(amount, INR);
      if (minor <= 0n) throw new Error('The amount is above nothing: say whether it is a payment or a withdrawal.');

      setBusy(true);
      await addPpfEntry({
        householdId,
        holdingId,
        date,
        amount: money(kind === 'withdrawal' ? -minor : minor, INR),
      });
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
      className="inset-form mt-3 flex flex-wrap items-end gap-3"
      aria-label="Record a PPF payment"
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
      <label className="flex w-full flex-col gap-1.5 sm:w-[9rem] sm:shrink-0">
        <span className="label">Type</span>
        <select
          className="field"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value === 'withdrawal' ? 'withdrawal' : 'payment');
          }}
        >
          <option value="payment">Payment in</option>
          <option value="withdrawal">Withdrawal</option>
        </select>
      </label>
      <div className="w-full sm:w-[9.375rem] sm:shrink-0">
        <Field
          label="Amount"
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
        {busy ? 'Saving…' : 'Record'}
      </Button>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}

function PpfAccountForm({
  householdId,
  holdingId,
  account,
  today,
  onDone,
}: {
  householdId: string;
  holdingId: string;
  account: PpfAccount | null;
  today: IsoDate;
  onDone: () => Promise<void>;
}) {
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const [last4, setLast4] = useState(account?.accountLast4 ?? '');
  const [openingDate, setOpeningDate] = useState<string>(account?.openingDate ?? '');
  const [balance, setBalance] = useState(
    account === null ? '' : formatPlain(account.openingBalance),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      if (!isIsoDate(openingDate) || Number(openingDate.slice(0, 4)) < 1990) throw new Error('The date it is as at is not a date this can be: check the year.');
      if (openingDate > today) throw new Error('It cannot be as at a day after today.');
      if (balance.trim() === '') throw new Error('The opening balance is needed.');
      const openingBalance = money(parseAmountToMinor(balance, INR), INR);

      setBusy(true);
      if (account === null) {
        await addPpfAccount({ householdId, holdingId, institution, accountLast4: last4.trim(), openingDate, openingBalance });
      } else {
        await updatePpfAccount(holdingId, { institution, accountLast4: last4.trim(), openingDate, openingBalance });
      }
      await onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="inset-form mt-3 flex flex-wrap items-end gap-3"
      aria-label={account === null ? 'Give the PPF an account' : 'Correct the PPF account'}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[210px] sm:shrink-0">
        <Field
          label="Bank or post office"
          maxLength={80}
          value={institution}
          onChange={(event) => {
            setInstitution(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[120px] sm:shrink-0">
        <Field
          label="Last four"
          maxLength={4}
          value={last4}
          onChange={(event) => {
            setLast4(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[170px] sm:shrink-0">
        <Field
          label="Opening balance"
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
      <div className="w-full sm:w-[9.375rem] sm:shrink-0">
        <Field
          label="As at"
          type="date"
          required
          value={openingDate}
          onChange={(event) => {
            setOpeningDate(event.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : account === null ? 'Save the account' : 'Save the corrections'}
      </Button>
      <p className="note w-full">As at a 31 March credit, or the day the account opened.</p>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}

/** An amount as it is typed into a field: digits and a point, no symbol, no grouping. */
function formatPlain(value: Money): string {
  const digits = (value.minor < 0n ? -value.minor : value.minor).toString().padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2).replace(/0+$/, '');
  return `${value.minor < 0n ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}
