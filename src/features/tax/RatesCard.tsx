/**
 * The rates a tax year rated the figure with, folded away until asked for.
 *
 * Read from the same rows the calculation used (`ratesApplied`), so it cannot
 * say one thing while the figure above it did another. It is here for the
 * person who wants to see why the number is the number, and for the CA who will
 * check it: the bands, the rebate, the standard deduction, the surcharge and the
 * cess, and where each is meant to come from.
 *
 * Closed by default. Most visits want the figure, not the table behind it.
 */

import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money } from '../../lib/money.ts';
import type { AppliedBand, RatesApplied } from '../../domain/income-tax.ts';
import { Table } from '../../ui/primitives.tsx';

const inr = (minor: bigint): string => formatMoney(money(minor, 'INR'));

/** 12.500 as 12.5 and 5.000 as 5: the column carries three places so 12.5 is exact, and nobody reads them. */
function pct(rate: string): string {
  return rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate;
}

function range(band: AppliedBand): string {
  return band.toMinor === null ? `Above ${inr(band.fromMinor)}` : `${inr(band.fromMinor)} to ${inr(band.toMinor)}`;
}

export function RatesCard({ applied }: { applied: RatesApplied }): React.JSX.Element | null {
  // A year no rule covers has nothing to show. The refusal above says so; a card
  // of empty rows would only repeat it.
  if (applied.slabs.length === 0) return null;

  const years = `${String(applied.fy)}–${String((applied.fy + 1) % 100).padStart(2, '0')}`;
  const regime = applied.regime === 'new' ? 'new regime' : 'old regime';

  return (
    <details className="mt-3">
      <summary className="notice-toggle">
        Rates applied for {years}, {regime}
      </summary>

      <div className="mt-2.5 flex flex-col gap-3.5">
        <Table label={`Income tax slabs, ${years}, ${regime}`}>
          <thead>
            <tr>
              <th scope="col">Income</th>
              <th scope="col" className="num-col">
                Rate
              </th>
            </tr>
          </thead>
          <tbody>
            {applied.slabs.map((band) => (
              <tr key={band.fromMinor.toString()}>
                <td>{range(band)}</td>
                <td className="num-col">{pct(band.ratePct)}%</td>
              </tr>
            ))}
          </tbody>
        </Table>

        <dl className="flex flex-col gap-2">
          {applied.rebate !== null && (
            <div>
              <dt className="label">Rebate</dt>
              <dd>
                Up to {inr(applied.rebate.maxMinor)} off the tax, when total income is{' '}
                {inr(applied.rebate.ceilingMinor)} or less.
              </dd>
            </div>
          )}
          {applied.standardDeductionMinor !== null && (
            <div>
              <dt className="label">Standard deduction</dt>
              <dd>{inr(applied.standardDeductionMinor)}, from salary only.</dd>
            </div>
          )}
          {applied.surcharge.length > 0 && (
            <div>
              <dt className="label">Surcharge, on the tax</dt>
              <dd>
                {applied.surcharge.map((tier, at) => (
                  <span key={tier.fromMinor.toString()}>
                    {at > 0 && '; '}
                    {pct(tier.ratePct)}% {tier.toMinor === null ? `above ${inr(tier.fromMinor)}` : `from ${inr(tier.fromMinor)}`}
                  </span>
                ))}
                . Reduced by marginal relief just above each threshold.
              </dd>
            </div>
          )}
          {applied.cessPct !== null && (
            <div>
              <dt className="label">Cess</dt>
              <dd>{pct(applied.cessPct)}% on the tax and surcharge.</dd>
            </div>
          )}
        </dl>

        <p className="note">
          {applied.authorities.length > 0 && <>From {applied.authorities.join('; ')}. </>}
          {applied.verifiedOn === null
            ? 'Nobody has recorded checking all of these against the law.'
            : `The oldest of them was last checked on ${formatIsoDate(applied.verifiedOn)}.`}{' '}
          Rates are set by a reviewed change to the app, never fetched.
        </p>
      </div>
    </details>
  );
}
