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
import { syncCardEmiDebts } from './cardEmiDebt.ts';
import { closeWithoutCard, voidCloseWithoutCard, type CloseWithoutCard } from '../../repo/closeWithoutCard.ts';
import type { Credit, Expense, PlanListing, Transfer } from '../../repo/types.ts';
import { useHoldingMoves } from './useHoldingMoves.ts';
import { useLoanPayments } from './useLoanPayments.ts';
import { usePrivateClose } from './usePrivateClose.ts';
import { Field, Problem, RequiredKey } from '../../ui/primitives.tsx';
import { Stepper } from '../../ui/Stepper.tsx';
import { accountSteps, cardCycles, closeFigures, effectiveClosedWithout, itemisedFigures, lastDayOf, monthlyPlanned, monthWord, parseBalance, planYearOf, typedDueBalances, typedEmi, type TypedBalances, type TypedDue } from './closeMonth.ts';
import { cardEmiWords, cardSummary, cycleRowWords, lateStatementDay, nextDueMonth } from './cardCycleView.ts';
import { titleOf } from './accountRows.ts';
import { amountText } from './creditForm.ts';
import type { AccountsData } from './useAccounts.ts';
import { addMonths } from '../../domain/accrual.ts';

/** What the month paid on loans from accounts: the split's paid to loans less the cards' EMI part, which is counted from the cards' statements and said apart (card-cycles.md 4a). */
function loansOnly(figures: { readonly paidToLoans: bigint; readonly cardEmi?: { readonly converted: bigint; readonly principal: bigint } }): bigint {
  return figures.paidToLoans - ((figures.cardEmi?.principal ?? 0n) - (figures.cardEmi?.converted ?? 0n));
}

export function CloseMonth({
  data,
  month,
  today,
  credits,
  transfers,
  closedWithout,
  canCloseWithout,
  onClosedWithoutChanged,
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
  /** The months an owner or a partner closed without a statement-date card; a statement for that cycle, when it arrives, supersedes the choice (card-cycles.md 2.4). */
  closedWithout: readonly CloseWithoutCard[];
  /** An owner or a partner may close the month without a card that is still waiting, and undo it. */
  canCloseWithout: boolean;
  onClosedWithoutChanged: () => void;
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

  // A due typed for a statement-date card that is still waiting (card-cycles.md 8.2): an amount and the date on the statement. It is read as the card's cycle until a statement for the
  // same cycle replaces it, and is saved with the close, as a typed balance.
  // Closing without a card is a choice made here and saved with the close, not before it: cancelling the close leaves nothing behind (card-cycles.md 2.4). What the close shows is the
  // choices already saved, with these added and the ones undone here taken away.
  const [leaveNow, setLeaveNow] = useState<ReadonlySet<string>>(new Set());
  const [putBackNow, setPutBackNow] = useState<ReadonlySet<string>>(new Set());
  const choices = useMemo(() => effectiveClosedWithout({ saved: closedWithout, month, leaveOut: leaveNow, putBack: putBackNow }), [closedWithout, month, leaveNow, putBackNow]);
  const [dueTexts, setDueTexts] = useState<Record<string, TypedDue>>({});
  const [typingDue, setTypingDue] = useState<ReadonlySet<string>>(new Set());
  // A missing date is said once its field has been left, and not while the amount is still being typed.
  const [dateLeft, setDateLeft] = useState<ReadonlySet<string>>(new Set());
  const typedDues = useMemo(() => typedDueBalances({ month, accounts: data.accounts, typed: dueTexts }), [month, data.accounts, dueTexts]);
  const balancesAll = useMemo(() => [...data.balances, ...typedDues.balances], [data.balances, typedDues.balances]);

  const base = useMemo(
    () => ({
      month,
      today,
      accounts: data.accounts,
      balances: balancesAll,
      closedWithout: choices,
      credits,
      transfers,
      typed: {} as TypedBalances,
      holdingMoves: entries.moves,
      loanPayments: loans.payments,
      ...(unread === null || unread.length === 0 ? {} : { unreadable: unread }),
    }),
    [month, today, data.accounts, balancesAll, choices, credits, transfers, unread, entries.moves, loans.payments],
  );
  const steps = useMemo(() => accountSteps(base), [base]);

  // What has been typed, as text, for each account: the closing balance, and the opening where there is none yet.
  const [texts, setTexts] = useState<Record<string, { opening: string; closing: string }>>(() =>
    Object.fromEntries(steps.map((step) => [step.accountId, { opening: '', closing: step.closing === null ? '' : amountText(step.closing.minor, step.currency) }])),
  );
  // What a month-end card's bill converted to EMI plans and the principal of the instalments it billed (card-cycles.md 4a), as text: what is recorded on its closing day, or nothing.
  const emiSaved = useMemo(
    () =>
      new Set(
        steps
          .filter((step) => step.type === 'card')
          .filter((step) => {
            const here = data.balances.filter((b) => b.accountId === step.accountId && b.asAt === closesOn);
            const row = here.find((b) => b.source === 'statement') ?? here[0];
            return (row?.emiConvertedMinor ?? 0n) !== 0n || (row?.emiPrincipalMinor ?? 0n) !== 0n;
          })
          .map((step) => step.accountId),
      ),
    // Read once, when the close opens: what was already saved is what is hidden, and what is typed now is never taken from the person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [emiTexts, setEmiTexts] = useState<Record<string, { converted: string; principal: string }>>(() =>
    Object.fromEntries(
      steps
        .filter((step) => step.type === 'card')
        .map((step) => {
          const here = data.balances.filter((b) => b.accountId === step.accountId && b.asAt === closesOn);
          const row = here.find((b) => b.source === 'statement') ?? here[0];
          const say = (minor: bigint | undefined): string => (minor === undefined || minor === 0n ? '' : amountText(minor, step.currency));
          return [step.accountId, { converted: say(row?.emiConvertedMinor), principal: say(row?.emiPrincipalMinor) }];
        }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const parsed = steps.map((step) => ({
    step,
    opening: parseBalance(texts[step.accountId]?.opening ?? '', step.currency),
    closing: parseBalance(texts[step.accountId]?.closing ?? '', step.currency),
  }));
  // The two EMI fields of a month-end card; a statement-date card's are typed with its due.
  const emiRead = Object.fromEntries(
    parsed
      .filter(({ step }) => step.type === 'card')
      .map(({ step }) => [step.accountId, typedEmi(emiTexts[step.accountId] ?? {}, step.currency)] as const),
  );
  const anyBad = parsed.some((p) => !p.opening.ok || !p.closing.ok) || Object.keys(typedDues.problems).length > 0 || Object.values(emiRead).some((read) => !read.ok);

  const typed: TypedBalances = Object.fromEntries(
    parsed.map(({ step, opening, closing }) => [
      step.accountId,
      {
        ...(opening.ok && opening.balance !== null ? { opening: opening.balance } : {}),
        ...(closing.ok && closing.balance !== null ? { closing: closing.balance } : {}),
        ...(() => {
          const read = emiRead[step.accountId];
          return read?.ok === true ? { emi: { converted: read.converted ?? money(0n, step.currency), principal: read.principal ?? money(0n, step.currency) } } : {};
        })(),
      },
    ]),
  );
  const worked = useMemo(() => closeFigures({ ...base, typed }), [base, typed]);
  const live: typeof worked = blocked ? { status: 'missing', missing: [] } : worked;
  const rows = useMemo(() => accountSteps({ ...base, typed }), [base, typed]);

  const itemised = itemisedFigures(expenses ?? [], credits, month);
  const accountsInUse = steps.length;
  // A card that closes on its statement date is closed by its statement, not by a balance typed here: its cycle is worked out from its statements (card-cycles.md 2).
  const cycles = useMemo(() => cardCycles({ month, accounts: data.accounts, balances: balancesAll, closedWithout: choices }), [month, data.accounts, balancesAll, choices]);
  const cycleOf = new Map(cycles.map((cycle) => [cycle.accountId, cycle] as const));
  const accountsTyped = parsed.filter((p) => (p.closing.ok && p.closing.balance !== null) || (cycleOf.get(p.step.accountId) !== undefined && cycleOf.get(p.step.accountId)?.kind !== 'waiting')).length;
  const names = new Map(data.accounts.map((account) => [account.id, titleOf(account)]));
  const cardLines = cardSummary(cycles, names);
  // An owner or a partner reads every account. A contributor reads their own only: say so wherever there is another member to have one.
  const privateNote = asks ? '' : data.members.length > 1 ? ' This close covers only the accounts you can read: your own.' : '';

  // Closing a month without a card: asked once, and chosen here; it is saved with the close and not before it, so cancelling the close leaves nothing behind (card-cycles.md 2.4).
  const [confirming, setConfirming] = useState<string | null>(null);
  const leaveOut = (accountId: string): void => {
    setLeaveNow((was) => new Set(was).add(accountId));
    setPutBackNow((was) => {
      const next = new Set(was);
      next.delete(accountId);
      return next;
    });
    setConfirming(null);
  };
  const putBack = (accountId: string): void => {
    const saved = closedWithout.some((each) => each.accountId === accountId && each.month === month);
    setLeaveNow((was) => {
      const next = new Set(was);
      next.delete(accountId);
      return next;
    });
    if (saved) setPutBackNow((was) => new Set(was).add(accountId));
  };

  const finish = async (): Promise<void> => {
    if (live.status !== 'figures' || anyBad) return;
    setBusy(true);
    setProblem(null);
    try {
      // A due typed for a card that was waiting is saved on the statement's date, as a typed balance: a statement for the same cycle replaces it when it is imported.
      for (const due of typedDues.balances) {
        await saveBalance({
          householdId: data.household.id,
          accountId: due.accountId,
          asAt: due.asAt,
          balance: due.balance,
          emiConvertedMinor: due.emiConvertedMinor ?? 0n,
          emiPrincipalMinor: due.emiPrincipalMinor ?? 0n,
        });
      }
      for (const { step, opening, closing } of parsed) {
        if (opening.ok && opening.balance !== null) {
          await saveBalance({ householdId: data.household.id, accountId: step.accountId, asAt: opensOn, balance: opening.balance });
        }
        if (closing.ok && closing.balance !== null) {
          // A month-end card's closing carries its EMI figures, written as given (none is zero), so a corrected figure never keeps an old one beside it.
          const read = emiRead[step.accountId];
          const emi =
            step.type === 'card' && cycleOf.get(step.accountId) === undefined && read?.ok === true
              ? { emiConvertedMinor: read.converted?.minor ?? 0n, emiPrincipalMinor: read.principal?.minor ?? 0n }
              : {};
          await saveBalance({ householdId: data.household.id, accountId: step.accountId, asAt: closesOn, balance: closing.balance, ...emi });
        }
      }
      // A card whose EMI plans are among the household's debts has what they owe brought up to its statements, which a typed due or closing may have changed (CY-I17). One that has none is not given one here.
      try {
        await syncCardEmiDebts({ householdId: data.household.id, role: data.viewer.role, add: () => false });
      } catch {
        // The close is saved; the debt is brought up to date by the next close or import, or from the card's row on Accounts, which says when it is behind.
      }
      // The choices last: a card left out closes the month, so it is written only once everything else is. A failure before this leaves the card waiting, which is the safe side.
      for (const accountId of leaveNow) {
        if (closedWithout.some((each) => each.accountId === accountId && each.month === month)) continue;
        await closeWithoutCard({ householdId: data.household.id, accountId, month });
      }
      for (const accountId of putBackNow) {
        const choice = closedWithout.find((each) => each.accountId === accountId && each.month === month);
        if (choice !== undefined) await voidCloseWithoutCard(choice.id);
      }
      if (leaveNow.size > 0 || putBackNow.size > 0) onClosedWithoutChanged();
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
                      ? 'Import the statement of each card that is waiting, or type its amount due below, and type each other account’s balance, to see what was spent. It is not counted as nothing.'
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
                      <div className="flex flex-col gap-1.5">
                        <p className="note" data-testid="close-card-cycle">
                          {cycleRowWords(cycleOf.get(row.accountId) as NonNullable<ReturnType<typeof cycleOf.get>>, {
                            month,
                            lateDay: lateStatementDay(data.balances, row.accountId),
                            nextMonth: nextDueMonth(data.balances, row.accountId, month),
                            shown: (value) => shown(value),
                          })}
                        </p>
                        {cycleOf.get(row.accountId)?.kind === 'closed-without' && canCloseWithout && (
                          <button
                            type="button"
                            className="btn btn-quiet self-start"
                            aria-label={`Undo: close ${word} with ${row.title}’s statement`}
                            onClick={() => {
                              putBack(row.accountId);
                            }}
                          >
                            Undo
                          </button>
                        )}
                        {(cycleOf.get(row.accountId)?.kind === 'waiting' || (typingDue.has(row.accountId) && cycleOf.get(row.accountId)?.kind !== 'closed-without')) && (
                          <>
                            {!typingDue.has(row.accountId) ? (
                              <button
                                type="button"
                                className="btn btn-quiet self-start"
                                onClick={() => {
                                  setTypingDue((was) => new Set(was).add(row.accountId));
                                }}
                              >
                                Type the amount due instead
                              </button>
                            ) : (
                              <>
                                <Field
                                  label="Amount due"
                                  numeric
                                  inputMode="decimal"
                                  autoComplete="off"
                                  placeholder="0"
                                  hint="What the statement says is due, at its date."
                                  value={dueTexts[row.accountId]?.amount ?? ''}
                                  error={typedDues.fields[row.accountId] === 'amount' ? (typedDues.problems[row.accountId] ?? null) : null}
                                  onChange={(event) => {
                                    setDueTexts((was) => ({ ...was, [row.accountId]: { ...was[row.accountId], amount: event.target.value, date: was[row.accountId]?.date ?? '' } }));
                                  }}
                                />
                                <Field
                                  label="Statement date"
                                  type="date"
                                  min={`${month}-01`}
                                  max={closesOn}
                                  hint={`It must fall in ${word}. A statement imported later for the same cycle replaces this.`}
                                  value={dueTexts[row.accountId]?.date ?? ''}
                                  error={typedDues.fields[row.accountId] === 'date' && ((dueTexts[row.accountId]?.date ?? '').trim() !== '' || dateLeft.has(row.accountId)) ? (typedDues.problems[row.accountId] ?? null) : null}
                                  onBlur={() => {
                                    setDateLeft((was) => new Set(was).add(row.accountId));
                                  }}
                                  onChange={(event) => {
                                    setDueTexts((was) => ({ ...was, [row.accountId]: { ...was[row.accountId], amount: was[row.accountId]?.amount ?? '', date: event.target.value } }));
                                  }}
                                />
                                <details>
                                  <summary>EMIs on this bill?</summary>
                                  <div className="flex flex-col gap-1.5">
                                    <Field
                                      label="Converted to EMIs this cycle"
                                      numeric
                                      inputMode="decimal"
                                      autoComplete="off"
                                      placeholder="0"
                                      value={dueTexts[row.accountId]?.converted ?? ''}
                                      error={typedDues.fields[row.accountId] === 'converted' ? (typedDues.problems[row.accountId] ?? null) : null}
                                      onChange={(event) => {
                                        setDueTexts((was) => ({ ...was, [row.accountId]: { amount: '', date: '', ...was[row.accountId], converted: event.target.value } }));
                                      }}
                                    />
                                    <Field
                                      label="EMI principal billed this cycle"
                                      numeric
                                      inputMode="decimal"
                                      autoComplete="off"
                                      placeholder="0"
                                      value={dueTexts[row.accountId]?.principal ?? ''}
                                      error={typedDues.fields[row.accountId] === 'principal' ? (typedDues.problems[row.accountId] ?? null) : null}
                                      onChange={(event) => {
                                        setDueTexts((was) => ({ ...was, [row.accountId]: { amount: '', date: '', ...was[row.accountId], principal: event.target.value } }));
                                      }}
                                    />
                                  </div>
                                </details>
                              </>
                            )}
                          </>
                        )}
                        {cycleOf.get(row.accountId)?.kind === 'waiting' && canCloseWithout && (
                          <>
                            {confirming !== row.accountId ? (
                              <button
                                type="button"
                                className="btn btn-quiet self-start"
                                onClick={() => {
                                  setConfirming(row.accountId);
                                }}
                              >
                                Close without {row.title}
                              </button>
                            ) : (
                              <div role="group" aria-label={`Close ${word} without ${row.title}`} className="flex flex-col gap-1.5" data-testid="close-without-confirm">
                                <h4 className="label">Close {word} without {row.title}?</h4>
                                <p className="note">
                                  {row.title}’s {word} cycle will be left out until its statement is imported. Payments to it this month count as spent instead. It is saved when you close {word}, and cancelling the close saves nothing.
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="btn"
                                            onClick={() => {
                                      leaveOut(row.accountId);
                                    }}
                                  >
                                    Close without it
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-quiet"
                                            onClick={() => {
                                      setConfirming(null);
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
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
                        {row.type === 'card' && (
                          <details>
                            <summary>EMIs on this bill?</summary>
                            <div className="flex flex-col gap-1.5">
                              <Field
                                label="Converted to EMIs this cycle"
                                numeric
                                inputMode="decimal"
                                autoComplete="off"
                                placeholder="0"
                                {...(privacy && emiSaved.has(row.accountId) ? { readOnly: true, hint: 'Hidden while amounts are hidden.' } : {})}
                                value={privacy && emiSaved.has(row.accountId) ? '••••••' : (emiTexts[row.accountId]?.converted ?? '')}
                                error={(() => {
                                  const read = emiRead[row.accountId];
                                  return read !== undefined && !read.ok && read.field === 'converted' ? read.problem : null;
                                })()}
                                onChange={(event) => {
                                  setEmiTexts((was) => ({ ...was, [row.accountId]: { converted: event.target.value, principal: was[row.accountId]?.principal ?? '' } }));
                                }}
                              />
                              <Field
                                label="EMI principal billed this cycle"
                                numeric
                                inputMode="decimal"
                                autoComplete="off"
                                placeholder="0"
                                {...(privacy && emiSaved.has(row.accountId) ? { readOnly: true, hint: 'Hidden while amounts are hidden.' } : {})}
                                value={privacy && emiSaved.has(row.accountId) ? '••••••' : (emiTexts[row.accountId]?.principal ?? '')}
                                error={(() => {
                                  const read = emiRead[row.accountId];
                                  return read !== undefined && !read.ok && read.field === 'principal' ? read.problem : null;
                                })()}
                                onChange={(event) => {
                                  setEmiTexts((was) => ({ ...was, [row.accountId]: { converted: was[row.accountId]?.converted ?? '', principal: event.target.value } }));
                                }}
                              />
                            </div>
                          </details>
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
                      {(own.length > 0 || figures.outside !== 0n || figures.putIntoHoldings !== 0n || figures.takenOutOfHoldings !== 0n || loansOnly(figures) !== 0n) && (
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
                          {loansOnly(figures) !== 0n && <p className="note tabular-nums">Paid to loans · {shown(money(loansOnly(figures), figures.currency))}</p>}
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
                      {figures.cardEmi !== undefined && (
                        <p className="note tabular-nums" data-testid="close-card-emis">
                          {cardEmiWords(figures.cardEmi, (value) => shown(money(value, figures.currency)))}
                        </p>
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
