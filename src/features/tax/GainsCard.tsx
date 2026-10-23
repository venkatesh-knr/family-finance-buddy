/**
 * Capital gains for the year, and the allowance, in one card.
 *
 * Long and short term, net and taxable, as the board draws them; under them the long-term equity allowance as one
 * bar with what is left of it. The tax these gains come to is not a figure of its own here: it is a line in
 * "How it adds up" on the estimate above, where it is added to the tax on the income and rated with it.
 *
 * Gold and unlisted shares are a second group, drawn only when there is something in it: they have no allowance, a
 * different long-term period and a short-term gain taxed at the slab, which the first group does not.
 *
 * A figure that cannot be given is "—" with the reason beside it (`Absent`), never a zero: no rule for the
 * allowance covering the year means what is taxable cannot be said, and nothing is assumed in its place.
 */

import type { CapitalGains, CapitalGainsTax } from '../../domain/capital-gains.ts';
import type { Money } from '../../lib/money.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { Absent, Bar, Caveat, Notice, Qualifier, Stat } from '../../ui/primitives.tsx';

/** A gain or loss with its sign written out: the direction is never carried by colour alone. */
export function signed(value: Money, privacy: boolean): string {
  const sign = value.minor < 0n ? '−' : value.minor > 0n ? '+' : '';
  const size = money(value.minor < 0n ? -value.minor : value.minor, value.currency);
  return `${sign}${formatMoney(size, { privacy })}`;
}

/** A net gain or loss, with the tone that agrees with its sign. */
const toneOf = (value: Money): 'plain' | 'gain' | 'loss' =>
  value.minor > 0n ? 'gain' : value.minor < 0n ? 'loss' : 'plain';

/** A rate as a person reads it: `12.500` is 12.5%, `20.000` is 20%. */
const rateText = (ratePct: string): string => `${String(Number(ratePct))}%`;

export function GainsCard({
  gains,
  tax,
  inProgress,
  lastDay,
  privacy,
}: {
  gains: CapitalGains;
  tax: CapitalGainsTax;
  inProgress: boolean;
  /** The last day of the tax year, as it is written ("31 Mar"). */
  lastDay: string;
  privacy: boolean;
}) {
  const allowance = gains.equityLong.exemption;
  const otherActivity = gains.otherLong.net.minor !== 0n || gains.otherShort.net.minor !== 0n;
  const lossesSetOff = money(gains.losses.short.setOff.minor + gains.losses.long.setOff.minor, 'INR');
  const unused = allowance === null ? null : money(allowance.available.minor - allowance.used.minor, 'INR');

  return (
    <section className="card" aria-label="Capital gains">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="card-title font-sans">Capital gains</h2>
        <span className="note">netted across classes</span>
      </header>

      {otherActivity && <h3 className="label mt-3.5">Listed shares and equity funds</h3>}
      <dl className="tax-stats">
        <Stat label="Long term, net" tone={toneOf(gains.equityLong.net)}>
          {signed(gains.equityLong.net, privacy)}
        </Stat>
        <Stat label="Short term, net" tone={toneOf(gains.equityShort.net)}>
          {signed(gains.equityShort.net, privacy)}
        </Stat>
        <Stat label="Taxable, long term">
          {tax.equityLong === null ? (
            <Absent tone="info" label="Why long-term tax is not shown">
              No rule for the equity allowance covers this tax year, so what is taxable long term cannot be said.
              Nothing is assumed in its place.
            </Absent>
          ) : (
            <>
              {formatMoney(tax.equityLong.taxable, { privacy })}
              {tax.equityLong.ratePct !== null && (
                <>
                  {' '}
                  <Qualifier word="at">{rateText(tax.equityLong.ratePct)}</Qualifier>
                </>
              )}
            </>
          )}
        </Stat>
        <Stat label="Taxable, short term">
          {formatMoney(tax.equityShort.taxable, { privacy })}
          {tax.equityShort.ratePct !== null && (
            <>
              {' '}
              <Qualifier word="at">{rateText(tax.equityShort.ratePct)}</Qualifier>
            </>
          )}
        </Stat>
      </dl>

      <div className="tax-allowance">
        {allowance === null ? (
          <div className="flex items-center justify-between gap-2">
            <span className="note">Long-term allowance</span>
            <Absent tone="info" label="Why the allowance is not shown">
              No rule for the equity allowance covers this tax year, so what is taxable cannot be said. Nothing is
              assumed in its place.
            </Absent>
          </div>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-caption">
              <span style={{ color: 'var(--ink-2)' }}>Long-term allowance</span>
              <span className="tabular-nums">
                {formatMoney(allowance.used, { privacy })}{' '}
                <Qualifier word="of">{formatMoney(allowance.available, { privacy })}</Qualifier>
              </span>
            </p>
            <div className="bar-thin mt-2">
              <Bar
                value={Number(allowance.used.minor)}
                target={Number(allowance.available.minor)}
                label="Long-term equity allowance used"
                colour="var(--brass)"
              />
            </div>
            {unused !== null && unused.minor > 0n && (
              <div className="tax-unused tabular-nums">
                {formatMoney(unused, { privacy })} {inProgress ? `unused · lapses on ${lastDay}` : 'went unused'}
                <Caveat tone="info" label="What counts as used">
                  Only gains already realised by a sale. An unrealised gain is not used and does not reduce what is
                  left. It applies to equity alone — gold and unlisted shares do not use it.
                </Caveat>
              </div>
            )}
          </>
        )}
      </div>

      {otherActivity && (
        <div className="tax-allowance">
          <h3 className="label">
            Gold and unlisted shares
            <Caveat tone="info" label="How these differ from equity">
              Long term is two years, not one, and the gain is taxed at 12.5% with no allowance — the ₹1.25 lakh
              belongs to equity alone. A short-term gain is taxed at your slab rate, which depends on the rest of
              your income.
            </Caveat>
          </h3>
          <dl className="tax-stats">
            <Stat label="Long term, net" tone={toneOf(gains.otherLong.net)}>
              {signed(gains.otherLong.net, privacy)}
            </Stat>
            <Stat label="Taxable, long term">
              {formatMoney(tax.otherLong.taxable, { privacy })}
              {tax.otherLong.ratePct !== null && (
                <>
                  {' '}
                  <Qualifier word="at">{rateText(tax.otherLong.ratePct)}</Qualifier>
                </>
              )}
            </Stat>
            <Stat label="Short term, net" tone={toneOf(gains.otherShort.net)}>
              {signed(gains.otherShort.net, privacy)}
            </Stat>
            <Stat label="Added to income, at your slab">
              {formatMoney(tax.otherShortAtSlab, { privacy })}
              <Caveat tone="info" label="Why this has no tax figure of its own">
                A short-term gain on gold or unlisted shares is added to your income and taxed at your slab rate,
                so it has no rate of its own. It is inside the estimate above, on top of the income you type.
              </Caveat>
            </Stat>
          </dl>
        </div>
      )}

      {lossesSetOff.minor > 0n && (
        <dl className="tax-allowance">
          <Stat label="Losses set off">
            {formatMoney(lossesSetOff, { privacy })}
            <Caveat tone="info" label="How losses were set off">
              A long-term loss can only reduce a long-term gain, so it is used first. A short-term loss then goes
              against what is left — equity short term, then short-term gold and unlisted, then long-term gold and
              unlisted, then long-term equity, where the allowance may already cover it. The Act lets you choose
              the order; this is the one used here, and your CA may choose another.
            </Caveat>
          </Stat>
        </dl>
      )}

      {gains.losses.short.unrelieved !== null && (
        <div className="mt-3.5">
          <Notice>
            {formatMoney(gains.losses.short.unrelieved, { privacy })} of short-term loss is left after set-off. It
            is not carried forward anywhere in this app yet — note it for next year&rsquo;s return, and file on
            time, because a late return forfeits it.
          </Notice>
        </div>
      )}
      {gains.losses.long.unrelieved !== null && (
        <div className="mt-3.5">
          <Notice>
            {formatMoney(gains.losses.long.unrelieved, { privacy })} of long-term loss is left, with no long-term
            gain to reduce. It is not carried forward anywhere in this app yet — note it for next year&rsquo;s
            return, and file on time, because a late return forfeits it.
          </Notice>
        </div>
      )}
    </section>
  );
}
