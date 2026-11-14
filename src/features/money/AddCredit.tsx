/**
 * Add money in: a stepped form (docs/design/ledger-income.md section 2; the AddCredit and AddCredit2 boards).
 *
 * Step 1 is what came in: the amount, what it is (one of the seven kinds), the account it went into, which is optional, and the date it was
 * credited. Step 2 is whose income it is and who can see the row, and who it came from. Going back keeps every value, and nothing is
 * written until the last step's button (SL-I6). The account picker ends with "+ Add an account", which opens AddAccount over this form and
 * returns to it with the new account chosen and every value kept (LI-I25).
 *
 * Not here yet, and said in the conformance ledger: the eighth chip *From my own account* (a move, an `account_transfer`) and *Repeats
 * every month* (the rule form, section 5).
 */

import { useMemo, useState } from 'react';
import { CREDIT_CATEGORIES, CREDIT_LABEL, type CreditCategory } from '../../domain/credit.ts';
import { money } from '../../lib/money.ts';
import { addCredit } from '../../repo/credits.ts';
import { todayInIst } from '../../repo/expenses.ts';
import type { AccountPatch, NewAccount, Visibility } from '../../repo/types.ts';
import { Select } from '../../ui/Select.tsx';
import { Field, RequiredKey, RequiredMark } from '../../ui/primitives.tsx';
import { Stepper } from '../../ui/Stepper.tsx';
import { AddAccount } from './AddAccount.tsx';
import { accountChoices, creditAmount, creditDateProblem, creditMember, creditVisibility, sharedAccountNote } from './creditForm.ts';
import type { AccountsData } from './useAccounts.ts';

/** The picker's last row is not an account: choosing it opens AddAccount. */
const ADD_ACCOUNT = '__add_account__';
const NO_ACCOUNT = '';

export interface AddedCredit {
  readonly id: string;
  readonly category: CreditCategory;
  readonly minor: bigint;
  readonly currency: string;
  readonly date: string;
}

export function AddCredit({
  data,
  onAddAccount,
  onChangeAccount,
  onSaved,
  onCancel,
}: {
  data: AccountsData;
  onAddAccount: (input: NewAccount) => Promise<{ readonly id: string }>;
  onChangeAccount: (id: string, patch: AccountPatch) => Promise<void>;
  onSaved: (added: AddedCredit) => void;
  onCancel: () => void;
}) {
  const { viewer } = data;
  const today = useMemo(() => todayInIst(), []);
  const choices = useMemo(() => accountChoices(data.accounts), [data.accounts]);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<CreditCategory>('salary');
  const [accountId, setAccountId] = useState(NO_ACCOUNT);
  const [date, setDate] = useState(today);
  // Whose income: null until the person picks, so it follows the account chosen (the account's member).
  const [memberChoice, setMemberChoice] = useState<string | null>(null);
  const [visibilityChoice, setVisibilityChoice] = useState<Visibility | null>(null);
  const [payer, setPayer] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The amount says it is blank, and the date that it is wrong, only once the person has left the amount or tried to go on.
  const [amountLeft, setAmountLeft] = useState(false);

  const account = data.accounts.find((each) => each.id === accountId) ?? null;
  const currency = account?.currency ?? data.household.baseCurrency ?? 'INR';
  const symbol = currency === 'INR' ? '₹' : currency;

  const selectableMembers = useMemo(
    () => (viewer.canFileForOthers ? data.members.filter((member) => !member.isArchived) : data.members.filter((member) => member.id === viewer.memberId)),
    [data.members, viewer.canFileForOthers, viewer.memberId],
  );
  const memberId = memberChoice ?? creditMember(account, viewer, selectableMembers.map((member) => member.id));
  const mine = memberId === viewer.memberId;
  const visibility = creditVisibility({ category, chosen: visibilityChoice, mine });
  const sharedNote = sharedAccountNote(account, visibility);

  const reading = creditAmount(amount, currency);
  const dateError = creditDateProblem(date);
  const step1Ready = reading.ok && dateError === null;
  const amountError = reading.ok ? null : reading.blank && !amountLeft ? null : reading.problem;

  const save = async (): Promise<void> => {
    if (!reading.ok || dateError !== null) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await addCredit({
        householdId: data.household.id,
        memberId,
        accountId: account === null ? null : account.id,
        category,
        amount: money(reading.minor, currency),
        date,
        visibility,
        payer: payer.trim() === '' ? null : payer.trim(),
      });
      onSaved({ id: made.id, category, minor: reading.minor, currency, date });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stepper
        title="Add money in"
        finishLabel="Add credit"
        busyLabel="Adding…"
        busy={busy}
        problem={problem}
        onCancel={onCancel}
        onFinish={save}
        steps={[
          {
            name: 'What came in',
            ready: step1Ready,
            content: (
              <>
                <RequiredKey />
                <Field
                  label={`Amount (${currency})`}
                  needed
                  numeric
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  placeholder={symbol === '₹' ? '1,42,000' : '0.00'}
                  {...(account === null || currency === 'INR' ? {} : { hint: 'The currency of the account.' })}
                  error={amountError}
                  onChange={(event) => {
                    setAmount(event.target.value);
                  }}
                  onBlur={() => {
                    setAmountLeft(true);
                  }}
                />

                <div className="flex flex-col gap-1.5">
                  <span className="label" id="credit-kind-label">
                    What it is
                    <RequiredMark />
                  </span>
                  <div className="qa-chips" role="group" aria-labelledby="credit-kind-label">
                    {CREDIT_CATEGORIES.map((each) => (
                      <button
                        key={each}
                        type="button"
                        className="qa-chip"
                        aria-pressed={category === each}
                        onClick={() => {
                          setCategory(each);
                        }}
                      >
                        {CREDIT_LABEL[each]}
                      </button>
                    ))}
                  </div>
                  {category === 'business' && (
                    <span className="field-help">Money you take from the business into your accounts; the business&rsquo;s own accounts are not added here.</span>
                  )}
                  <span className="field-help">
                    Salary, business income, interest, rent, dividends and other income count as came in. A refund takes away from spent.
                  </span>
                </div>

                <Select
                  label="Into which account"
                  value={accountId}
                  hint="Optional. Needed only to close months from balances."
                  onChange={(event) => {
                    if (event.target.value === ADD_ACCOUNT) setAddingAccount(true);
                    else {
                      setAccountId(event.target.value);
                      setMemberChoice(null);
                    }
                  }}
                >
                  <option value={NO_ACCOUNT}>No account</option>
                  {choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                  <option value={ADD_ACCOUNT}>+ Add an account</option>
                </Select>

                <Field
                  label="Date it was credited"
                  needed
                  type="date"
                  value={date}
                  error={amountLeft ? dateError : null}
                  onChange={(event) => {
                    setDate(event.target.value);
                  }}
                />

                <p className="note">Cash you receive, such as rent paid in cash, can be entered with no account.</p>
              </>
            ),
          },
          {
            name: 'Whose, and who sees it',
            ready: true,
            content: (
              <>
                <RequiredKey />
                <Select
                  label="Whose income"
                  required
                  value={memberId}
                  disabled={selectableMembers.length < 2}
                  onChange={(event) => {
                    setMemberChoice(event.target.value);
                  }}
                >
                  {selectableMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </Select>

                <div className="flex flex-col gap-1.5">
                  <span className="label" id="credit-visibility-label">
                    Who can see this row
                  </span>
                  <div className="segmented self-start" role="group" aria-labelledby="credit-visibility-label">
                    <button
                      type="button"
                      aria-pressed={visibility === 'personal'}
                      disabled={!mine}
                      onClick={() => {
                        setVisibilityChoice('personal');
                      }}
                    >
                      Only me
                    </button>
                    <button
                      type="button"
                      aria-pressed={visibility === 'household'}
                      onClick={() => {
                        setVisibilityChoice('household');
                      }}
                    >
                      The household
                    </button>
                  </div>
                  <span className="field-help">
                    {mine
                      ? 'Income starts private. The household’s Came in still counts it, as a total, without the row.'
                      : 'Only the member whose income it is can make it private, so somebody else’s is the household’s.'}
                  </span>
                </div>

                {sharedNote !== null && <p className="note">{sharedNote}</p>}

                <Field
                  label="From"
                  placeholder="optional"
                  value={payer}
                  maxLength={120}
                  hint="Optional. The payer, as the bank shows it."
                  autoComplete="off"
                  onChange={(event) => {
                    setPayer(event.target.value);
                  }}
                />
              </>
            ),
          },
        ]}
      />

      {addingAccount && (
        <AddAccount
          data={data}
          editing={null}
          locked={false}
          onAdd={onAddAccount}
          onChange={onChangeAccount}
          onSaved={(id) => {
            // Back to this form, with the new account chosen and every value kept.
            setAccountId(id);
            setMemberChoice(null);
            setAddingAccount(false);
          }}
          onCancel={() => {
            setAddingAccount(false);
          }}
        />
      )}
    </>
  );
}
