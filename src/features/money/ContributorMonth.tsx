/**
 * A contributor's month card (docs/design/spending-capture.md section 11.4; the MoneyMonthStated boards, screen 7): *Spent by you*, itemised by you, for This month or
 * Last month, and one line saying who keeps the household's month.
 *
 * A contributor reads their own entries and no household total, so there is no Came in, no Saved, no stated figure, no close and no action: a card that offered a
 * button it would refuse would read as broken. The line says why there is nothing more, so the card reads as intended (SC-I19). A failed read says it could not be
 * read, and is never a month of nothing.
 */

import { useEffect, useState } from 'react';
import { addMonths } from '../../domain/accrual.ts';
import { monthBounds } from '../../domain/budget.ts';
import { formatMoney, type Money } from '../../lib/money.ts';
import { listExpensesBetween } from '../../repo/expenses.ts';
import type { Credit, Expense, Member } from '../../repo/types.ts';
import { monthWord } from './closeMonth.ts';
import { ownMonthSpend } from './contributorMonth.ts';
import { monthLabel } from './monthSurface.ts';

type Read = { readonly status: 'loading' } | { readonly status: 'failed' } | { readonly status: 'ready'; readonly expenses: readonly Expense[] };

export function ContributorMonth({
  householdId,
  memberId,
  members,
  today,
  currency,
  privacy,
  credits = [],
}: {
  householdId: string;
  memberId: string;
  members: readonly Member[];
  today: string;
  /** The currency read first. */
  currency: string;
  privacy: boolean;
  /** The credits the contributor can read, for the refunds that take away from what they spent. */
  credits?: readonly Credit[];
}) {
  const [period, setPeriod] = useState<'this' | 'last'>('this');
  const month = period === 'this' ? today.slice(0, 7) : addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const bounds = monthBounds(`${month}-01`);
  const [read, setRead] = useState<Read & { readonly key?: string }>({ status: 'loading' });
  const key = `${householdId}|${month}`;

  useEffect(() => {
    let live = true;
    listExpensesBetween({ householdId, from: bounds.start, to: bounds.end, members })
      .then((expenses) => {
        if (live) setRead({ status: 'ready', key, expenses });
      })
      .catch(() => {
        if (live) setRead({ status: 'failed', key });
      });
    return () => {
      live = false;
    };
    // The month is the key; its bounds follow from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, members]);

  const current = read.key === key ? read : ({ status: 'loading' } as const);
  const lines: readonly Money[] | null = current.status === 'ready' ? ownMonthSpend({ expenses: current.expenses, refunds: credits, memberId, bounds, currency }) : null;
  const title = period === 'this' ? monthLabel(today) : monthWord(month);

  return (
    <section className="card card-lift" aria-label={period === 'this' ? 'The month so far' : monthWord(month)}>
      <div className="flex items-center justify-between gap-3">
        <span className="label">{title}</span>
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
      </div>
      <dl className="mt-2.5">
        <dt className="label">Spent by you</dt>
        <dd className="stat-card-value tabular-nums" data-testid="own-month-spent">
          {lines !== null ? (
            lines.map((line) => (
              <span key={line.currency} className="block">
                {formatMoney(line, { privacy })}
              </span>
            ))
          ) : (
            <span className="note">{current.status === 'failed' ? 'could not be read' : 'Reading…'}</span>
          )}
        </dd>
        {lines !== null && <dd className="note">itemised by you</dd>}
      </dl>
      {current.status === 'failed' && <p className="note mt-2.5">This month could not be read just now; reload to read it again.</p>}
      <p className="note mt-2.5">The household&rsquo;s month, its total and how it was worked out are kept by the owner and the partner.</p>
    </section>
  );
}
