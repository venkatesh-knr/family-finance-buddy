/**
 * Tax — a working paper for one person's capital gains.
 *
 * "It fills the schedules, it does not file the return." Everything here is the
 * household's own numbers arranged the way a return asks for them, with the
 * working shown and the sale behind every figure listed underneath it. It is
 * not tax advice, not a filing, and not a substitute for a CA — and it says so
 * on the screen, because a figure on a page called Tax will be read as
 * authoritative whatever the small print says.
 *
 * ── one person, not the household ───────────────────────────────────────
 *
 * Tax is filed per taxpayer, and the ₹1.25 lakh allowance is each person's
 * own. Netting the household once would give two people one allowance between
 * them, or set one person's loss against another's gain. So the screen asks
 * whose return it is, and starts with yours.
 *
 * ── what it nets, and what it lists but will not ────────────────────────
 *
 * Listed equity, equity funds, gold and unlisted shares, netted together under
 * the Act's set-off rules. Foreign shares, debt funds, property, a matured gold
 * bond, and gifts and transfers are listed, each with the specific reason it is
 * not in the figures — never dropped, and never guessed at. Salary, the slabs,
 * surcharge and cess, the regime comparison and losses brought forward are all
 * still to come, and the screen lists them, so a page that computes one head is
 * never read as the whole return.
 */

import { useMemo, useState } from 'react';
import { capitalGainsTax, netCapitalGains, type ExclusionReason } from '../../domain/capital-gains.ts';
import { taxYearBounds, taxYearOf } from '../../domain/budget.ts';
import { daysBetween, formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money, type Money } from '../../lib/money.ts';
import { taxClassLabel } from '../../ui/labels.ts';
import { Bar, Card, Caveat, Notice, Pill, Problem, Stat } from '../../ui/primitives.tsx';
import { useHoldings } from '../holdings/useHoldings.ts';
import { IncomeTaxCard } from './IncomeTaxCard.tsx';
import { taxLotsFor, type TaxLot } from './taxLots.ts';

/** A gain or loss with its sign written out: the direction is never carried by colour alone. */
function signed(value: Money, privacy: boolean): string {
  const sign = value.minor < 0n ? '−' : value.minor > 0n ? '+' : '';
  const size = money(value.minor < 0n ? -value.minor : value.minor, value.currency);
  return `${sign}${formatMoney(size, { privacy })}`;
}

/** A rate as a person reads it: `12.500` is 12.5%, `20.000` is 20%. */
const rateText = (ratePct: string): string => `${String(Number(ratePct))}%`;

const STILL_TO_COME: readonly string[] = [
  'Salary and other income saved per person and year — what you type above is held on the page and not stored',
  'Deductions beyond the standard one: 80C, 80D, home-loan interest, HRA — and so a fair old-against-new comparison',
  'A surcharge on capital gains above ₹50 lakh, and the rebate’s relief beside a gain',
  'TDS and advance tax credited, so the balance due and not only the liability',
  'Foreign shares, at the SBI prescribed exchange rate for the month of sale',
  'Debt funds, whose treatment depends on when they were bought',
  'Property, and the choice between 12.5% and 20% with indexation',
  'Losses brought forward from earlier years, and any carried on',
  'The foreign tax credit',
];

/** Why a sale that is listed is not in the figures, in a few words. */
const WHY: Record<ExclusionReason, (lot: TaxLot) => string> = {
  'unclassified-asset': () =>
    'its tax asset class is not set — set it under “Correct this holding” on Holdings',
  'no-rule-for-date': () => 'no holding-period rule covers this date; earlier regimes are not loaded',
  'currency-mismatch': (lot) =>
    `recorded in ${lot.parcel.gain.currency}, which is not rupees — a data problem for an Indian holding`,
  'needs-prescribed-rate': () =>
    'a foreign holding needs the SBI prescribed exchange rate for the month of sale, which is not stored yet',
  'debt-fund-not-modelled': () =>
    'a debt fund’s treatment depends on when it was bought, which the rules here do not model yet',
  'property-election': () =>
    'property carries an election between 12.5% and 20% with indexation, which is not modelled',
  'possibly-exempt': () =>
    'gold disposed at maturity — a Sovereign Gold Bond redeemed with the RBI is exempt, so it is left out; check with your CA',
  'not-a-sale': () => 'recorded as a gift or a transfer, which is not a sale',
};

export function TaxScreen({
  privacy,
  householdId,
}: {
  privacy: boolean;
  householdId: string | null;
}) {
  const { listing, rows, today, loading, problem, taxRules, taxRulesFailed } = useHoldings(householdId);

  const [chosenFy, setChosenFy] = useState<number | null>(null);
  const [chosenMember, setChosenMember] = useState<string | null>(null);

  const currentFy = taxYearOf(today);
  const fy = chosenFy ?? currentFy;
  const memberId = chosenMember ?? listing?.viewer.memberId ?? '';

  // The kind of each disposal, so a gift or a matured bond is not netted as a sale.
  const disposalKindOf = useMemo(
    () => new Map((listing?.disposals ?? []).map((sale) => [sale.id, sale.kind as string])),
    [listing],
  );

  const lots = useMemo(
    () => taxLotsFor({ rows, memberId, fy, rules: taxRules, disposalKindOf }),
    [rows, memberId, fy, taxRules, disposalKindOf],
  );
  const gains = useMemo(
    () =>
      netCapitalGains({
        parcels: lots.parcels,
        assetClassOf: lots.assetClassOf,
        disposalKindOf,
        rules: taxRules,
        fy,
      }),
    [lots, disposalKindOf, taxRules, fy],
  );
  const tax = useMemo(() => capitalGainsTax(gains, taxRules), [gains, taxRules]);

  if (loading) return <p className="note px-4.5 py-4.5">Loading…</p>;

  if (problem !== null && listing === null) {
    return (
      <div className="px-4.5 py-4.5">
        <Problem>{problem}</Problem>
      </div>
    );
  }
  if (listing === null) return null;

  const members = listing.members.filter((member) => !member.isArchived);
  const member = members.find((m) => m.id === memberId);
  const isMine = memberId === listing.viewer.memberId;
  const window = taxYearBounds(fy);
  const inProgress = fy === currentFy;

  const unplaced = lots.lots.filter((lot) => !lot.placement.placed);
  const allowance = gains.equityLong.exemption;
  const daysLeft = inProgress ? daysBetween(today, window.end) : null;

  const otherActivity = gains.otherLong.net.minor !== 0n || gains.otherShort.net.minor !== 0n;
  const lossesSetOff = money(gains.losses.short.setOff.minor + gains.losses.long.setOff.minor, 'INR');

  return (
    <div className="flex flex-col gap-4.5">
      <Card
        title="Tax year"
        aside={
          <span className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-2">
              <span className="micro-label">Year</span>
              <select
                className="field w-[130px]"
                value={fy}
                onChange={(event) => {
                  setChosenFy(Number(event.target.value));
                }}
              >
                {[0, 1, 2, 3].map((back) => (
                  <option key={back} value={currentFy - back}>
                    {`${String(currentFy - back)}–${String((currentFy - back + 1) % 100).padStart(2, '0')}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="micro-label">
                Whose return
                <Caveat tone="info" label="Why this is one person at a time">
                  Tax is filed per person, and the ₹1.25 lakh equity allowance is each
                  person&rsquo;s own. Adding two people together would give them one allowance
                  between them, or set one person&rsquo;s loss against the other&rsquo;s gain.
                </Caveat>
              </span>
              <select
                className="field w-[150px]"
                value={memberId}
                onChange={(event) => {
                  setChosenMember(event.target.value);
                }}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.id === listing.viewer.memberId ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </span>
        }
      >
        <p className="sm">
          {formatIsoDate(window.start)} to {formatIsoDate(window.end)}, IST
          {inProgress ? ' · in progress' : ''}.
        </p>
        <p className="note mt-2">
          A working paper, not a filing. It is not tax advice and not a substitute for your CA, who
          should be the one to check it — every figure below traces to the sales listed under it.
        </p>
      </Card>

      {taxRulesFailed && (
        <Notice tone="due">
          The tax rules could not be loaded, so nothing on this page can be computed — that is a
          fault, not an answer about the law. Reload the page; if it persists, the rules table may
          be out of step with this version of the app.
        </Notice>
      )}

      {!isMine && (
        <Notice>
          You are reading {member?.displayName ?? 'another member'}&rsquo;s figures. Anything they
          have marked private is not visible to you, so a sale of theirs that you cannot see is
          missing from every total here, and nothing on this page can tell you it is.
        </Notice>
      )}

      <Card title="Capital gains" aside={<span className="note">netted across asset classes</span>}>
        <h3 className="micro-label">Listed shares and equity funds</h3>
        <dl className="mt-2 flex flex-wrap gap-x-9 gap-y-3">
          <Stat label="Long term, net">{signed(gains.equityLong.net, privacy)}</Stat>
          <Stat label="Short term, net">{signed(gains.equityShort.net, privacy)}</Stat>
          <Stat label="Allowance used">
            {allowance === null ? (
              <>
                <span className="note">not known</span>
                <Caveat tone="warn" label="Why the allowance is not shown">
                  No rule for the ₹1.25 lakh equity allowance covers this tax year, so what is
                  taxable cannot be said. Nothing is assumed in its place.
                </Caveat>
              </>
            ) : (
              <>
                {formatMoney(allowance.used, { privacy })}{' '}
                <span className="note">of {formatMoney(allowance.available, { privacy })}</span>
              </>
            )}
          </Stat>
          <Stat label="Taxable, long term">
            {tax.equityLong === null ? (
              <span className="note">not shown</span>
            ) : (
              <>
                {formatMoney(tax.equityLong.taxable, { privacy })}
                {tax.equityLong.ratePct !== null && (
                  <span className="note"> at {rateText(tax.equityLong.ratePct)}</span>
                )}
              </>
            )}
          </Stat>
          <Stat label="Taxable, short term">
            {formatMoney(tax.equityShort.taxable, { privacy })}
            {tax.equityShort.ratePct !== null && (
              <span className="note"> at {rateText(tax.equityShort.ratePct)}</span>
            )}
          </Stat>
        </dl>

        {otherActivity && (
          <>
            <hr className="my-3.5" style={{ borderColor: 'var(--line)' }} />
            <h3 className="micro-label">
              Gold and unlisted shares
              <Caveat tone="info" label="How these differ from equity">
                Long term is two years, not one, and the gain is taxed at 12.5% with no allowance —
                the ₹1.25 lakh belongs to equity alone. A short-term gain is taxed at your slab
                rate, which depends on the rest of your income.
              </Caveat>
            </h3>
            <dl className="mt-2 flex flex-wrap gap-x-9 gap-y-3">
              <Stat label="Long term, net">{signed(gains.otherLong.net, privacy)}</Stat>
              <Stat label="Taxable, long term">
                {formatMoney(tax.otherLong.taxable, { privacy })}
                {tax.otherLong.ratePct !== null && (
                  <span className="note"> at {rateText(tax.otherLong.ratePct)}</span>
                )}
              </Stat>
              <Stat label="Short term, net">{signed(gains.otherShort.net, privacy)}</Stat>
              <Stat label="Added to income, at your slab">
                {formatMoney(tax.otherShortAtSlab, { privacy })}
                <Caveat tone="warn" label="Why this has no tax figure">
                  A short-term gain on gold or unlisted shares is added to your income and taxed
                  at your slab rate. That needs the rest of your income, which is not here yet, so
                  it is shown as an amount and never as a tax — and it is not in the total below.
                </Caveat>
              </Stat>
            </dl>
          </>
        )}

        <hr className="my-3.5" style={{ borderColor: 'var(--line)' }} />

        <dl className="flex flex-wrap gap-x-9 gap-y-3">
          {lossesSetOff.minor > 0n && (
            <Stat label="Losses set off">
              {formatMoney(lossesSetOff, { privacy })}
              <Caveat tone="info" label="How losses were set off">
                A long-term loss can only reduce a long-term gain, so it is used first. A
                short-term loss then goes against what is left — equity short term, then short-term
                gold and unlisted, then long-term gold and unlisted, then long-term equity, where
                the allowance may already cover it. The Act lets you choose the order; this is the
                one used here, and your CA may choose another.
              </Caveat>
            </Stat>
          )}
          <Stat label="Tax on gains at their own rates">
            {tax.total === null ? (
              <>
                <span className="note">not shown</span>
                <Caveat tone="warn" label="Why there is no tax figure">
                  A rate or the allowance for this year is missing from the rules, so a total would
                  be short by something that cannot be named. Nothing is assumed in its place.
                </Caveat>
              </>
            ) : (
              <>
                {formatMoney(tax.total, { privacy })}
                <Caveat tone="info" label="What this figure leaves out">
                  Before surcharge and the 4% health and education cess, which depend on the rest
                  of your income and are not here yet. It is the tax on the gains that have a rate
                  of their own, and leaves out any short-term gold or unlisted gain, which is taxed
                  at your slab.
                </Caveat>
              </>
            )}
          </Stat>
        </dl>

        {gains.losses.short.unrelieved !== null && (
          <div className="mt-3.5">
            <Notice>
              {formatMoney(gains.losses.short.unrelieved, { privacy })} of short-term loss is left
              after set-off. It is not carried forward anywhere in this app yet — note it for next
              year&rsquo;s return, and file on time, because a late return forfeits it.
            </Notice>
          </div>
        )}
        {gains.losses.long.unrelieved !== null && (
          <div className="mt-3.5">
            <Notice>
              {formatMoney(gains.losses.long.unrelieved, { privacy })} of long-term loss is left,
              with no long-term gain to reduce. It is not carried forward anywhere in this app yet
              — note it for next year&rsquo;s return, and file on time, because a late return
              forfeits it.
            </Notice>
          </div>
        )}
      </Card>

      <IncomeTaxCard
        key={`${memberId}-${String(fy)}`}
        fy={fy}
        gains={gains}
        rules={taxRules}
        privacy={privacy}
        whose={member?.displayName ?? 'this member'}
      />

      {inProgress && allowance !== null && (
        <Card title="Expiring this year" aside={<span className="note">use it or lose it</span>}>
          <div
            className="grid items-center gap-x-3"
            style={{ gridTemplateColumns: 'minmax(90px, 1fr) 3fr 110px' }}
          >
            <span className="micro-label">Long-term allowance</span>
            <Bar
              value={Number(allowance.used.minor)}
              target={Number(allowance.available.minor)}
              label="Long-term equity allowance used"
            />
            <span className="num text-right">{formatMoney(allowance.used, { privacy })}</span>
          </div>
          {/* A div, not a p: the caveat opens a popover, and a div may not sit inside a p. */}
          <div className="sm mt-2">
            {formatMoney(money(allowance.available.minor - allowance.used.minor, 'INR'), {
              privacy,
            })}{' '}
            of the {formatMoney(allowance.available, { privacy })} long-term equity allowance is
            unused
            {daysLeft !== null && ` · ${String(daysLeft)} days left in the tax year`}.
            <Caveat tone="info" label="What counts as used">
              Only gains already realised by a sale. An unrealised gain is not used and does not
              reduce what is left. It applies to equity alone — gold and unlisted shares do not use
              it.
            </Caveat>
          </div>
        </Card>
      )}

      {unplaced.length > 0 && (
        <Notice
          tone="due"
          names={unplaced.flatMap((lot) =>
            lot.placement.placed
              ? []
              : [
                  `${lot.holdingName} · sold ${formatIsoDate(lot.parcel.disposedOn)} — ${WHY[lot.placement.reason](lot)}`,
                ],
          )}
          namesLabel="Which sales"
        >
          {unplaced.length} {unplaced.length === 1 ? 'sale is' : 'sales are'} listed below but not in
          the figures above. Each says why. Nothing was guessed at.
        </Notice>
      )}

      <Card
        title="Capital gains, by lot"
        aside={<span className="note">computed from the lots — no gain is ever stored</span>}
      >
        {lots.lots.length === 0 ? (
          <p className="note">
            Nothing was sold by {member?.displayName ?? 'this member'} in this tax year, so there
            is nothing to net. A sale recorded on Holdings appears here.
          </p>
        ) : (
          <ul aria-label="Sales in this tax year" className="flex flex-col">
            {/*
              A stacked row per sale rather than a table. The prototype's table has
              six columns, and at phone width a fund named "… (formerly …)" took one
              word per line while Class and Gain scrolled out of sight — the two
              columns this page is for. Name and gain share the top line so the
              figure is never a scroll away, and the rest reads underneath.
            */}
            {lots.lots.map((lot, at) => (
              <li
                key={`${lot.parcel.lotId}-${lot.parcel.disposalId}`}
                className={at === 0 ? 'pb-3.5' : 'border-t py-3.5'}
                style={{ borderColor: 'var(--line)' }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{lot.holdingName}</span>
                  <span className="num">{signed(lot.parcel.gain, privacy)}</span>
                </div>
                <p className="note mt-1">
                  Sold {formatIsoDate(lot.parcel.disposedOn)} · bought{' '}
                  {formatIsoDate(lot.parcel.acquiredOn)} · held {lot.parcel.heldDays} days
                </p>
                <div className="mt-2">
                  <ClassPill lot={lot} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="note mt-3">
          A sale is FIFO-matched to its purchases, and each parcel is held for its own period — a
          sale that spans two purchases can be part long term and part short. The term is decided
          by the rule in force on the day of the sale, not today&rsquo;s.
        </p>
      </Card>

      <Notice names={STILL_TO_COME} namesLabel="What is still to come">
        This page computes tax on the salary and other income you type in, and on capital gains on
        listed equity, equity funds, gold and unlisted shares, with only the standard deduction. It
        is an estimate of the liability on those figures and not the whole return.
      </Notice>
    </div>
  );
}

/** The class of a sale, with its term — worded so no term is claimed where none can be. */
function ClassPill({ lot }: { lot: TaxLot }) {
  const label = lot.assetClass === null ? '' : taxClassLabel(lot.assetClass);
  const term = lot.term === null ? '' : lot.term === 'long' ? 'long term' : 'short term';

  if (lot.placement.placed) {
    switch (lot.placement.bucket) {
      case 'equity-long':
        return <Pill tone="ok">Long term · equity</Pill>;
      case 'equity-short':
        return <Pill tone="warn">Short term · equity</Pill>;
      case 'other-long':
        return <Pill tone="ok">{`Long term · ${label}`}</Pill>;
      case 'other-short':
        return <Pill tone="warn">{`Short term · ${label} · at your slab`}</Pill>;
    }
  }

  // Not placed. A data problem is `due`; a known limitation is neutral, and says
  // which — the two ask different things of the person reading.
  switch (lot.placement.placed ? null : lot.placement.reason) {
    case 'unclassified-asset':
      return <Pill tone="due">Class not set</Pill>;
    case 'no-rule-for-date':
      return <Pill tone="due">No rule for this date</Pill>;
    case 'currency-mismatch':
      return <Pill tone="due">Not in rupees</Pill>;
    case 'needs-prescribed-rate':
      return <Pill tone="neutral">{`${label} · ${term} · needs the prescribed rate`}</Pill>;
    case 'debt-fund-not-modelled':
      return <Pill tone="neutral">Debt fund · not netted</Pill>;
    case 'property-election':
      return <Pill tone="neutral">{`Property · ${term} · election needed`}</Pill>;
    case 'possibly-exempt':
      return <Pill tone="neutral">{`${label} · at maturity · left out`}</Pill>;
    case 'not-a-sale':
      return <Pill tone="neutral">Gift or transfer · not a sale</Pill>;
    default:
      return null;
  }
}
