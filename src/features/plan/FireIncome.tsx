/**
 * What comes in, on FIRE (docs/design/ledger-income.md section 7; the FireIncome and FireBusiness boards).
 *
 * FIRE only reads income, and income is entered in Money. Mine is the usual month's salary times twelve plus business income over the last
 * twelve complete months, with the working under the figure and the months it came from, each marked in words. Household is the sum over the
 * earners, from the sum function, and lists no member's months, because a total and your own share reveal the other person's: that is the
 * price of a household total, and the screen says so. Neither is ever grown by inflation. With nothing to read it says so and links to Money;
 * it never shows nothing as a figure, and it names income in another currency rather than dropping it. *A year, side by side* is a panel of its
 * own, arithmetic only: FIRE never says what to do with the difference.
 */

import { useState } from 'react';
import { hashFor } from '../../app/route.ts';
import { formatMoney, type Money } from '../../lib/money.ts';
import { householdIncomeView, mineIncomeView, otherCurrencyIncome, sideBySide, type BusinessView, type MineIncomeView } from './fireIncome.ts';
import { useFireIncome } from './useFireIncome.ts';

type Scope = 'mine' | 'household';

/** What the income is made of, for the label under *comes in* in the side-by-side panel. */
function comesFrom(view: MineIncomeView): 'salary' | 'business' | 'both' {
  const salary = view.salary !== null;
  const business = view.business !== null && view.business.yearly !== null && view.business.yearly.minor > 0n;
  return salary && business ? 'both' : business ? 'business' : 'salary';
}

export function FireIncome({
  householdId,
  currency,
  memberId,
  mayAskHousehold,
  severalMembers,
  canRecord,
  annualExpense,
  planIncomplete,
  privacy,
}: {
  householdId: string | null;
  /** The household's own currency: income is read in the currency it came in, and nothing is converted. */
  currency: string;
  /** Whose income Mine is: the viewer's. */
  memberId: string;
  /** An owner or a partner may ask for the household's total. */
  mayAskHousehold: boolean;
  /** A household of one has nothing to switch between. */
  severalMembers: boolean;
  /** Whether the viewer can enter money: a viewer is not sent to a form they cannot use. */
  canRecord: boolean;
  /** The year's spending from the plan, for *a year, side by side*; null when the plan has nothing in it. */
  annualExpense: Money | null;
  /** Some categories have nothing planned, so the plan's year is short by them. */
  planIncomplete: boolean;
  privacy: boolean;
}) {
  const data = useFireIncome(householdId, mayAskHousehold);
  const [scope, setScope] = useState<Scope>('mine');

  if (data.status === 'loading') return null;
  if (data.status === 'failed') {
    return (
      <section className="card" aria-label="What comes in">
        <h2 className="card-title font-sans">Your income, a year</h2>
        <p className="note mt-1">
          The income entered in Money could not be read just now, so FIRE shows its number without a yearly income. That is a fault, not an answer:
          reload to read it again.
        </p>
      </section>
    );
  }

  const show = (value: Money): string => formatMoney(value, { privacy });
  const inHousehold = scope === 'household' && mayAskHousehold && severalMembers;
  const mine = mineIncomeView(data.credits, memberId, currency, data.today, privacy);
  const householdTotals = data.household === null || data.household === 'failed' ? null : data.household;
  const householdLine = householdTotals?.find((line) => line.yearlySalary.currency === currency) ?? null;
  const household = householdIncomeView(householdLine === null ? null : { yearlySalary: householdLine.yearlySalary, yearlyBusiness: householdLine.yearlyBusiness });
  const view = inHousehold ? household : mine;
  const others = inHousehold
    ? [...new Set((householdTotals ?? []).filter((line) => line.yearlySalary.currency !== currency && (line.yearlySalary.minor > 0n || line.yearlyBusiness.minor > 0n)).map((line) => line.yearlySalary.currency))].sort()
    : otherCurrencyIncome(data.credits, memberId, currency);
  const side = sideBySide(view.total, annualExpense, inHousehold ? 'household' : comesFrom(mine));
  const waiting = !inHousehold && mine.business?.kind === 'waiting';
  const businessMonths = (business: BusinessView) => business.months;

  return (
    <>
      <section className="card" aria-label="What comes in">
        <div className="flex items-center justify-between gap-3">
          <h2 className="card-title font-sans">{inHousehold ? 'Household income, a year' : 'Your income, a year'}</h2>
          {mayAskHousehold && severalMembers && (
            <span className="segmented" role="group" aria-label="Whose income">
              <button
                type="button"
                aria-pressed={scope === 'mine'}
                onClick={() => {
                  setScope('mine');
                }}
              >
                Mine
              </button>
              <button
                type="button"
                aria-pressed={scope === 'household'}
                onClick={() => {
                  setScope('household');
                }}
              >
                Household
              </button>
            </span>
          )}
        </div>

        {inHousehold && data.household === 'failed' ? (
          <p className="note mt-2">The household’s income could not be read just now, so none is shown. That is a fault, not an answer: reload to read it again.</p>
        ) : view.kind === 'none' ? (
          <>
            <p className="mt-2">FIRE shows your number without a yearly income.</p>
            <p className="note mt-1">
              {waiting
                ? (mine.business?.working ?? '')
                : 'No Salary credit counts yet, and no business income within the last twelve complete months. It is not counted as nothing.'}
              {canRecord && (
                <>
                  {' '}
                  <a className="underline" href={hashFor('money')}>
                    Add money in on Money
                  </a>
                  .
                </>
              )}
            </p>
          </>
        ) : (
          <>
            <p className="tabular-nums mt-2" style={{ fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.15 }} data-testid="fire-income-total">
              {show(view.total as Money)}
            </p>
            <p className="note">a year, never grown by inflation</p>

            {inHousehold && (
              <>
                <ul className="recent-rows mt-2" aria-label="The household's income">
                  {household.lines.map((line) => (
                    <li key={line.label} className="flex items-baseline justify-between gap-3 py-2">
                      <span>{line.label}</span>
                      <span className="tabular-nums">{show(line.amount)}</span>
                    </li>
                  ))}
                </ul>
                <p className="note mt-1">
                  The sum of each earner’s yearly salary and business income. No member’s months are listed: with two earners, a total and your own share
                  reveal the other person’s. That is the price of a household total.
                </p>
              </>
            )}

            {!inHousehold && (
              <>
                {mine.salary !== null && mine.business !== null && mine.business.yearly !== null && mine.business.yearly.minor > 0n && (
                  <ul className="recent-rows mt-2" aria-label="What it is made of">
                    <li className="flex items-baseline justify-between gap-3 py-2">
                      <span>Salary</span>
                      <span className="tabular-nums">{show(mine.salary.yearly)}</span>
                    </li>
                    <li className="flex items-baseline justify-between gap-3 py-2">
                      <span>Business income</span>
                      <span className="tabular-nums">{show(mine.business.yearly)}</span>
                    </li>
                    <li className="flex items-baseline justify-between gap-3 py-2">
                      <span>Comes in, a year</span>
                      <span className="tabular-nums">
                        {show(view.total as Money)}
                        <span className="note"> · the two added</span>
                      </span>
                    </li>
                  </ul>
                )}

                {mine.salary !== null && (
                  <section aria-label="Salary" className="mt-3 flex flex-col gap-1">
                    <h3 className="label">Salary</h3>
                    <p className="tabular-nums">{mine.salary.working}</p>
                    <p className="note">{mine.salary.origin}</p>
                    <ul className="recent-rows mt-1" aria-label="The months it came from">
                      {mine.salary.months.map((month) => (
                        <li key={month.label} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                          <span>{month.label}</span>
                          <span className="tabular-nums">
                            {show(month.amount)}
                            <span className="note">
                              {' '}
                              · {month.usual ? '✓ ' : ''}
                              {month.mark}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {mine.business !== null && mine.business.kind !== 'waiting' && mine.business.yearly !== null && (
                  <section aria-label="Business income" className="mt-3 flex flex-col gap-1">
                    <h3 className="label">Business income</h3>
                    <p className="tabular-nums">
                      {show(mine.business.yearly)}
                      <span className="note"> · {mine.business.working}</span>
                    </p>
                    {mine.business.window !== null && <p className="note">{mine.business.window}</p>}
                    <ul className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2" aria-label="The months it came from">
                      {businessMonths(mine.business).map((month) => (
                        <li key={month.label} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
                          <span>{month.label}</span>
                          {month.note === null ? <span className="tabular-nums">{show(month.amount)}</span> : <span className="note">{month.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {waiting && <p className="note mt-3">{mine.business?.working}</p>}
                {canRecord && (
                  <p className="note mt-3">
                    <a className="underline" href={hashFor('money')}>
                      Change it in Money
                    </a>
                  </p>
                )}
              </>
            )}
          </>
        )}

        {others.length > 0 && (
          <p className="note mt-3">
            Income in {others.join(' and ')} is not in this figure: FIRE reads income in {currency} and converts none.
          </p>
        )}
      </section>

      {side !== null && (
        <section className="card" aria-label="A year, side by side">
          <h2 className="card-title font-sans">A year, side by side</h2>
          <dl className="mt-1 flex flex-col">
            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt>
                Comes in
                <span className="note block">{side.comesInNote}</span>
              </dt>
              <dd className="tabular-nums">{show(side.comesIn)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t py-2" style={{ borderColor: 'var(--line)' }}>
              <dt>
                Spent
                <span className="note block">from your plan</span>
              </dt>
              <dd className="tabular-nums">{show(side.spent)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t py-2" style={{ borderColor: 'var(--line)' }}>
              <dt>
                Difference
                <span className="note block">{side.note}</span>
              </dt>
              <dd className="tabular-nums">{show(side.difference)}</dd>
            </div>
          </dl>
          {planIncomplete && <p className="note">Some categories in the plan have nothing planned, so what is spent is short by them.</p>}
        </section>
      )}
    </>
  );
}
