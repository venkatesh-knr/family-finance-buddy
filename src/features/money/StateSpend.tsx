/**
 * State the spend (docs/design/spending-capture.md section 11.3; the StateSpend boards): one figure for a month that has ended.
 *
 * *Spent in total* and *or just the rest* are linked: typing either fills the other, and what is saved is always the total (`stateSpendForm.ts`). A total
 * below what is itemised is not an error: the rest stays empty and a line says both figures will be shown. Changing a stated month is the same form,
 * opened with its figure; saving voids the old statement and states again (SC-I14). The form is one step on a screen of its own, as the other money forms are.
 */

import { useState } from 'react';
import { formatMoney, money, type Money } from '../../lib/money.ts';
import { stateSpend } from '../../repo/spendStatements.ts';
import type { SpendStatement } from '../../repo/types.ts';
import { Field, RequiredKey } from '../../ui/primitives.tsx';
import { Select } from '../../ui/Select.tsx';
import { Stepper } from '../../ui/Stepper.tsx';
import { monthWord } from './closeMonth.ts';
import { amountReading, linkedFields, NOTE_LIMIT, readSpendForm } from './stateSpendForm.ts';

/** A figure as a field takes it back: no symbol, no grouping. */
function plainText(value: Money): string {
  return formatMoney(value).replace(/[^\d.]/g, '');
}

export function StateSpend({
  householdId,
  month,
  year,
  currencies,
  itemised,
  editing = null,
  onDone,
  onCancel,
}: {
  householdId: string;
  /** The month, `YYYY-MM`. */
  month: string;
  year: string;
  /** The currencies it can be stated in, the one being read first. */
  currencies: readonly string[];
  /** What was itemised in the month in each currency, net of refunds, never negative. */
  itemised: readonly Money[];
  /** A statement being changed: its figure and note are in the form, and its currency is kept. */
  editing?: SpendStatement | null;
  onDone: (said: string) => void;
  onCancel: () => void;
}) {
  const [currency, setCurrency] = useState(editing?.amount.currency ?? currencies[0] ?? 'INR');
  const itemisedHere = itemised.find((line) => line.currency === currency)?.minor ?? 0n;
  const [total, setTotal] = useState(editing === null ? '' : plainText(editing.amount));
  const [rest, setRest] = useState(() => (editing === null ? '' : linkedFields({ edited: 'total', text: plainText(editing.amount), itemised: itemisedHere, currency }).rest));
  const [note, setNote] = useState(editing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const name = monthWord(month);
  const symbol = formatMoney(money(0n, currency)).replace(/[\d.,\s]/g, '');
  const linked = linkedFields({ edited: 'total', text: total, itemised: itemisedHere, currency });
  const totalReading = amountReading(total, currency);
  const restReading = rest.trim() === '' ? null : amountReading(rest, currency);
  // Said as soon as something is typed that is not an amount; a blank waits for the button, which stays off until there is an amount.
  const totalError = !totalReading.ok && (tried || total.trim() !== '') ? totalReading.problem : null;

  const typeTotal = (text: string) => {
    setTotal(text);
    setRest(linkedFields({ edited: 'total', text, itemised: itemisedHere, currency }).rest);
  };
  const typeRest = (text: string) => {
    setRest(text);
    setTotal(linkedFields({ edited: 'rest', text, itemised: itemisedHere, currency }).total);
  };
  const changeCurrency = (next: string) => {
    setCurrency(next);
    setTotal('');
    setRest('');
  };

  const finish = async (): Promise<void> => {
    setTried(true);
    const read = readSpendForm({ total, note, itemised: itemisedHere, currency });
    if (!read.ok) {
      setProblem(read.problem);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await stateSpend({ householdId, month, amount: money(read.amountMinor, currency), note: read.note });
      onDone(`${name}’s spend stated: ${formatMoney(money(read.amountMinor, currency))}.`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stepper
      title={editing === null ? `State ${name}’s spend` : `Change ${name}’s spend`}
      finishLabel="Save"
      busyLabel="Saving…"
      busy={busy}
      problem={problem}
      onCancel={onCancel}
      onFinish={finish}
      steps={[
        {
          name: `${name} ${year} · the month has ended`,
          ready: totalReading.ok,
          content: (
            <>
              <RequiredKey />
              {editing === null && currencies.length > 1 ? (
                <Select
                  label="Currency"
                  value={currency}
                  disabled={busy}
                  onChange={(event) => {
                    changeCurrency(event.target.value);
                  }}
                >
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              ) : null}

              {itemisedHere > 0n && (
                <p className="note">
                  You have itemised <strong className="tabular-nums">{formatMoney(money(itemisedHere, currency))}</strong> so far.
                </p>
              )}

              <Field
                label="Spent in total"
                needed
                numeric
                inputMode="decimal"
                autoComplete="off"
                value={total}
                readOnly={busy}
                placeholder={symbol === '₹' ? '82,000' : '0.00'}
                {...(linked.caption === null ? {} : { hint: linked.caption })}
                error={totalError}
                onChange={(event) => {
                  typeTotal(event.target.value);
                }}
              />

              {itemisedHere > 0n && (
                <Field
                  label="or just the rest"
                  numeric
                  inputMode="decimal"
                  autoComplete="off"
                  value={rest}
                  readOnly={busy}
                  placeholder={symbol === '₹' ? '30,000' : '0.00'}
                  hint={linked.belowItemised ? 'Nothing to add: this total is less than what is itemised.' : 'Typing either one fills the other.'}
                  {...(restReading !== null && !restReading.ok ? { error: restReading.problem } : {})}
                  onChange={(event) => {
                    typeRest(event.target.value);
                  }}
                />
              )}

              {linked.belowItemised && (
                <p className="note">
                  You have itemised more than this ({formatMoney(money(itemisedHere, currency))}). Both figures will be shown.
                </p>
              )}

              <p className="note">What you spent on living: not what you put into investments, not loan EMIs, not moves between your own accounts.</p>

              <div className="flex flex-col gap-1.5">
                <label className="label" htmlFor="state-spend-note">
                  Note
                </label>
                <textarea
                  id="state-spend-note"
                  className="field"
                  rows={2}
                  maxLength={NOTE_LIMIT}
                  value={note}
                  readOnly={busy}
                  // Grows with its text, so a note is never cut off at 200% text.
                  style={{ fieldSizing: 'content', minHeight: '3.25rem' } as React.CSSProperties}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                />
                <span className="field-help">Optional.</span>
              </div>
            </>
          ),
        },
      ]}
    />
  );
}
