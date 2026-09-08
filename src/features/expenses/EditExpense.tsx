/**
 * Correcting one entry.
 *
 * One editor above the ledger rather than an inline form in each row. The list
 * is rendered twice — stacked on a phone, a table on a wide screen — and an
 * inline editor would be two implementations of the same fields, drifting
 * apart the first time one of them changed.
 *
 * Voiding sits beside saving because they are the two honest answers to a
 * wrong entry, and which is right depends on whether anybody has relied on the
 * figure: "freely editable until a figure has been relied upon (a frozen
 * snapshot, a completed tax year, a generated report) — after that, void and
 * re-enter". Nothing in the schema marks a period as relied upon yet, so the
 * app cannot decide for you. It offers both and says what each one means.
 */

import { useCallback, useState } from 'react';
import { formatIsoDate } from '../../lib/dates.ts';
import { minorUnitExponent, money, parseAmountToMinor } from '../../lib/money.ts';
import type { Expense, ExpenseListing, Visibility } from '../../repo/types.ts';
import { Button, Card, Field, Problem } from '../../ui/primitives.tsx';

export interface ExpensePatch {
  id: string;
  date?: string;
  amount?: { minor: bigint; currency: string };
  payee?: string | null;
  categoryId?: string | null;
  visibility?: Visibility;
}

/** Minor units back into something a person can edit: 45175 → "451.75". */
function toInput(minor: bigint, currency: string): string {
  const exponent = minorUnitExponent(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  if (exponent === 0) return digits;
  return `${digits.slice(0, digits.length - exponent)}.${digits.slice(digits.length - exponent)}`;
}

export function EditExpense({
  expense,
  listing,
  onSave,
  onVoid,
  onCancel,
}: {
  expense: Expense;
  listing: ExpenseListing;
  onSave: (patch: ExpensePatch) => Promise<void>;
  onVoid: () => Promise<void>;
  onCancel: () => void;
}) {
  const currency = expense.amount.currency;
  const [amount, setAmount] = useState(() => toInput(expense.amount.minor, currency));
  const [payee, setPayee] = useState(expense.payee ?? '');
  const [date, setDate] = useState(expense.date);
  const [categoryId, setCategoryId] = useState(expense.categoryId ?? '');
  const [personal, setPersonal] = useState(expense.visibility === 'personal');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const isMine = expense.member.id === listing.viewer.memberId;

  const save = useCallback(async () => {
    setProblem(null);

    let minor: bigint;
    try {
      minor = parseAmountToMinor(amount, currency);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That is not an amount.');
      return;
    }
    if (minor <= 0n) {
      setProblem('An expense is a positive amount.');
      return;
    }

    setBusy(true);
    try {
      await onSave({
        id: expense.id,
        date,
        amount: money(minor, currency),
        payee: payee.trim() === '' ? null : payee.trim(),
        categoryId: categoryId === '' ? null : categoryId,
        // Visibility only where it is yours to set. Marking somebody else's
        // spend private would hide it from them, and the policy refuses it —
        // better not offered than offered and refused.
        ...(isMine ? { visibility: (personal ? 'personal' : 'household') as Visibility } : {}),
      });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }, [amount, categoryId, currency, date, expense.id, isMine, onSave, payee, personal]);

  return (
    <Card
      title="Correct an entry"
      aside={
        <span className="note">
          {formatIsoDate(expense.date)} · {expense.member.displayName}
        </span>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-[130px] sm:shrink-0">
          <Field
            label={`Amount (${currency})`}
            numeric
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </div>

        <div className="w-full sm:w-auto sm:min-w-[160px] sm:flex-1">
          <Field
            label="Payee"
            value={payee}
            onChange={(event) => {
              setPayee(event.target.value);
            }}
          />
        </div>

        <div className="w-full sm:w-[150px] sm:shrink-0">
          <Field
            label="Date"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
        </div>

        <label className="flex w-full flex-col gap-1.5 sm:w-[160px] sm:shrink-0">
          <span className="micro-label">Category</span>
          <select
            className="field"
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
            }}
          >
            <option value="">Uncategorised</option>
            {listing.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <button type="button" className="note underline" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {isMine && (
        <label className="mt-3 flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={personal}
            onChange={(event) => {
              setPersonal(event.target.checked);
            }}
          />
          <span className="text-caption" style={{ color: 'var(--ink-2)' }}>
            Keep this private — only you will see it. The amount still counts in the household
            total, shown to everyone else as one figure without the detail.
          </span>
        </label>
      )}

      {problem !== null && (
        <div className="mt-3">
          <Problem>{problem}</Problem>
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        {confirming ? (
          <>
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onVoid().finally(() => {
                  setBusy(false);
                });
              }}
            >
              Yes, void it
            </Button>
            <button
              type="button"
              className="note underline"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            className="note underline"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Void this entry
          </button>
        )}
      </div>

      <p className="note mt-2.5">
        Correcting changes the entry. Voiding leaves it on the ledger, marked, and out of every
        total — which is the right answer once a figure has been relied upon, because the history
        then still explains itself. Neither deletes anything: there is no delete permission on this
        table at all.
      </p>
    </Card>
  );
}
