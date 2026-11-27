/**
 * Add an account, and change one (docs/design/ledger-income.md section 1a; the AddAccount board).
 *
 * One short form and not a stepped one, because only three of its seven fields are needed: a name, a type and whose it is. It is opened
 * from the Accounts screen, and from "+ Add an account" at the end of an account picker, which returns to the form it came from with the
 * new account chosen and every value kept (`onSaved` is given the new account's id).
 *
 * Changing an account keeps its name, bank and last four digits open. Its type and currency are fixed once it has a credit,
 * a transfer or a balance, because they decide how its past months were worked out: archive it and add a new one. It is archived and
 * never deleted, and an archived one can be restored. A contributor makes and changes only their own accounts, and the form offers them
 * only their own name, as the policies would refuse anything else.
 */

import { useMemo, useState } from 'react';
import type { Account, AccountPatch, AccountType, NewAccount } from '../../repo/types.ts';
import { Select } from '../../ui/Select.tsx';
import { Field, Problem, RequiredKey, RequiredMark } from '../../ui/primitives.tsx';
import { Stepper } from '../../ui/Stepper.tsx';
import { TYPE_WORD } from './accountRows.ts';
import { cycleSwitchSentence, firstStatementMonth } from './cardCycleStart.ts';
import type { AccountsData } from './useAccounts.ts';

const TYPES: readonly AccountType[] = ['savings', 'current', 'card'];
const CURRENCIES = ['INR', 'USD'] as const;

/** What is wrong with the last four digits, in words, or null. Four letters or digits, or none. */
export function last4Problem(value: string): string | null {
  const text = value.trim();
  if (text === '') return null;
  return /^[0-9A-Za-z]{4}$/.test(text) ? null : 'Four letters or digits, the last four of the account, and nothing more.';
}

export function AddAccount({
  data,
  editing,
  locked,
  onSaved,
  onCancel,
  onAdd,
  onChange,
}: {
  data: AccountsData;
  /** The account being changed, or null to add one. */
  editing: Account | null;
  /** Its type and currency are fixed: it has a credit, a transfer or a balance. */
  locked: boolean;
  onSaved: (id: string) => void;
  onCancel: () => void;
  onAdd: (input: NewAccount) => Promise<{ readonly id: string }>;
  onChange: (id: string, patch: AccountPatch) => Promise<void>;
}) {
  const { viewer } = data;
  const selectableMembers = useMemo(
    () => (viewer.canFileForOthers ? data.members.filter((member) => !member.isArchived) : data.members.filter((member) => member.id === viewer.memberId)),
    [data.members, viewer.canFileForOthers, viewer.memberId],
  );

  const [name, setName] = useState(editing?.name ?? '');
  const [type, setType] = useState<AccountType>(editing?.type ?? 'savings');
  const [memberId, setMemberId] = useState(editing?.memberId ?? viewer.memberId);
  const [institution, setInstitution] = useState(editing?.institution ?? '');
  const [last4, setLast4] = useState(editing?.last4 ?? '');
  const [currency, setCurrency] = useState(editing?.currency ?? 'INR');
  // Asked, never inferred (Schedule FA): for an account in another currency the person says whether it is held abroad.
  const [foreign, setForeign] = useState<boolean | null>(editing === null ? null : editing.isForeign);
  // When a card's bill closes (card-cycles.md 8.1): at month end, as every card did, or on its statement date. Only a card has the choice.
  const [cycleEnds, setCycleEnds] = useState<'month_end' | 'statement'>(editing?.cycleEnds ?? 'month_end');
  const wasOnItsDate = editing?.cycleEnds === 'statement';
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const other = currency !== 'INR';

  const nameError = name.trim() === '' ? 'Give it a name, such as Salary account.' : name.trim().length > 80 ? 'A name is up to 80 characters.' : null;
  const last4Error = last4Problem(last4);
  const foreignMissing = other && foreign === null;
  const ready = nameError === null && last4Error === null && !foreignMissing;
  const isEdit = editing !== null;

  const save = async (): Promise<void> => {
    setTried(true);
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      if (editing === null) {
        const made = await onAdd({
          householdId: data.household.id,
          memberId,
          name: name.trim(),
          type,
          currency,
          institution: institution.trim() === '' ? null : institution.trim(),
          last4: last4.trim() === '' ? null : last4.trim(),
          isForeign: other ? foreign === true : false,
          ...(type === 'card' && cycleEnds === 'statement' ? { cycleEnds: 'statement' as const } : {}),
        });
        onSaved(made.id);
      } else {
        await onChange(editing.id, {
          name: name.trim(),
          institution: institution.trim() === '' ? null : institution.trim(),
          last4: last4.trim() === '' ? null : last4.trim(),
          // Open only while the account has no history: the form disables them after, and does not send them.
          ...(locked ? {} : { type, currency, isForeign: other ? foreign === true : false }),
          // It applies to every month, both ways; a card turned into anything else is back at month end, which is all a bank account may be.
          ...(type === 'card' ? (cycleEnds !== (editing.cycleEnds ?? 'month_end') ? { cycleEnds } : {}) : wasOnItsDate ? { cycleEnds: 'month_end' as const } : {}),
        });
        onSaved(editing.id);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const archive = async (archived: boolean): Promise<void> => {
    if (editing === null) return;
    setBusy(true);
    setProblem(null);
    try {
      await onChange(editing.id, { archived });
      onSaved(editing.id);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const title = isEdit ? 'Change an account' : 'Add an account';

  return (
    <Stepper
      title={title}
      finishLabel={isEdit ? 'Save changes' : 'Add account'}
      busyLabel={isEdit ? 'Saving…' : 'Adding…'}
      busy={busy}
      problem={problem}
      onCancel={onCancel}
      onFinish={save}
      steps={[
        {
          name: title,
          ready,
          content: (
            <>
              <RequiredKey />
              <Field
                label="Name"
                needed
                value={name}
                maxLength={80}
                hint="What you call it. Shown on every ledger line from this account."
                error={tried ? nameError : null}
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />

              <div className="flex flex-col gap-1.5">
                <span className="label" id="account-type-label">
                  Type
                  <RequiredMark />
                </span>
                <div className="qa-chips" role="group" aria-labelledby="account-type-label">
                  {TYPES.map((each) => (
                    <button
                      key={each}
                      type="button"
                      className="qa-chip"
                      aria-pressed={type === each}
                      disabled={locked && type !== each}
                      onClick={() => {
                        setType(each);
                      }}
                    >
                      {TYPE_WORD[each]}
                    </button>
                  ))}
                </div>
                <span className="field-help">
                  {locked ? 'Its type is fixed, because it has entries. Archive it and add a new one to change it.' : 'A card’s balance is what you owe on it.'}
                </span>
              </div>

              <Select
                label="Whose"
                required
                value={memberId}
                disabled={isEdit || selectableMembers.length < 2}
                onChange={(event) => {
                  setMemberId(event.target.value);
                }}
              >
                {selectableMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </Select>

              {type === 'card' && (
                <div className="flex flex-col gap-1.5">
                  <span className="label" id="account-cycle-label">
                    When does this card’s bill close?
                  </span>
                  <div className="qa-chips" role="group" aria-labelledby="account-cycle-label">
                    <button
                      type="button"
                      className="qa-chip"
                      aria-pressed={cycleEnds === 'month_end'}
                      onClick={() => {
                        setCycleEnds('month_end');
                      }}
                    >
                      At month end
                    </button>
                    <button
                      type="button"
                      className="qa-chip"
                      aria-pressed={cycleEnds === 'statement'}
                      onClick={() => {
                        setCycleEnds('statement');
                      }}
                    >
                      On its statement date
                    </button>
                  </div>
                  <span className="field-help">
                    Most cards make their bill mid-month, on the same day each month. Choose “On its statement date” and each month closes with that statement, once you import it.
                  </span>
                  {isEdit && cycleEnds !== (editing.cycleEnds ?? 'month_end') && (
                    <span className="field-help" data-testid="account-cycle-change">
                      {cycleSwitchSentence({ to: cycleEnds, firstMonth: firstStatementMonth(data.balances.filter((b) => b.accountId === editing.id).map((b) => b.asAt)) })}
                    </span>
                  )}
                </div>
              )}

              <Field
                label="Bank"
                placeholder="optional"
                value={institution}
                maxLength={80}
                autoComplete="off"
                onChange={(event) => {
                  setInstitution(event.target.value);
                }}
              />

              <Field
                label="Last four digits"
                placeholder="optional"
                value={last4}
                maxLength={4}
                hint="Optional. Never the full number: the app keeps four characters at most."
                error={last4Error}
                autoComplete="off"
                inputMode="text"
                onChange={(event) => {
                  setLast4(event.target.value);
                }}
              />

              <Select
                label="Currency"
                value={currency}
                disabled={locked}
                {...(locked ? { hint: 'Its currency is fixed, because it has entries.' } : {})}
                onChange={(event) => {
                  setCurrency(event.target.value);
                  if (event.target.value === 'INR') setForeign(false);
                  else if (editing === null) setForeign(null);
                }}
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>

              {other && (
                <div className="flex flex-col gap-1.5">
                  <span className="label" id="account-foreign-label">
                    Held outside India
                    <RequiredMark />
                  </span>
                  <div className="qa-chips" role="group" aria-labelledby="account-foreign-label">
                    <button
                      type="button"
                      className="qa-chip"
                      aria-pressed={foreign === true}
                      disabled={locked}
                      onClick={() => {
                        setForeign(true);
                      }}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className="qa-chip"
                      aria-pressed={foreign === false}
                      disabled={locked}
                      onClick={() => {
                        setForeign(false);
                      }}
                    >
                      No
                    </button>
                  </div>
                  <span className="field-help">An account in another currency is usually held abroad, and Schedule FA asks. You say which it is; it is not guessed.</span>
                  {tried && foreignMissing && <Problem>Say whether it is held outside India.</Problem>}
                </div>
              )}

              {isEdit && editing !== null && (
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={busy}
                    onClick={() => {
                      void archive(!editing.isArchived);
                    }}
                  >
                    {editing.isArchived ? 'Restore this account' : 'Archive this account'}
                  </button>
                  <span className="field-help">
                    {editing.isArchived
                      ? 'It comes back in the list and can be chosen for a new entry.'
                      : 'Its lines and balances keep their history. It leaves the list, and cannot be chosen for a new entry.'}
                  </span>
                </div>
              )}
            </>
          ),
        },
      ]}
    />
  );
}
