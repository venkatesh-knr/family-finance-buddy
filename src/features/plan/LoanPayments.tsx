/**
 * The payments on one loan, under its row on the plan's loans card (docs/design/ledger-income.md section 4c; LI-I36 to LI-I39).
 *
 * *Record a payment* is a one-step form: the amount that left (the instalment, when one is stated, as a starting figure), the day, and *Paid from*, the
 * optional picker of section 4a, offered only for accounts in the loan's own currency. The loan lists its payments, newest first, each with the account it
 * left, or *no account said*, and a way to void one, which asks first. Only an owner or a partner records or voids; anyone who reads the loan reads them.
 * A payment does not change what the loan says is outstanding.
 */

import { useMemo, useState } from 'react';
import { formatShortDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney } from '../../lib/money.ts';
import { todayInIst } from '../../repo/expenses.ts';
import { addLoanPayment, voidLoanPayment } from '../../repo/loanPayments.ts';
import type { Account, Liability, LoanPayment } from '../../repo/types.ts';
import { Button, Field, Pill, Problem } from '../../ui/primitives.tsx';
import { PaidFromField } from '../holdings/PaidFromField.tsx';
import { recentlyNamed } from '../holdings/paidFrom.ts';
import { accountLabelFor, loanPaymentChoices, loanPaymentOf, suggestedAmount } from './loanPayment.ts';

export function LoanPayments({
  liability,
  householdId,
  payments,
  accounts,
  accountsFailed,
  paymentsState,
  editable,
  privacy,
  onChanged,
}: {
  liability: Liability;
  householdId: string;
  /** Every payment the caller reads, on any loan: this one's are picked out. */
  payments: readonly LoanPayment[];
  accounts: readonly Account[];
  accountsFailed: boolean;
  /** Whether the payments have been read. Until they have, or when they could not be, a loan is not said to have none, and nothing is recorded on it. */
  paymentsState: 'reading' | 'failed' | 'read';
  editable: boolean;
  privacy: boolean;
  onChanged: () => void;
}) {
  const mine = useMemo(() => payments.filter((payment) => payment.liabilityId === liability.id), [payments, liability.id]);
  const counted = mine.filter((payment) => !payment.isVoided).length;
  const [open, setOpen] = useState(false);
  // A figure typed into a box is its digits in the markup, so with amounts hidden the form is not drawn at all (tokens.md section 8).
  const [amount, setAmount] = useState(() => suggestedAmount(liability));
  const [date, setDate] = useState<string>(() => todayInIst());
  const [accountId, setAccountId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);

  const choices = useMemo(() => loanPaymentChoices(accounts, liability.currency, recentlyNamed(mine)), [accounts, liability.currency, mine]);
  const panelId = `loan-payments-${liability.id}`;

  const record = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setProblem(null);
    const result = loanPaymentOf({ loan: liability, amount, date, accountId, accounts });
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setBusy(true);
    try {
      await addLoanPayment({ householdId, liabilityId: liability.id, amount: result.value.amount, date: result.value.date as IsoDate, accountId: result.value.accountId });
      setAmount(suggestedAmount(liability));
      setAccountId('');
      onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const voidIt = async (id: string): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await voidLoanPayment(id);
      setVoiding(null);
      onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be voided.');
      setVoiding(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <button
        type="button"
        className="btn btn-quiet"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {paymentsState === 'read' ? `Payments · ${String(counted)}` : 'Payments'}
      </button>
      {open && (
        <div id={panelId} className="mt-2 flex flex-col gap-3">
          {paymentsState === 'reading' ? (
            <p className="note">Reading the payments on this loan…</p>
          ) : paymentsState === 'failed' ? (
            <p className="note">The payments on this loan could not be read just now, so none is listed and none can be recorded.</p>
          ) : mine.length === 0 ? (
            <p className="note">No payment recorded on this loan yet.</p>
          ) : (
            <ul className="row-separated">
              {mine.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums" style={payment.isVoided ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>
                      {formatShortDate(payment.date)} · {formatMoney(payment.amount, { privacy })}
                    </span>
                    <span className="note">{accountLabelFor(payment, accounts)}</span>
                    {payment.isVoided && <Pill tone="due">voided</Pill>}
                  </span>
                  {editable && !payment.isVoided && (
                    <span className="flex items-center gap-2">
                      {voiding === payment.id ? (
                        <>
                          <span className="note">Void this payment?</span>
                          <Button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              void voidIt(payment.id);
                            }}
                          >
                            Yes, void it
                          </Button>
                          <Button
                            type="button"
                            variant="quiet"
                            onClick={() => {
                              setVoiding(null);
                            }}
                          >
                            Keep it
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="quiet"
                          aria-label={`Void the payment of ${formatShortDate(payment.date)}`}
                          onClick={() => {
                            setVoiding(payment.id);
                          }}
                        >
                          Void
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {editable && paymentsState === 'read' && privacy && <p className="note">Amounts are hidden, so a payment cannot be typed. Show them to record one.</p>}
          {editable && paymentsState === 'read' && !privacy && (
            <form
              aria-label={`Record a payment on ${liability.name}`}
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                void record(event);
              }}
            >
              <div className="w-full sm:w-[150px] sm:shrink-0">
                <Field
                  label="Amount paid"
                  numeric
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                  hint="All of it, principal and interest."
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                  }}
                />
              </div>
              <div className="w-full sm:w-[170px] sm:shrink-0">
                <Field
                  label="Paid on"
                  type="date"
                  required
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />
              </div>
              <PaidFromField
                label="Paid from"
                verb="left"
                hint="Optional. It lets a month close count this as paid to loans, not as spent."
                choices={choices}
                entryCurrency={liability.currency}
                accountId={accountId}
                typed=""
                failed={accountsFailed}
                onAccount={setAccountId}
                onTyped={() => undefined}
              />
              <Button type="submit" disabled={busy || amount.trim() === ''}>
                Record payment
              </Button>
            </form>
          )}
          {problem !== null && <Problem>{problem}</Problem>}
        </div>
      )}
    </div>
  );
}
