/**
 * The month: Came in · Spent · Saved, the Ledger's lifted surface (docs/design/ledger-income.md sections 1 and 4; the MoneyLedger board).
 *
 * Came in is the household's total for the month, from the sum function, so it includes other members' private credits without their rows,
 * and it is per currency. Spent is what has been itemised so far and other members' private spending, less the refunds, and says so; it is per
 * currency too, each as it was entered and never converted (LI-I5; the owner, 15 November 2026). Saved is not shown for a month that has not
 * been closed (LI-I7): it is a dash and *after the close*. Spent against the plan, which was the lifted figure, is the soft panel under it.
 *
 * *This month | Last month*: Last month is the close's own figures, from balances, with how many accounts they cover, when the month was closed,
 * and the open state, as this month's, when nobody has closed it yet. It is shown only where the close can be read (an owner or a partner).
 *
 * A figure that could not be read is not shown as nothing: it says it could not be read.
 */

import { useState } from 'react';
import { formatMoney } from '../../lib/money.ts';
import type { Expense, Member, PersonalSpendPeriods } from '../../repo/types.ts';
import { Caveat } from '../../ui/primitives.tsx';
import { lastDayOf, monthWord } from './closeMonth.ts';
import { modeLine, type LastMonthView } from './lastMonth.ts';
import { monthLabel, spentShortReasons, surfaceFigures } from './monthSurface.ts';
import { useLastMonthSpend } from './useLastMonthSpend.ts';
import { useMonthTotals } from './useMonthTotals.ts';

export function MonthSurface({
  bounds,
  currency,
  expenses,
  personalSpend,
  partial,
  householdId,
  today,
  privacy,
  refreshKey,
  last,
  members = [],
  actions,
}: {
  /** The month's first and last day. */
  bounds: { readonly start: string; readonly end: string };
  /** The currency read first: the household's own, or this device's choice. Nothing is converted into it. */
  currency: string;
  /** The entries the spending screen holds, each in the currency it was entered in. */
  expenses: readonly Expense[];
  /** Other members' private sums, or null when they could not be read, which the figure must say. */
  personalSpend: PersonalSpendPeriods | null;
  /** The listing holds only the most recent entries and the month reaches back past the oldest: the figure is short by the older ones. */
  partial: boolean;
  householdId: string | null;
  today: string;
  privacy: boolean;
  /** Changes when a credit was written or changed. */
  refreshKey: unknown;
  /** Last month's view, or null where it cannot be read (the control is then not offered). */
  last?: LastMonthView | null;
  /** The household's members, for reading a month's own expenses. */
  members?: readonly Member[];
  /** The actions inside the card, under the figures: money in, the close, the way to Accounts. */
  actions?: React.ReactNode;
}) {
  const [period, setPeriod] = useState<'this' | 'last'>('this');
  const showingLast = period === 'last' && last !== undefined && last !== null;
  const span = showingLast ? { start: `${last.month}-01`, end: lastDayOf(last.month) } : bounds;
  const month = useMonthTotals(householdId, span.start, span.end, refreshKey);

  const closed = showingLast && last.kind === 'closed' ? last : null;
  const openLast = showingLast && last.kind === 'open' ? last : null;
  // A month that is not closed is read for that month itself: its own expenses and other members' private spending, not what this screen's year holds.
  const lastSpend = useLastMonthSpend(householdId, openLast === null ? null : openLast.month, members);
  const itemised =
    openLast !== null
      ? lastSpend.status === 'ready'
        ? lastSpend.itemised
        : []
      : expenses.filter((expense) => !expense.isVoided && expense.date >= span.start && expense.date <= span.end).map((expense) => expense.amount);
  const privateSpend =
    openLast !== null ? (lastSpend.status === 'ready' ? lastSpend.privateSpend : []) : showingLast ? [] : (personalSpend?.month ?? []).map((entry) => entry.total);
  const spendReady = openLast === null || lastSpend.status === 'ready';
  const unreadable = month.status === 'failed' || (openLast !== null && lastSpend.status === 'failed');
  const figures = month.status === 'ready' && spendReady ? surfaceFigures({ totals: month.totals, itemised, privateSpend, currency }) : null;
  const shortBy = spentShortReasons({ privateUnreadable: !showingLast && personalSpend === null, partial: !showingLast && partial });

  const reading = showingLast && (last.kind === 'reading' || last.kind === 'failed') ? last.kind : null;
  const noAccounts = openLast !== null && openLast.noAccounts;
  const title = !showingLast
    ? monthLabel(today)
    : last.kind === 'closed'
      ? `${monthWord(last.month)} · closed`
      : last.kind === 'open'
        ? `${monthWord(last.month)} · ${last.noAccounts ? 'from what you entered' : 'not closed yet'}`
        : monthWord(last.month);

  const waiting = (failed: boolean) => <span className="note">{failed ? 'could not be read' : 'Reading…'}</span>;

  return (
    <section className="card card-lift" aria-label={showingLast ? `${monthWord(last.month)}` : 'The month so far'}>
      <div className="flex items-center justify-between gap-3">
        <span className="label">{title}</span>
        {last !== undefined && last !== null && (
          <span className="segmented" role="group" aria-label="Month">
            <button
              type="button"
              aria-pressed={period === 'this'}
              onClick={() => {
                setPeriod('this');
              }}
            >
              This month
            </button>
            <button
              type="button"
              aria-pressed={period === 'last'}
              onClick={() => {
                setPeriod('last');
              }}
            >
              Last month
            </button>
          </span>
        )}
      </div>
      <dl className="mt-2.5 grid gap-x-4 gap-y-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 6.25rem), 1fr))' }}>
        <div>
          <dt className="label">Came in</dt>
          <dd className="stat-card-value tabular-nums" data-testid="month-came-in">
            {closed !== null
              ? closed.cameIn.map((line) => (
                  <span key={line.currency} className="block">
                    {formatMoney(line, { privacy })}
                  </span>
                ))
              : reading !== null
                ? waiting(reading === 'failed')
                : figures === null
                  ? waiting(unreadable)
                  : figures.cameIn.map((line) => (
                      <span key={line.currency} className="block">
                        {formatMoney(line, { privacy })}
                      </span>
                    ))}
          </dd>
          <dd className="note">counts every kind but refunds</dd>
        </div>
        <div>
          <dt className="label">Spent</dt>
          <dd className="stat-card-value tabular-nums" data-testid="month-spent">
            {closed !== null ? (
              <>
                {closed.spent.map((line) => (
                  <span key={line.currency} className="block">
                    {formatMoney(line, { privacy })}
                  </span>
                ))}
                {/* What the close says beside its own figure: loan payments are not read yet, and a purchase or a sale that named no account is still in spent. */}
                <Caveat tone="info" label="What spent from balances leaves out">
                  <span className="block">Loan payments are not read yet, so a loan paid from these accounts is counted as spent, and saved reads low by it.</span>
                  {closed.unnamedEntries > 0 && (
                    <span className="block">
                      {String(closed.unnamedEntries)} {closed.unnamedEntries === 1 ? 'entry' : 'entries'} in Holdings that month (a purchase, a sale or a PPF payment) named no account,
                      so a purchase among them reads as spent. Open it in Holdings and say which account.
                    </span>
                  )}
                </Caveat>
              </>
            ) : reading !== null ? (
              waiting(reading === 'failed')
            ) : figures === null ? (
              waiting(unreadable)
            ) : (
              <>
                {figures.spent.map((line) => (
                  <span key={line.currency} className="block">
                    {formatMoney(line, { privacy })}
                  </span>
                ))}
                {/* What may make the figure short rides on the figure, not in a footnote (Pass 4: refuse, do not guess). */}
                {shortBy.reasons.length > 0 && (
                  <Caveat tone={shortBy.fixable ? 'warn' : 'info'} label="Why spent may be short">
                    {shortBy.reasons.map((reason) => (
                      <span key={reason} className="mb-1.5 block">
                        {reason}
                      </span>
                    ))}
                  </Caveat>
                )}
              </>
            )}
          </dd>
          {(closed !== null || (reading === null && figures !== null)) && (
            <dd className="note">{closed !== null ? 'from balances' : noAccounts ? 'from what you entered' : 'itemised so far'}</dd>
          )}
        </div>
        <div>
          <dt className="label">Saved</dt>
          {closed !== null ? (
            <>
              <dd className="stat-card-value tabular-nums" data-testid="month-saved">
                {closed.saved.map((line) => (
                  <span key={line.currency} className="block">
                    {formatMoney(line, { privacy })}
                  </span>
                ))}
              </dd>
              <dd className="note">{modeLine(closed.counted, closed.total)}</dd>
            </>
          ) : reading !== null || (showingLast && figures === null) ? (
            // Still being read, or not readable: neither an open month's dash nor a figure.
            <dd className="stat-card-value" data-testid="month-saved">
              {waiting(reading === 'failed' || unreadable)}
            </dd>
          ) : (
            <>
              <dd className="stat-card-value absent" data-testid="month-saved">
                <span aria-hidden="true">—</span>
                <span className="sr-only">not shown until the month is closed</span>
              </dd>
              <dd className="note">{noAccounts ? 'Add an account to close months from balances' : 'after the close'}</dd>
            </>
          )}
        </div>
      </dl>
      <p className="note mt-2.5">
        Refunds take away from spent. Money moved between your own accounts, and into holdings, is in neither.
        {closed !== null && closed.saved.some((line) => line.minor < 0n) && ` More went out than came in${closed.saved.length > 1 ? ` in ${closed.saved.filter((line) => line.minor < 0n).map((line) => line.currency).join(' and ')}` : ', so nothing was saved'}.`}
        {!showingLast && month.status === 'failed' && 'Came in could not be read just now; reload to read it again.'}
        {showingLast && (reading === 'failed' || unreadable) && ' Last month could not be read just now; reload to read it again.'}
      </p>
      {actions !== undefined && <div className="mt-3 flex flex-col gap-2.5">{actions}</div>}
    </section>
  );
}
