/**
 * Tax — a working paper for one person's equity capital gains.
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
 * ── what it does not do yet ─────────────────────────────────────────────
 *
 * Listed equity and equity mutual funds only. Salary, the slabs, surcharge and
 * cess, the regime comparison, every other asset class, losses brought forward
 * and foreign figures at the prescribed rate are all still to come — and the
 * screen lists them, so a page that computes one head is never read as the
 * whole return. A sale it cannot net is listed with the reason, not dropped.
 */

import { useMemo, useState } from 'react';
import { equityTax, netEquityGains } from '../../domain/capital-gains.ts';
import { taxYearBounds, taxYearOf } from '../../domain/budget.ts';
import { daysBetween, formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money, type Money } from '../../lib/money.ts';
import { taxClassLabel } from '../../ui/labels.ts';
import { Bar, Card, Caveat, Notice, Pill, Problem, Stat } from '../../ui/primitives.tsx';
import { useHoldings } from '../holdings/useHoldings.ts';
import { taxLotsFor, type TaxLot } from './taxLots.ts';

/** A gain or loss with its sign written out: the direction is never carried by colour alone. */
function signed(value: Money, privacy: boolean): string {
  const sign = value.minor < 0n ? '−' : value.minor > 0n ? '+' : '';
  const size = money(value.minor < 0n ? -value.minor : value.minor, value.currency);
  return `${sign}${formatMoney(size, { privacy })}`;
}

const STILL_TO_COME: readonly string[] = [
  'Salary, other income and deductions — the other heads of a return',
  'Slabs, rebate, surcharge and the 4% cess, and so the total liability',
  'The old and new regime, side by side',
  'Gains on gold, debt funds, foreign shares, unlisted shares and property',
  'Losses brought forward from earlier years, and any carried on',
  'Foreign figures at the prescribed exchange rate, and the foreign tax credit',
  'Advance tax instalments',
];

/** Why a sale that is listed is not in the figures, in a few words. */
function why(lot: TaxLot): string {
  switch (lot.treatment) {
    case 'unclassified':
      return 'its tax asset class is not set — set it under “Correct this holding” on Holdings';
    case 'no-rule':
      return 'no holding-period rule covers this date; earlier regimes are not loaded';
    case 'currency-mismatch':
      return `an equity holding recorded in ${lot.parcel.gain.currency}, which should be rupees`;
    default:
      return '';
  }
}

export function TaxScreen({
  privacy,
  householdId,
}: {
  privacy: boolean;
  householdId: string | null;
}) {
  const { listing, rows, today, loading, problem, taxRules } = useHoldings(householdId);

  const [chosenFy, setChosenFy] = useState<number | null>(null);
  const [chosenMember, setChosenMember] = useState<string | null>(null);

  const currentFy = taxYearOf(today);
  const fy = chosenFy ?? currentFy;
  const memberId = chosenMember ?? listing?.viewer.memberId ?? '';

  const lots = useMemo(
    () => taxLotsFor({ rows, memberId, fy, rules: taxRules }),
    [rows, memberId, fy, taxRules],
  );
  const gains = useMemo(
    () =>
      netEquityGains({
        parcels: lots.parcels,
        assetClassOf: lots.assetClassOf,
        rules: taxRules,
        fy,
      }),
    [lots, taxRules, fy],
  );
  const tax = useMemo(() => equityTax(gains, taxRules), [gains, taxRules]);

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

  const unplaced = lots.lots.filter(
    (lot) => lot.treatment !== 'netted' && lot.treatment !== 'other-class',
  );
  const otherClass = lots.lots.filter((lot) => lot.treatment === 'other-class');
  const allowance = gains.longTerm.exemption;
  const daysLeft = inProgress ? daysBetween(today, window.end) : null;

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

      {!isMine && (
        <Notice>
          You are reading {member?.displayName ?? 'another member'}&rsquo;s figures. Anything they
          have marked private is not visible to you, so a sale of theirs that you cannot see is
          missing from every total here, and nothing on this page can tell you it is.
        </Notice>
      )}

      <Card
        title="Equity gains"
        aside={<span className="note">listed shares and equity mutual funds</span>}
      >
        <dl className="flex flex-wrap gap-x-9 gap-y-3">
          <Stat label="Long term, net">{signed(gains.longTerm.net, privacy)}</Stat>
          <Stat label="Short term, net">{signed(gains.shortTerm.net, privacy)}</Stat>
          {gains.setOffAgainstLongTerm.minor > 0n && (
            <Stat label="Short-term loss set off">
              {formatMoney(gains.setOffAgainstLongTerm, { privacy })}
              <Caveat tone="info" label="What set-off means here">
                A short-term loss reduces a long-term gain before the allowance is applied. A
                long-term loss can only ever reduce a long-term gain, never a short-term one.
              </Caveat>
            </Stat>
          )}
        </dl>

        <hr className="my-3.5" style={{ borderColor: 'var(--line)' }} />

        <dl className="flex flex-wrap gap-x-9 gap-y-3">
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
            {tax.longTerm === null ? (
              <span className="note">not shown</span>
            ) : (
              <>
                {formatMoney(tax.longTerm.taxable, { privacy })}
                {tax.longTerm.ratePct !== null && (
                  <span className="note"> at {Number(tax.longTerm.ratePct)}%</span>
                )}
              </>
            )}
          </Stat>

          <Stat label="Taxable, short term">
            {formatMoney(tax.shortTerm.taxable, { privacy })}
            {tax.shortTerm.ratePct !== null && (
              <span className="note"> at {Number(tax.shortTerm.ratePct)}%</span>
            )}
          </Stat>

          <Stat label="Tax on equity gains">
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
                  of your income and are not here yet. Equity gains are taxed at their own rates
                  and not at your slab, so this is the tax on these gains alone.
                </Caveat>
              </>
            )}
          </Stat>
        </dl>

        {gains.unrelieved.shortTerm !== null && (
          <div className="mt-3.5">
            <Notice>
              {formatMoney(gains.unrelieved.shortTerm, { privacy })} of short-term loss is left
              after set-off. It is not carried forward anywhere in this app yet — note it for next
              year&rsquo;s return, and file on time, because a late return forfeits it.
            </Notice>
          </div>
        )}
        {gains.unrelieved.longTerm !== null && (
          <div className="mt-3.5">
            <Notice>
              {formatMoney(gains.unrelieved.longTerm, { privacy })} of long-term loss is left,
              with no long-term gain to reduce. It is not carried forward anywhere in this app yet
              — note it for next year&rsquo;s return, and file on time, because a late return
              forfeits it.
            </Notice>
          </div>
        )}
      </Card>

      {inProgress && allowance !== null && (
        <Card
          title="Expiring this year"
          aside={<span className="note">use it or lose it</span>}
        >
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
              reduce what is left.
            </Caveat>
          </div>
        </Card>
      )}

      {unplaced.length > 0 && (
        <Notice
          tone="due"
          names={unplaced.map(
            (lot) =>
              `${lot.holdingName} · sold ${formatIsoDate(lot.parcel.disposedOn)} — ${why(lot)}`,
          )}
          namesLabel="Which sales"
        >
          {unplaced.length} {unplaced.length === 1 ? 'sale' : 'sales'} could not be placed, so{' '}
          {unplaced.length === 1 ? 'it is' : 'they are'} not in the figures above. Nothing was
          guessed at.
        </Notice>
      )}

      {otherClass.length > 0 && (
        <Notice>
          {otherClass.length} {otherClass.length === 1 ? 'sale' : 'sales'} of other assets{' '}
          {otherClass.length === 1 ? 'is' : 'are'} listed below but not netted here. Only listed
          shares and equity funds are.
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
        This page covers one part of one head: capital gains on listed equity and equity funds. It
        is not the whole return, and the total above is not a total liability.
      </Notice>
    </div>
  );
}

/** The class of a sale, with its term — worded so no term is claimed where none can be. */
function ClassPill({ lot }: { lot: TaxLot }) {
  switch (lot.treatment) {
    case 'netted':
      return lot.term === 'long' ? (
        <Pill tone="ok">Long term · equity</Pill>
      ) : (
        <Pill tone="warn">Short term · equity</Pill>
      );
    case 'other-class':
      return (
        <Pill tone="neutral">
          {lot.assetClass === null ? '' : taxClassLabel(lot.assetClass)}
          {lot.term === null ? '' : ` · ${lot.term === 'long' ? 'long' : 'short'} term`}
          {' · not netted'}
        </Pill>
      );
    case 'unclassified':
      return <Pill tone="due">Class not set</Pill>;
    case 'no-rule':
      return <Pill tone="due">No rule for this date</Pill>;
    case 'currency-mismatch':
      return <Pill tone="due">Not in rupees</Pill>;
  }
}
