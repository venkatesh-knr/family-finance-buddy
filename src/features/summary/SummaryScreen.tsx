/**
 * The household summary: what a contributor or a viewer is given of the whole.
 *
 * Sums by category and by kind, from the two definer functions. Never a row, a
 * payee, a holding or a member: those the database does not let this role read
 * (`20260925120000_narrow_reads.sql`), and this screen is what is left that is
 * true for everybody who may see a household at all.
 *
 * Per currency and never converted. A summary that needed an exchange rate
 * would have to invent one for somebody who cannot see how it was chosen.
 */

import { useEffect, useMemo, useState } from 'react';
import { monthBounds } from '../../domain/budget.ts';
import {
  recentMonths,
  summariseAssets,
  summariseSpending,
  type AssetGroup,
  type SpendingGroup,
} from '../../domain/summary.ts';
import { istCalendarDate } from '../../lib/dates.ts';
import { formatMoney } from '../../lib/money.ts';
import { householdAssets, householdSpending } from '../../repo/summary.ts';
import { AssetTile } from '../../ui/AssetTile.tsx';
import { kindLabel } from '../../ui/labels.ts';
import { Card, Caveat, Problem } from '../../ui/primitives.tsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthName(firstOfMonth: string): string {
  return `${MONTHS[Number(firstOfMonth.slice(5, 7)) - 1] ?? ''} ${firstOfMonth.slice(0, 4)}`;
}

export function SummaryScreen({
  privacy,
  householdId,
  role,
}: {
  privacy: boolean;
  householdId: string | null;
  role: string | null;
}) {
  // Read once at the edge; everything below takes the date as an argument.
  const [today] = useState(() => istCalendarDate(new Date()));
  const months = useMemo(() => recentMonths(today, 6), [today]);
  const [month, setMonth] = useState(months[0] ?? today);

  const [spending, setSpending] = useState<readonly SpendingGroup[] | null>(null);
  const [assets, setAssets] = useState<readonly AssetGroup[] | null>(null);
  const [spendingProblem, setSpendingProblem] = useState<string | null>(null);
  const [assetsProblem, setAssetsProblem] = useState<string | null>(null);

  // The assets do not depend on the month, so they are not refetched with it.
  useEffect(() => {
    if (householdId === null) return;
    let live = true;
    setAssets(null);
    setAssetsProblem(null);
    householdAssets(householdId)
      .then((rows) => {
        if (live) setAssets(summariseAssets(rows));
      })
      .catch((error: unknown) => {
        if (live) setAssetsProblem(error instanceof Error ? error.message : 'Could not read the holdings summary.');
      });
    return () => {
      live = false;
    };
  }, [householdId]);

  useEffect(() => {
    if (householdId === null) return;
    let live = true;
    setSpending(null);
    setSpendingProblem(null);
    const { start, end } = monthBounds(month);
    householdSpending({ householdId, from: start, to: end })
      .then((rows) => {
        if (live) setSpending(summariseSpending(rows));
      })
      .catch((error: unknown) => {
        if (live) setSpendingProblem(error instanceof Error ? error.message : 'Could not read the spending summary.');
      });
    return () => {
      live = false;
    };
  }, [householdId, month]);

  if (householdId === null) return <p className="note px-4.5 py-4.5">Loading…</p>;

  return (
    <div className="flex flex-col gap-4.5">
      <Card
        title="Household spending"
        aside={
          <span className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-2">
              <span className="label">Month</span>
              <select
                className="field w-[130px]"
                value={month}
                onChange={(event) => {
                  setMonth(event.target.value);
                }}
              >
                {months.map((first) => (
                  <option key={first} value={first}>
                    {monthName(first)}
                  </option>
                ))}
              </select>
            </label>
            <Caveat tone="info" label="What is counted here">
              The entries the household has shared, by category, for the month. A member&rsquo;s
              private spending is theirs and is not in these figures. Each currency is totalled on
              its own, never converted. A voided entry is not counted.
              {role === 'viewer' && ' You can see this summary and nothing else of the household.'}
              {role === 'contributor' && ' Your own entries are on the Expenses screen.'}
            </Caveat>
          </span>
        }
      >
        {spendingProblem !== null ? (
          <Problem>{spendingProblem}</Problem>
        ) : spending === null ? (
          <p className="note">Loading…</p>
        ) : spending.length === 0 ? (
          <p className="note">Nothing shared was spent in {monthName(month)}.</p>
        ) : (
          <div className="flex flex-col gap-4.5">
            {spending.map((group) => (
              <section key={group.currency}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="label">{group.currency}</h3>
                  <span className="tabular-nums" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                    {formatMoney(group.total, { privacy })}
                  </span>
                </div>
                <ul className="row-separated mt-1.5">
                  {group.rows.map((row) => (
                    <li
                      key={row.categoryId ?? 'uncategorised'}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2"
                    >
                      <span style={{ color: row.categoryId === null ? 'var(--muted)' : 'var(--ink)' }}>
                        {row.name}
                      </span>
                      <span className="tabular-nums">
                        {formatMoney(row.total, { privacy })}{' '}
                        <span className="note">{(row.share * 100).toFixed(0)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="What the household holds"
        aside={
          <Caveat tone="info" label="What is counted here">
            Holdings the household has shared, by kind, at their latest reading. A holding a member
            has marked private is not itemised for anybody: a kind with one private holding in it
            would give it away. Each currency is totalled on its own, never converted.
          </Caveat>
        }
      >
        {assetsProblem !== null ? (
          <Problem>{assetsProblem}</Problem>
        ) : assets === null ? (
          <p className="note">Loading…</p>
        ) : assets.length === 0 ? (
          <p className="note">Nothing shared has been valued yet.</p>
        ) : (
          <div className="flex flex-col gap-4.5">
            {assets.map((group) => (
              <section key={group.currency}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="label">{group.currency}</h3>
                  <span className="tabular-nums" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                    {formatMoney(group.total, { privacy })}
                  </span>
                </div>
                <ul className="mt-1.5">
                  {group.rows.map((row) => (
                    <li key={row.kind} className="alloc-row">
                      <AssetTile kind={row.kind} />
                      <span className="min-w-0">
                        <span className="alloc-name block">{kindLabel(row.kind)}</span>
                        <span className="alloc-share block">{(row.share * 100).toFixed(1)}% of what is valued</span>
                      </span>
                      <span className="alloc-figures">
                        <span className="alloc-value">{formatMoney(row.total, { privacy })}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {group.unvalued > 0 && (
                  <p className="note mt-1.5">
                    {group.unvalued} {group.unvalued === 1 ? 'holding has' : 'holdings have'} never
                    been valued, so this total is short by whatever {group.unvalued === 1 ? 'it is' : 'they are'}{' '}
                    worth. {group.unvalued === 1 ? 'It is' : 'They are'} left out rather than counted as zero.
                  </p>
                )}
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
