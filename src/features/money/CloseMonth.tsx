/**
 * Close October: balances in, spending out (docs/design/spending-capture.md sections 2 and 6; ledger-income.md section 4; the MonthClose board).
 *
 * The answer first and the working below it. The result is what was spent in the month, derived from the balances at its two ends and what the
 * ledger knows, with what was itemised beside it and what was not yet; it updates as balances are typed. Under it, one row for each account in
 * use with its closing balance as the only input, and opening, money in and what was left shown beside it. The first close asks for the opening
 * as well. Nothing is written until the last button: closing stores balances, and spent is derived, never stored (SC-I1).
 *
 * Money into and out of holdings is read from the holdings' own entries that name an account (ledger-income.md section 4a), and an entry that names none is
 * counted and said, because its money is still in spent. A loan payment is read when it names the account it left, and reads as spent when it does not. A payment
 * that is not listed makes the figure read low; an investment the app does not know about makes it read high. An account another member keeps
 * private is not in this close, and the screen says so.
 */

import { useEffect, useMemo, useState } from 'react';
import { formatShortDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney, money, type Money } from '../../lib/money.ts';
import { listExpensesBetween } from '../../repo/expenses.ts';
import { listPlan } from '../../repo/planning.ts';
import { saveBalance } from '../../repo/accounts.ts';
import type { Credit, Expense, PlanListing, Transfer } from '../../repo/types.ts';
import { useHoldingMoves } from './useHoldingMoves.ts';
import { useLoanPayments } from './useLoanPayments.ts';
import { usePrivateClose } from './usePrivateClose.ts';
import { Field, Problem, RequiredKey } from '../../ui/primitives.tsx';
import { Stepper } from '../../ui/Stepper.tsx';
import { accountSteps, cardCycles, closeFigures, itemisedFigures, lastDayOf, monthlyPlanned, monthWord, parseBalance, planYearOf, type TypedBalances } from './closeMonth.ts';
import { cardSummary, cycleRowWords, lateStatementDay, nextDueMonth } from './cardCycleView.ts';
import { titleOf } from './accountRows.ts';
import { amountText } from './creditForm.ts';
import type { AccountsData } from './useAccounts.ts';
import { addMonths } from '../../domain/accrual.ts';

export function CloseMonth({
  data,
  month,
  today,
  credits,
  transfers,
  privacy,
  onDone,
  onCancel,
}: {
  data: AccountsData;
  /** The month being closed: `2026-10`. */
  month: string;
  today: string;
  credits: readonly Credit[];
  transfers: readonly Transfer[];
  privacy: boolean;
  onDone: (said: string) => void;
  onCancel: () => void;
}) {
  const word = monthWord(month);
  const closesOn = lastDayOf(month);
  const opensOn = lastDayOf(addMonths(`${month}-01`, -1).slice(0, 7));
  const shown = (value: Money): string => formatMoney(value, { privacy });

  // What was itemised in the month, as entered. Read here, once, for the line beside the result; a failed read leaves the line out and says so.
  const [expenses, setExpenses] = useState<readonly Expense[] | null>(null);
  const [expensesFailed, setExpensesFailed] = useState(false);
  useEffect(() => {
    let live = true;
    listExpensesBetween({ householdId: data.household.id, from: `${month}-01`, to: closesOn, members: data.members })
      .then((rows) => {
        if (live) setExpenses(rows);
      })
      .catch(() => {
        if (live) setExpensesFailed(true);
      });
    return () => {
      live = false;
    };
  }, [data.household.id, data.members, month, closesOn]);

  // The plan the month is measured against. A plan that cannot be read leaves the line out and says so; it is no reason to stop a close.
  const [plan, setPlan] = useState<PlanListing | null>(null);
  const [planFailed, setPlanFailed] = useState(false);
  useEffect(() => {
    let live = true;
    listPlan({ householdId: data.household.id, fy: planYearOf(month) })
      .then((listing) => {
        if (live) setPlan(listing);
      })
      .catch(() => {
        if (live) setPlanFailed(true);
      });
    return () => {
      live = false;
    };
  }, [data.household.id, month]);

  // What another member keeps private, as totals, for an owner or a partner: the database adds it, and nobody else may ask. Until it has been read,
  // or when it could not be, there is no figure: a close that leaves it out reads wrong, and not only low.
  const { asks, unread, failed: unreadFailed, blocked: privateBlocked } = usePrivateClose(data.household.id, data.viewer.role, month);
  // The holdings' entries that named an account: money into a holding is not spent, and money taken out is money in. Without them the figure would read low.
  const entries = useHoldingMoves(data.household.id, month, data.accounts.some((account) => !account.isArchived), today as IsoDate);
  // And the payments on loans: an EMI that left an account is paid to loans, and read as none it would sit in spent.
  const loans = useLoanPayments(data.household.id, month, data.accounts.some((account) => !account.isArchived));
  const blocked = privateBlocked || entries.blocked || loans.blocked;

  const base = useMemo(
    () => ({
      month,
      today,
      accounts: data.accounts,
      balances: data.balances,
      credits,
      transfers,
      typed: {} as TypedBalances,
      holdingMoves: entries.moves,
      loanPayments: loans.payments,
      ...(unread === null || unread.length === 0 ? {} : { unreadable: unread }),
    }),
    [month, today, data.accounts, data.balances, credits, transfers, unread, entries.moves, loans.payments],
  );
  const steps = useMemo(() => accountSteps(base), [base]);

  // What has been typed, as text, for each account: the closing balance, and the opening where there is none yet.
  const [texts, setTexts] = useState<Record<string, { opening: string; closing: string }>>(() =>
    Object.fromEntries(steps.map((step) => [step.accountId, { opening: '', closing: step.closing === null ? '' : amountText(step.closing.minor, step.currency) }])),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const parsed = steps.map((step) => ({
    step,
    opening: parseBalance(texts[step.accountId]?.opening ?? '', step.currency),
    closing: parseBalance(texts[step.accountId]?.closing ?? '', step.currency),
  }));
  const anyBad = parsed.some((p) => !p.opening.ok || !p.closing.ok);

  const typed: TypedBalances = Object.fromEntries(
    parsed.map(({ step, opening, closing }) => [
      step.accountId,
      {
        ...(opening.ok && opening.balance !== null ? { opening: opening.balance } : {}),
        ...(closing.ok && closing.balance !== null ? { closing: closing.balance } : {}),
      },
    ]),
  );
  const worked = useMemo(() => closeFigures({ ...base, typed }), [base, typed]);
  const live: typeof worked = blocked ? { status: 'missing', missing: [] } : worked;
  const rows = useMemo(() => accountSteps({ ...base, typed }), [base, typed]);

  const itemised = itemisedFigures(expenses ?? [], credits, month);
  const accountsInUse = steps.length;
  // A card that closes on its statement date is closed by its statement, not by a balance typed here: its cycle is worked out from its statements (card-cycles.md 2).
  const cycles = useMemo(() => cardCycles({ month, accounts: data.accounts, balances: data.balances }), [month, data.accounts, data.balances]);
  const cycleOf = new Map(cycles.map((cycle) => [cycle.accountId, cycle] as const));
  const accountsTyped = parsed.filter((p) => (p.closing.ok && p.closing.balance !== null) || (cycleOf.get(p.step.accountId) !== undefined && cycleOf.get(p.step.accountId)?.kind !== 'waiting')).length;
  const names = new Map(data.accounts.map((account) => [account.id, titleOf(account)]));
  const cardLines = cardSummary(cycles, names);
  // An owner or a partner reads every account. A contributor reads their own only: say so wherever there is another member to have one.
  const privateNote = asks ? '' : data.members.length > 1 ? ' This close covers only the accounts you can read: your own.' : '';

  const finish = async (): Promise<void> => {
    if (live.status !== 'figures' || anyBad) return;
    setBusy(true);
    setProblem(null);
    try {
      for (const { step, opening, closing } of parsed) {
        if (opening.ok && opening.balance !== null) {
          await saveBalance({ householdId: data.household.id, accountId: step.accountId, asAt: opensOn, balance: opening.balance });
        }
        if (closing.ok && closing.balance !== null) {
          await saveBalance({ householdId: data.household.id, accountId: step.accountId, asAt: closesOn, balance: closing.balance });
        }
      }
      onDone(
        live.currencies.length === 0
          ? `${word} closed.`
          : `${word} closed. Spent ${live.currencies.map((figures) => shown(money(figures.spent, figures.currency))).join(' and ')} from balances.`,
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stepper
      title={`Close ${word}`}
      finishLabel={`Close ${word}`}
      busyLabel="Closing…"
      busy={busy}
      problem={problem}
      onCancel={onCancel}
      onFinish={finish}
      steps={[
        {
          name: `Balances as at ${formatShortDate(closesOn)} · ${String(accountsTyped)} of ${String(accountsInUse)} accounts`,
          ready: live.status === 'figures' && !anyBad,
          content: (
            <>
              <RequiredKey />
              <section aria-label={`Spent in ${word}`} className="card card-lift flex flex-col gap-1" data-testid="close-result">
                <h2 className="label">Spent in {word}</h2>
                {live.status === 'figures' ? (
                  live.currencies.map((figures) => {
                    const done = itemised.get(figures.currency) ?? 0n;
                    const unlisted = figures.spent - done;
                    return (
                      <div key={figures.currency} className="flex flex-col">
                        <p className="figure" data-testid="close-spent">
                          {shown(money(figures.spent, figures.currency))}
                        </p>
                        <p className="note">{cardLines.byCycle === null ? 'from balances' : `from balances · ${cardLines.byCycle}`}</p>
                        {cardLines.notes.map((note) => (
                          <p key={note} className="note" data-testid="close-card-note">
                            {note}
                          </p>
                        ))}
                        {plan !== null && (() => {
                          const planned = monthlyPlanned(plan.budgets, plan.categories, figures.currency);
                          if (planned === null) return null;
                          const over = figures.spent - planned;
                          return (
                            <p className="note tabular-nums" data-testid="close-plan">
                              Plan {shown(money(planned, figures.currency))} ·{' '}
                              {over > 0n ? `${shown(money(over, figures.currency))} over the plan` : over < 0n ? `${shown(money(-over, figures.currency))} under the plan` : 'on the plan'}
                            </p>
                          );
                        })()}
                        {expenses !== null && (
                          <p className="note tabular-nums">
                            {shown(money(done, figures.currency))} itemised · {unlisted >= 0n ? shown(money(unlisted, figures.currency)) : `${shown(money(-unlisted, figures.currency))} more itemised than the balances say`}
                            {unlisted >= 0n ? ' not yet itemised' : ''}
                          </p>
                        )}
                      </div>
                    );
                  })
                ) : blocked ? (
                  <p className="note">
                    {unreadFailed || entries.failed || loans.failed
                      ? `${unreadFailed ? 'What other members keep private' : entries.failed ? 'The holdings' : 'The payments on loans'} could not be read just now, so there is no figure and the month cannot be closed.`
                      : 'Reading what other members keep private, what went into holdings and what was paid to loans…'}
                  </p>
                ) : live.status === 'missing' ? (
                  <p className="note">
                    {cycles.some((cycle) => cycle.kind === 'waiting')
                      ? 'Import the statement of each card that is waiting, and type each other account’s balance below, to see what was spent. It is not counted as nothing.'
                      : 'Type each account’s balance below to see what was spent. It is not counted as nothing.'}
                  </p>
                ) : (
                  <p className="note">There is nothing to close from balances.</p>
                )}
                {expensesFailed && <p className="note">What was itemised could not be read just now, so it is not shown beside the result.</p>}
                {planFailed && <p className="note">The plan could not be read just now, so the month is not measured against it.</p>}
              </section>

              <p className="note">
                A payment in that isn’t listed makes this read low. An investment the app doesn’t know about makes it read high. A loan payment is read
                when it names the account it left, and is counted as spent when it does not. A private deposit of another member that matured into one of these accounts is not read either.
                {entries.unnamed > 0
                  ? ` ${String(entries.unnamed)} ${entries.unnamed === 1 ? 'entry' : 'entries'} in Holdings this month (a purchase, a sale, a PPF payment, a deposit or bond, or an opening cost) name no account, so the close cannot tell where that money went, and a purchase reads as spent. Open it in Holdings and say which account.`
                  : ''}
                {privateNote}
              </p>

              {cycles.length > 0 && (
                <p className="note" data-testid="close-cycle-explained">
                  Each card on its statement date uses the cycle that ended in {word}. Bank accounts and month-end cards use {formatShortDate(opensOn)} and {formatShortDate(closesOn)}.
                  {cycles.some((cycle) => cycle.kind === 'waiting') ? ` ${String(cycles.filter((cycle) => cycle.kind === 'waiting').length)} waiting for a statement.` : ''}
                </p>
              )}
              <h2 className="label">Accounts</h2>
              {rows.map((row) => {
                const text = texts[row.accountId] ?? { opening: '', closing: '' };
                const bad = parsed.find((p) => p.step.accountId === row.accountId);
                // Only a balance that was already saved when the close opened is hidden: what is being typed now is never taken from the person.
                const mask = privacy && steps.find((s) => s.accountId === row.accountId)?.closing !== null && text.closing.trim() !== '';
                return (
                  <section key={row.accountId} aria-label={row.title} className="flex flex-col gap-1.5">
                    <h3 className="label">{row.title}</h3>
                    {cycleOf.get(row.accountId) !== undefined ? (
                      <p className="note" data-testid="close-card-cycle">
                        {cycleRowWords(cycleOf.get(row.accountId) as NonNullable<ReturnType<typeof cycleOf.get>>, {
                          month,
                          lateDay: lateStatementDay(data.balances, row.accountId),
                          nextMonth: nextDueMonth(data.balances, row.accountId, month),
                          shown: (value) => shown(value),
                        })}
                      </p>
                    ) : (
                      <>
                        {mask ? (
                          <Field label={`Closing balance, ${formatShortDate(closesOn)}`} numeric readOnly value="••••••" hint="Hidden while amounts are hidden." onChange={() => undefined} />
                        ) : (
                          <Field
                            label={`Closing balance, ${formatShortDate(closesOn)}`}
                            needed
                            numeric
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                            value={text.closing}
                            {...(row.type === 'card' ? { hint: 'What is due on the card at the end of the day.' } : {})}
                            error={bad !== undefined && !bad.closing.ok ? bad.closing.problem : null}
                            onChange={(event) => {
                              setTexts((was) => ({ ...was, [row.accountId]: { opening: text.opening, closing: event.target.value } }));
                            }}
                          />
                        )}
                        {steps.find((s) => s.accountId === row.accountId)?.openingNeeded === true ? (
                          <Field
                            label={`Opening balance, ${formatShortDate(opensOn)}`}
                            needed
                            numeric
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                            value={text.opening}
                            hint="The first close asks for it. After that it is last month’s closing."
                            error={bad !== undefined && !bad.opening.ok ? bad.opening.problem : null}
                            onChange={(event) => {
                              setTexts((was) => ({ ...was, [row.accountId]: { opening: event.target.value, closing: text.closing } }));
                            }}
                          />
                        ) : (
                          row.opening !== null && <p className="note tabular-nums">opening {shown(row.opening)}</p>
                        )}
                      </>
                    )}
                    {row.moneyIn !== null && row.left !== null && (
                      <p className="note tabular-nums">
                        money in {shown(money(row.moneyIn, row.currency))} · {row.type === 'card' ? 'charged' : 'left'} {shown(money(row.left, row.currency))}
                      </p>
                    )}
                  </section>
                );
              })}

              {live.status === 'figures' &&
                live.currencies.map((figures) => {
                  const mine = new Set(rows.filter((row) => row.currency === figures.currency).map((row) => row.accountId));
                  const own = transfers.filter(
                    (t) => !t.isVoided && t.amount.currency === figures.currency && t.date.slice(0, 7) === month && mine.has(t.fromAccountId),
                  );
                  const multi = live.currencies.length > 1 ? `, ${figures.currency}` : '';
                  return (
                    <div key={figures.currency} className="flex flex-col gap-1.5">
                      <p className="note tabular-nums">
                        Left the accounts{multi} · {shown(money(figures.leftTotal, figures.currency))}
                      </p>
                      {(own.length > 0 || figures.outside !== 0n || figures.putIntoHoldings !== 0n || figures.takenOutOfHoldings !== 0n || figures.paidToLoans !== 0n) && (
                        <section aria-label={`Not spending${multi}`} className="flex flex-col gap-1">
                          <h3 className="label">Not spending{multi}</h3>
                          {own.length > 0 && (
                            <details>
                              <summary className="tabular-nums">
                                Between your own accounts · {String(own.length)} · {shown(money(figures.ownTransfers, figures.currency))}
                              </summary>
                              <ul className="note">
                                {own.map((t) => (
                                  <li key={t.id} className="tabular-nums">
                                    {formatShortDate(t.date)} · {names.get(t.fromAccountId) ?? 'an account'} to {names.get(t.toAccountId) ?? 'an account you cannot see'} ·{' '}
                                    {shown(t.amount)}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                          {figures.paidToLoans !== 0n && (
                            <p className="note tabular-nums">Paid to loans · {shown(money(figures.paidToLoans, figures.currency))}</p>
                          )}
                          {(figures.putIntoHoldings !== 0n || figures.takenOutOfHoldings !== 0n) && (
                            <p className="note tabular-nums">
                              Into holdings · {shown(money(figures.putIntoHoldings, figures.currency))}
                              {figures.takenOutOfHoldings !== 0n ? ` · taken out ${shown(money(figures.takenOutOfHoldings, figures.currency))}` : ''}
                            </p>
                          )}
                          {figures.outside !== 0n && (
                            <p className="note tabular-nums">
                              {shown(money(figures.outside, figures.currency))} came in outside the accounts you added, and is counted in what was spent.
                            </p>
                          )}
                        </section>
                      )}
                    </div>
                  );
                })}
              {live.status === 'figures' && <p className="note">You can change a balance later. A statement that arrives later corrects the month by itself.</p>}
              {anyBad && <Problem>An amount above is not a number, so the month cannot be closed until it is.</Problem>}
            </>
          ),
        },
      ]}
    />
  );
}
