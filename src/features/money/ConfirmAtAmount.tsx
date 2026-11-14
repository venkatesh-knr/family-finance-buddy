/**
 * Change amount: confirm an expected credit at what actually came in (docs/design/ledger-income.md section 5).
 *
 * The credit is written for the rule's due date at the amount typed, and the rule moves on. *Use this amount from now on* also changes the
 * rule's usual amount. One short form; nothing is written until its button.
 */

import { useState } from 'react';
import { formatMoney, money } from '../../lib/money.ts';
import { formatShortDate } from '../../lib/dates.ts';
import { confirmExpectedCredit } from '../../repo/credits.ts';
import { updateIncomeRule } from '../../repo/incomeRules.ts';
import type { IncomeRule } from '../../repo/types.ts';
import { Field, RequiredKey } from '../../ui/primitives.tsx';
import { Stepper } from '../../ui/Stepper.tsx';
import { amountText, creditAmount, creditDateProblem } from './creditForm.ts';

export function ConfirmAtAmount({
  rule,
  dueDate,
  privacy,
  onDone,
  onCancel,
}: {
  rule: IncomeRule;
  dueDate: string;
  privacy: boolean;
  onDone: (said: string) => void;
  onCancel: () => void;
}) {
  const currency = rule.amount.currency;
  const [amount, setAmount] = useState(amountText(rule.amount.minor, currency));
  // The day the bank credited it: the due date to begin with, and not always the due date, so that a salary paid on the 31st is the old month's.
  const [date, setDate] = useState(dueDate);
  const [fromNowOn, setFromNowOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reading = creditAmount(amount, currency);
  const dateError = creditDateProblem(date);

  const finish = async (): Promise<void> => {
    if (!reading.ok || dateError !== null) return;
    setBusy(true);
    setProblem(null);
    try {
      const typed = money(reading.minor, currency);
      await confirmExpectedCredit({ rule, dueDate, amount: typed, date });
      if (fromNowOn && reading.minor !== rule.amount.minor) await updateIncomeRule(rule.id, { amount: typed });
      onDone(`Confirmed ${rule.name} at the amount that came in.`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stepper
      title="Change amount"
      finishLabel="Confirm"
      busyLabel="Confirming…"
      busy={busy}
      problem={problem}
      onCancel={onCancel}
      onFinish={finish}
      steps={[
        {
          name: `${rule.name}, due ${formatShortDate(dueDate)}`,
          ready: reading.ok && dateError === null,
          content: (
            <>
              <RequiredKey />
              <Field
                label={`Amount that came in (${currency})`}
                needed
                numeric
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                hint="The rule said the amount below; type what the bank credited."
                error={reading.ok || reading.blank ? null : reading.problem}
                onChange={(event) => {
                  setAmount(event.target.value);
                }}
              />
              <p className="note">The rule said {formatMoney(rule.amount, { privacy })}.</p>
              <Field
                label="Date it was credited"
                needed
                type="date"
                value={date}
                hint="The rule's due date was the one shown above; type the day it actually landed."
                error={dateError}
                onChange={(event) => {
                  setDate(event.target.value);
                }}
              />
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={fromNowOn}
                  onChange={(event) => {
                    setFromNowOn(event.target.checked);
                  }}
                />
                <span className="text-caption" style={{ color: 'var(--ink-2)' }}>
                  <strong>Use this amount from now on</strong>: the rule's usual amount changes to it.
                </span>
              </label>
            </>
          ),
        },
      ]}
    />
  );
}
