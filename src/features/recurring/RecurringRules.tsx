/**
 * What recurs, on Settings under "This household" (docs/blueprint.md section 17; docs/design/spending-capture.md section 3).
 *
 * A rule is a category, a member, an amount, how often and on which day. Once a day has come, the entry is made when an owner or a
 * partner next opens the app, once per due date (SC-I10); the rows it makes say so. An owner or a partner adds, changes, pauses and
 * archives a rule. A contributor sees the rules under their own name and changes none. A paused rule makes nothing; an archived rule is
 * kept, with what it made, and is never deleted.
 *
 * There is no board for this section: it is built from the Settings rows beside it, and the canvas leaves a `proposed` row for it
 * (docs/design/conformance.md).
 */

import { useMemo, useState } from 'react';
import { minorToMajorText } from '../../domain/export/cells.ts';
import { perYear, resumeFrom } from '../../domain/recurring.ts';
import { formatIsoDate, isIsoDate, istCalendarDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney, minorUnitExponent, money, parseAmountToMinor } from '../../lib/money.ts';
import {
  PAYMENT_METHODS,
  RECURRING_CADENCES,
  type ExpenseListing,
  type PaymentMethod,
  type RecurringCadence,
  type RecurringRule,
  type RecurringRulePatch,
  type NewRecurringRule,
} from '../../repo/types.ts';
import { Button, Field, Pill, Problem } from '../../ui/primitives.tsx';
import { useRules } from './useRules.ts';

export const CADENCE_LABELS: Record<RecurringCadence, string> = {
  monthly: 'Every month',
  quarterly: 'Every three months',
  half_yearly: 'Every six months',
  yearly: 'Every year',
};

const CADENCE_WORDS: Record<RecurringCadence, string> = {
  monthly: 'a month',
  quarterly: 'a quarter',
  half_yearly: 'half a year',
  yearly: 'a year',
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  netbanking: 'Net banking',
  auto_debit: 'Auto-debit',
  other: 'Other',
};

function isCadence(value: string): value is RecurringCadence {
  return (RECURRING_CADENCES as readonly string[]).includes(value);
}

function isMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function RecurringRules({
  householdId,
  privacy,
  recurringMade = 0,
}: {
  householdId: string | null;
  privacy: boolean;
  /** How many entries the poster has made since the app opened; when it grows the rules are read again. */
  recurringMade?: number;
}) {
  const data = useRules(householdId, recurringMade);
  const { rules, listing, failed } = data;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [rest, setRest] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const today = istCalendarDate(new Date());
  const role = listing?.viewer.role ?? null;
  // An owner or a partner changes rules; the database agrees. A viewer reads none, so the section is not offered to one.
  const canWrite = role === 'owner' || role === 'partner';
  const categoryName = useMemo(() => new Map((listing?.categories ?? []).map((category) => [category.id, category.name])), [listing]);
  const memberName = useMemo(() => new Map((listing?.members ?? []).map((member) => [member.id, member.displayName])), [listing]);

  if (householdId === null || role === 'viewer') return null;

  const live = (rules ?? []).filter((rule) => rule.status !== 'archived');
  const archived = (rules ?? []).filter((rule) => rule.status === 'archived');

  /** Back to active without the period it was stopped for: nothing that fell due while it was off is entered. */
  const resumed = (rule: RecurringRule): RecurringRulePatch => {
    const next = resumeFrom(rule.nextDue, rule.dueDay, today);
    return next === rule.nextDue ? { status: 'active' } : { status: 'active', nextDue: next };
  };

  const change = async (id: string, patch: RecurringRulePatch) => {
    setProblem(null);
    try {
      await data.update(id, patch);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not change that.');
    }
  };

  return (
    <section aria-label="Recurring">
      <div className="grouphead">
        <h2>Recurring</h2>
        {canWrite && listing !== null && (
          <button
            type="button"
            className="invite-button"
            aria-expanded={adding}
            onClick={() => {
              setAdding((was) => !was);
              setEditing(null);
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span>Add</span>
          </button>
        )}
      </div>

      {failed && <Problem>The recurring entries could not be read just now.</Problem>}

      {adding && listing !== null && (
        <RuleForm
          listing={listing}
          today={today}
          onCancel={() => {
            setAdding(false);
          }}
          onSave={async (input) => {
            await data.add(input);
            setAdding(false);
          }}
        />
      )}

      {rules === null && !failed && <p className="note">Loading…</p>}

      {rules !== null && (
      <div className="setgrp">
        {live.length === 0 && (
          <div className="setrow">
            <span className="setrow-text">
              <span className="sk">Nothing recurs yet</span>
              <span className="sd">
                {canWrite ? 'Add the electricity bill, the school fee or a premium, and it is entered when it falls due.' : 'An owner or a partner adds them.'}
              </span>
            </span>
          </div>
        )}
        {live.length > 0 && (
          <ul>
            {live.map((rule) => (
              <li key={rule.id} className="relative">
                {editing === rule.id && listing !== null ? (
                  <RuleForm
                    listing={listing}
                    today={today}
                    rule={rule}
                    onCancel={() => {
                      setEditing(null);
                    }}
                    onSave={async (input) => {
                      // Moving the day earlier than the next one could enter a period that was already entered.
                      if (input.firstDue < rule.nextDue) {
                        throw new Error(`It next falls due ${formatIsoDate(rule.nextDue)}, and a rule can be moved later and not earlier: what was entered stays. To start over, archive it and add it again.`);
                      }
                      await data.update(rule.id, {
                        name: input.name,
                        categoryId: input.categoryId,
                        memberId: input.memberId,
                        amount: input.amount,
                        cadence: input.cadence,
                        // The day it next falls due moves only when it was changed, so editing an amount never skips a due day.
                        ...(input.firstDue === rule.nextDue ? {} : { nextDue: input.firstDue }),
                        payee: input.payee ?? null,
                        method: input.method ?? null,
                      });
                      setEditing(null);
                    }}
                  />
                ) : (
                  <RuleRow
                    rule={rule}
                    today={today}
                    category={categoryName.get(rule.categoryId) ?? 'A category that is no longer listed'}
                    member={memberName.get(rule.memberId) ?? 'A member'}
                    privacy={privacy}
                    canWrite={canWrite}
                    onEdit={() => {
                      setEditing(rule.id);
                      setAdding(false);
                    }}
                    onPause={() => {
                      void change(rule.id, rule.status === 'active' ? { status: 'paused' } : resumed(rule));
                    }}
                    onArchive={() => {
                      void change(rule.id, { status: 'archived' });
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {rules !== null && <p className="note mt-2">Entered when an owner or a partner opens the app, on the day each falls due.</p>}

      {problem !== null && <Problem>{problem}</Problem>}

      {archived.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            className="invite-button"
            aria-expanded={rest}
            onClick={() => {
              setRest((was) => !was);
            }}
          >
            {rest ? 'Hide archived' : `Archived (${String(archived.length)})`}
          </button>
          {rest && (
            <ul className="setgrp mt-2">
              {archived.map((rule) => (
                <li key={rule.id} className="setrow">
                  <span className="setrow-text">
                    <span className="sk">{rule.name}</span>
                    <span className="sd">
                      {formatMoney(rule.amount, { privacy })} {CADENCE_WORDS[rule.cadence]} · kept, with what it entered
                    </span>
                  </span>
                  {canWrite && (
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => {
                        void change(rule.id, resumed(rule));
                      }}
                    >
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function RuleRow({
  rule,
  today,
  category,
  member,
  privacy,
  canWrite,
  onEdit,
  onPause,
  onArchive,
}: {
  rule: RecurringRule;
  today: IsoDate;
  category: string;
  member: string;
  privacy: boolean;
  canWrite: boolean;
  onEdit: () => void;
  onPause: () => void;
  onArchive: () => void;
}) {
  const paused = rule.status === 'paused';
  return (
    <div className="setrow" aria-label={rule.name}>
      <span className="setrow-text">
        <span className="sk">{rule.name}</span>
        <span className="sd">
          {formatMoney(rule.amount, { privacy })} {CADENCE_WORDS[rule.cadence]} · {category} · {member}
        </span>
        <span className="sd">
          {paused
            ? 'Paused: nothing is entered'
            : rule.nextDue <= today
              ? `Fell due ${formatIsoDate(rule.nextDue)}: entered when an owner or a partner opens the app`
              : `Next ${formatIsoDate(rule.nextDue)}`}
          {' · '}
          {formatMoney(money(perYear(rule.amount.minor, rule.cadence), rule.amount.currency), { privacy })} a year
        </span>
      </span>
      {paused && <Pill tone="warn">Paused</Pill>}
      {canWrite && (
        <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button type="button" variant="quiet" onClick={onEdit} aria-label={`Change ${rule.name}`}>
            Change
          </Button>
          <Button type="button" variant="quiet" onClick={onPause} aria-label={`${paused ? 'Resume' : 'Pause'} ${rule.name}`}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button type="button" variant="quiet" onClick={onArchive} aria-label={`Archive ${rule.name}`}>
            Archive
          </Button>
        </span>
      )}
    </div>
  );
}

function RuleForm({
  listing,
  today,
  rule,
  onSave,
  onCancel,
}: {
  listing: ExpenseListing;
  today: IsoDate;
  /** The rule being changed, or none for a new one. */
  rule?: RecurringRule;
  onSave: (input: NewRecurringRule) => Promise<void>;
  onCancel: () => void;
}) {
  const categories = listing.categories.filter((category) => !category.isArchived || category.id === rule?.categoryId);
  const members = listing.members.filter((member) => !member.isArchived || member.id === rule?.memberId);
  const currency = rule?.amount.currency ?? listing.household.baseCurrency;

  const [name, setName] = useState(rule?.name ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? categories[0]?.id ?? '');
  const [memberId, setMemberId] = useState(rule?.memberId ?? listing.viewer.memberId);
  const [amount, setAmount] = useState(rule === undefined ? '' : minorToMajorText(rule.amount.minor, minorUnitExponent(rule.amount.currency)));
  const [cadence, setCadence] = useState<RecurringCadence>(rule?.cadence ?? 'monthly');
  const [first, setFirst] = useState<string>(rule?.nextDue ?? today);
  const [payee, setPayee] = useState(rule?.payee ?? '');
  const [method, setMethod] = useState<PaymentMethod | ''>(rule?.method ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      if (name.trim() === '') throw new Error('Name what recurs: the electricity bill, the school fee.');
      if (categoryId === '') throw new Error('A rule files its entries under a category: add one on Expenses first.');
      if (amount.trim() === '') throw new Error('The amount is needed.');
      const minor = parseAmountToMinor(amount, currency);
      if (minor <= 0n) throw new Error('An amount is above nothing.');
      if (!isIsoDate(first) || Number(first.slice(0, 4)) < 2000) throw new Error('The day it first falls due is not a date this can be: check the year.');
      const day = Number(first.slice(8, 10));
      if (day > 28) throw new Error('A rule falls due on a day from 1 to 28, so that the day exists in every month. Choose a day within them.');

      setBusy(true);
      await onSave({
        householdId: listing.household.id,
        name: name.trim(),
        categoryId,
        memberId,
        amount: money(minor, currency),
        cadence,
        firstDue: first,
        payee: payee.trim() === '' ? null : payee.trim(),
        method: method === '' ? null : method,
      });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  const label = rule === undefined ? 'Add a recurring entry' : `Change ${rule.name}`;
  return (
    <form
      className="inset-form flex flex-col gap-3 m-3"
      aria-label={label}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-[220px] sm:shrink-0">
          <Field
            label="What recurs"
            value={name}
            required
            hint="For example: Electricity."
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
        <div className="w-full sm:w-[140px] sm:shrink-0">
          <Field
            label={`Amount (${currency})`}
            numeric
            inputMode="decimal"
            value={amount}
            required
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </div>
        <label className="flex w-full flex-col gap-1.5 sm:w-[190px] sm:shrink-0">
          <span className="label">Repeats</span>
          <select
            className="field"
            value={cadence}
            onChange={(event) => {
              if (isCadence(event.target.value)) setCadence(event.target.value);
            }}
          >
            {RECURRING_CADENCES.map((option) => (
              <option key={option} value={option}>
                {CADENCE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <div className="w-full sm:w-[160px] sm:shrink-0">
          <Field
            label={rule === undefined ? 'First falls due' : 'Next falls due'}
            type="date"
            required
            hint="Its day is the day each time."
            value={first}
            onChange={(event) => {
              setFirst(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-full flex-col gap-1.5 sm:w-[190px] sm:shrink-0">
          <span className="label">Category</span>
          <select
            className="field"
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
            }}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-full flex-col gap-1.5 sm:w-[150px] sm:shrink-0">
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
        <div className="w-full sm:w-[200px] sm:shrink-0">
          <Field
            label="Payee (optional)"
            value={payee}
            hint="Left blank, the name is used."
            onChange={(event) => {
              setPayee(event.target.value);
            }}
          />
        </div>
        <label className="flex w-full flex-col gap-1.5 sm:w-[150px] sm:shrink-0">
          <span className="label">Paid by (optional)</span>
          <select
            className="field"
            value={method}
            onChange={(event) => {
              setMethod(event.target.value === '' ? '' : isMethod(event.target.value) ? event.target.value : '');
            }}
          >
            <option value="">Not said</option>
            {PAYMENT_METHODS.map((option) => (
              <option key={option} value={option}>
                {METHOD_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="note">
        {rule === undefined
          ? `Entered from ${isIsoDate(first) ? formatIsoDate(first) : 'the day above'}, each time it falls due, when an owner or a partner opens the app. A day that has already gone by is entered at once.`
          : 'Changing the amount or the day applies from the next entry; what was entered stays as it was.'}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : rule === undefined ? 'Add' : 'Save'}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {problem !== null && <Problem>{problem}</Problem>}
    </form>
  );
}
