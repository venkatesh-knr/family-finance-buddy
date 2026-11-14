/**
 * The salary rule: make one, and change one (docs/design/ledger-income.md section 5; the SalaryRule board).
 *
 * One short form. A rule reminds and never posts (LI-I8): on payday a credit waits in the Expected panel and counts nowhere until it is
 * confirmed. It is made from *Repeats every month* on Add money in, which opens it with what the credit had, and changed from its row in
 * the Expected panel, where it can also be paused or archived (never deleted). A rule names no account if the household has added none; one
 * that does names an account in its own currency, because the credit a confirmation writes is in the account's.
 *
 * Not here yet, said in the conformance ledger: the list of the rule's own due dates (*Its credits*), and a rule that is not due.
 */

import { useMemo, useState } from 'react';
import { CREDIT_LABEL } from '../../domain/credit.ts';
import { todayInIst } from '../../repo/expenses.ts';
import { addIncomeRule, updateIncomeRule } from '../../repo/incomeRules.ts';
import { money } from '../../lib/money.ts';
import type { IncomeRule } from '../../repo/types.ts';
import { Select } from '../../ui/Select.tsx';
import { Button, Field, RequiredKey } from '../../ui/primitives.tsx';
import { Stepper } from '../../ui/Stepper.tsx';
import { accountChoices, amountText, creditAmount } from './creditForm.ts';
import { firstDueAfter, ordinalDay, PAYDAYS, type RuleDraft } from './ruleForm.ts';
import type { AccountsData } from './useAccounts.ts';

const NO_ACCOUNT = '';

export function SalaryRuleForm({
  data,
  draft,
  editing,
  onSaved,
  onCancel,
}: {
  data: AccountsData;
  /** What a new rule opens with: the credit it repeats. */
  draft?: RuleDraft;
  /** The rule being changed, or absent for a new one. */
  editing?: IncomeRule;
  onSaved: (outcome: 'made' | 'changed' | 'paused' | 'resumed' | 'archived') => void;
  onCancel: () => void;
}) {
  const { viewer } = data;
  const isEdit = editing !== undefined;
  const base = editing ?? null;
  const currency = base?.amount.currency ?? draft?.amount.currency ?? data.household.baseCurrency ?? 'INR';

  const [name, setName] = useState(base?.name ?? draft?.name ?? '');
  const [amount, setAmount] = useState(base !== null ? amountText(base.amount.minor, currency) : draft !== undefined ? amountText(draft.amount.minor, currency) : '');
  const [payday, setPayday] = useState(base !== null ? String(base.dueDay) : (draft?.payday ?? '1'));
  const [accountId, setAccountId] = useState(base?.accountId ?? draft?.accountId ?? NO_ACCOUNT);
  const [memberId, setMemberId] = useState(base?.memberId ?? draft?.memberId ?? viewer.memberId);
  const [visibility, setVisibility] = useState(base?.visibility ?? draft?.visibility ?? 'personal');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  // An account in the rule's currency only: the credit a confirmation writes is in the account's, and the database refuses another.
  const choices = useMemo(
    () => accountChoices(data.accounts.filter((each) => each.currency === currency), base?.accountId ?? null),
    [data.accounts, currency, base?.accountId],
  );
  const members = useMemo(
    () =>
      viewer.canFileForOthers
        ? data.members.filter((member) => !member.isArchived || member.id === base?.memberId)
        : data.members.filter((member) => member.id === viewer.memberId),
    [data.members, viewer.canFileForOthers, viewer.memberId, base?.memberId],
  );
  const mine = memberId === viewer.memberId;
  const effectiveVisibility = mine ? visibility : 'household';

  const nameError = name.trim() === '' ? 'Give the rule a name, such as Salary.' : name.trim().length > 80 ? 'A name is up to 80 characters.' : null;
  const reading = creditAmount(amount, currency);
  const amountError = reading.ok ? null : reading.problem;
  const ready = nameError === null && reading.ok;

  const finish = async (): Promise<void> => {
    setTried(true);
    if (!ready || !reading.ok) return;
    setBusy(true);
    setProblem(null);
    try {
      const day = Number(payday.trim());
      const stored = accountId === NO_ACCOUNT ? null : accountId;
      if (editing === undefined) {
        await addIncomeRule({
          householdId: data.household.id,
          name: name.trim(),
          memberId,
          accountId: stored,
          category: draft?.category ?? 'salary',
          amount: money(reading.minor, currency),
          cadence: 'monthly',
          // The first payday after the credit it repeats: a credit of last month makes a rule that is expected at once.
          firstDue: firstDueAfter(draft?.creditDate ?? todayInIst(), day),
          visibility: effectiveVisibility,
        });
        onSaved('made');
      } else {
        await updateIncomeRule(editing.id, {
          name: name.trim(),
          accountId: stored,
          amount: money(reading.minor, currency),
          ...(effectiveVisibility === editing.visibility ? {} : { visibility: effectiveVisibility }),
          // A new payday moves the rule's next due day with it, in the month it was already due in.
          ...(day === editing.dueDay ? {} : { nextDue: `${editing.nextDue.slice(0, 8)}${String(day).padStart(2, '0')}` }),
        });
        onSaved('changed');
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: 'active' | 'paused' | 'archived'): Promise<void> => {
    if (editing === undefined) return;
    setBusy(true);
    setProblem(null);
    try {
      await updateIncomeRule(editing.id, { status });
      onSaved(status === 'paused' ? 'paused' : status === 'archived' ? 'archived' : 'resumed');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const kind = CREDIT_LABEL[base?.category ?? draft?.category ?? 'salary'];

  return (
    <Stepper
      title={isEdit ? 'Change a rule' : 'Salary rule'}
      finishLabel="Save rule"
      busyLabel="Saving…"
      busy={busy}
      problem={problem}
      onCancel={onCancel}
      onFinish={finish}
      steps={[
        {
          name: isEdit ? 'Change a rule' : 'Salary rule',
          ready,
          content: (
            <>
              <RequiredKey />
              <Field
                label="Name"
                needed
                value={name}
                maxLength={80}
                hint={`What this money is called. It is ${kind.toLowerCase()}.`}
                error={tried ? nameError : null}
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />

              <Select
                label="Whose"
                required
                value={memberId}
                disabled={isEdit || members.length < 2}
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

              <Select
                label="Paid into"
                value={accountId}
                hint="Optional. The account it arrives in, in the same currency."
                onChange={(event) => {
                  setAccountId(event.target.value);
                }}
              >
                <option value={NO_ACCOUNT}>No account</option>
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </Select>

              <Field
                label={`Usual amount (${currency})`}
                needed
                numeric
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                hint="Filled in on payday. You confirm what actually came in."
                error={tried ? amountError : null}
                onChange={(event) => {
                  setAmount(event.target.value);
                }}
              />

              <Select
                label="Payday"
                required
                value={payday}
                hint="Days 1 to 28. Paid on the last working day? Pick the 28th and confirm when it lands."
                onChange={(event) => {
                  setPayday(event.target.value);
                }}
              >
                {PAYDAYS.map((day) => (
                  <option key={day} value={String(day)}>
                    {ordinalDay(day)}
                  </option>
                ))}
              </Select>

              <div className="flex flex-col gap-1.5">
                <span className="label" id="rule-visibility-label">
                  Who can see its credits
                </span>
                <div className="segmented self-start" role="group" aria-labelledby="rule-visibility-label">
                  <button
                    type="button"
                    aria-pressed={effectiveVisibility === 'personal'}
                    disabled={!mine}
                    onClick={() => {
                      setVisibility('personal');
                    }}
                  >
                    Only me
                  </button>
                  <button
                    type="button"
                    aria-pressed={effectiveVisibility === 'household'}
                    onClick={() => {
                      setVisibility('household');
                    }}
                  >
                    The household
                  </button>
                </div>
              </div>

              <p className="note">
                On payday a credit waits in Money as <strong>Expected</strong>. It counts nowhere, not in Came in and not in FIRE, until you confirm it.
                Confirm it, change the amount, or mark it not this month.
              </p>

              {isEdit && editing !== undefined && (
                <div className="flex flex-wrap items-center gap-3">
                  {editing.status === 'active' ? (
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void setStatus('paused');
                      }}
                    >
                      Pause rule
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void setStatus('active');
                      }}
                    >
                      Resume rule
                    </Button>
                  )}
                  {!confirmingArchive && (
                    <button
                      type="button"
                      className="note underline"
                      disabled={busy}
                      onClick={() => {
                        setConfirmingArchive(true);
                      }}
                    >
                      Archive rule
                    </button>
                  )}
                </div>
              )}
              {isEdit && confirmingArchive && (
                <div className="flex flex-col gap-1.5">
                  <p className="note">Archive this rule? It is kept, with its history, and is not used again.</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void setStatus('archived');
                      }}
                    >
                      Yes, archive it
                    </Button>
                    <button
                      type="button"
                      className="note underline"
                      disabled={busy}
                      onClick={() => {
                        setConfirmingArchive(false);
                      }}
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              )}
              {isEdit && <p className="note">A paused rule expects nothing. An archived one is kept, with its history, and is not used again.</p>}
            </>
          ),
        },
      ]}
    />
  );
}
