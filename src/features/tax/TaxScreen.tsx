/**
 * Tax — a working paper for one person's capital gains and the tax they come to.
 *
 * "It fills the schedules, it does not file the return." Everything here is the household's own numbers arranged
 * the way a return asks for them, with the working shown and the sale behind every figure listed underneath it. It
 * is not tax advice, not a filing, and not a substitute for a CA — and it says so on the screen, because a figure
 * on a page called Tax will be read as authoritative whatever the small print says.
 *
 * The order is the board's (docs/design/vibrant-canvas.html, Tax): whose return and which year on one line, the
 * answer in the one lifted card with the working behind a fold, the gains and the allowance, the sales that made
 * them, and one quiet line about what the page is with two buttons for the rest.
 *
 * ── one person, not the household ───────────────────────────────────────
 *
 * Tax is filed per taxpayer, and the ₹1.25 lakh allowance is each person's own. Netting the household once would
 * give two people one allowance between them, or set one person's loss against another's gain. So the screen asks
 * whose return it is, and starts with yours.
 *
 * ── what it nets, and what it lists but will not ────────────────────────
 *
 * Listed equity, equity funds, gold and unlisted shares, netted together under the Act's set-off rules. Foreign
 * shares, debt funds, property, a matured gold bond, and gifts and transfers are listed, each with the specific
 * reason it is not in the figures — never dropped, and never guessed at. Salary, the slabs, surcharge and cess, the
 * regime comparison and losses brought forward are all still to come where they are not here, and the screen lists
 * them (`TaxNotes`), so a page that computes one head is never read as the whole return.
 */

import { useMemo, useState } from 'react';
import { computeIncomeTax, ratesApplied } from '../../domain/income-tax.ts';
import { taxYearBounds, taxYearOf, taxYearsToOffer } from '../../domain/budget.ts';
import { freshness, type Regime } from '../../domain/tax-rules.ts';
import { daysBetween, formatIsoDate } from '../../lib/dates.ts';
import { Notice, Problem } from '../../ui/primitives.tsx';
import { MutedNote } from '../../ui/MutedNote.tsx';
import { useHoldings } from '../holdings/useHoldings.ts';
import { GainsCard } from './GainsCard.tsx';
import { IncomeTaxCard, parseIncome } from './IncomeTaxCard.tsx';
import { SalesCard } from './SalesCard.tsx';
import { TaxNotes } from './TaxNotes.tsx';
import { taxFigures } from './taxFigures.ts';
import { shortDate } from './saleLine.ts';

const yearText = (fy: number): string => `${String(fy)}–${String((fy + 1) % 100).padStart(2, '0')}`;

/** A choice drawn as a pill with a chevron, the device's own picker laid invisibly over it. */
function PillSelect({
  label,
  value,
  onChange,
  children,
  shown,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  /** What the pill says. */
  shown: React.ReactNode;
}) {
  return (
    <label className="tax-pill">
      {shown}
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="tax-pill-chevron"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {children}
      </select>
    </label>
  );
}

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

  // The years there is something to look at: this one, and every earlier one with
  // a sale in it. Not the last four whatever they hold.
  const years = useMemo(
    () =>
      taxYearsToOffer({
        currentFy,
        saleDates: (listing?.disposals ?? []).map((sale) => sale.disposedOn),
      }),
    [currentFy, listing],
  );
  const memberId = chosenMember ?? listing?.viewer.memberId ?? '';

  // The kind of each disposal, so a gift or a matured bond is not netted as a sale.
  const disposalKindOf = useMemo(
    () => new Map((listing?.disposals ?? []).map((sale) => [sale.id, sale.kind as string])),
    [listing],
  );

  const { lots, gains, tax } = useMemo(
    () => taxFigures({ rows, memberId, fy, rules: taxRules, disposalKindOf }),
    [rows, memberId, fy, taxRules, disposalKindOf],
  );

  if (loading) return <p className="note px-4.5 py-4.5">Loading…</p>;

  if (problem !== null && listing === null) {
    return (
      <div className="px-4.5 py-4.5">
        <Problem>{problem}</Problem>
      </div>
    );
  }
  if (listing === null) return null;

  // A contributor reads only their own records, so another member's return would
  // read as "nothing sold" when it is in fact not theirs to see.
  const members = listing.members.filter(
    (member) =>
      !member.isArchived && (listing.viewer.role !== 'contributor' || member.id === listing.viewer.memberId),
  );
  const member = members.find((m) => m.id === memberId);
  const isMine = memberId === listing.viewer.memberId;
  const window = taxYearBounds(fy);
  const inProgress = fy === currentFy;
  const daysLeft = inProgress ? daysBetween(today, window.end) : null;
  const whose = member?.displayName ?? 'this member';

  return (
    <div className="flex flex-col gap-3">
      {/* Whose return, which year: one line, not a card. */}
      <div className="tax-head">
        {years.length === 1 ? (
          // Nothing to choose between, so nothing to choose with.
          <span className="tax-pill tabular-nums" aria-label={`Tax year ${yearText(fy)}`}>
            {yearText(fy)}
          </span>
        ) : (
          <PillSelect
            label="Tax year"
            value={String(fy)}
            onChange={(value) => {
              setChosenFy(Number(value));
            }}
            shown={<span className="tabular-nums">{yearText(fy)}</span>}
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {yearText(year)}
              </option>
            ))}
          </PillSelect>
        )}
        <PillSelect
          label="Whose return"
          value={memberId}
          onChange={setChosenMember}
          shown={
            <span>
              {whose}
              {isMine && <span className="note"> (you)</span>}
            </span>
          }
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
              {m.id === listing.viewer.memberId ? ' (you)' : ''}
            </option>
          ))}
        </PillSelect>
        <span className="flex-1" />
        <span className="note tabular-nums">
          {daysLeft === null
            ? `ended ${formatIsoDate(window.end)}`
            : `${String(daysLeft)} ${daysLeft === 1 ? 'day' : 'days'} left`}
        </span>
      </div>

      {taxRulesFailed && (
        <Notice>
          The tax rules could not be loaded, so nothing on this page can be computed — that is a fault, not an
          answer about the law. Reload the page; if it persists, the rules table may be out of step with this
          version of the app.
        </Notice>
      )}

      {!isMine && (
        <MutedNote>
          You are reading {member?.displayName ?? 'another member'}&rsquo;s figures. Anything they have marked
          private is not visible to you, so a sale of theirs that you cannot see is missing from every total here,
          and nothing on this page can tell you it is.
        </MutedNote>
      )}

      {/* What is typed is the return's, so a different person or year starts clean. */}
      <TaxWorkspace
        key={`${memberId}-${String(fy)}`}
        fy={fy}
        yearLabel={yearText(fy)}
        inProgress={inProgress}
        windowText={`${formatIsoDate(window.start)} to ${formatIsoDate(window.end)}`}
        lastDay={shortDate(window.end)}
        gains={gains}
        tax={tax}
        lots={lots.lots}
        rules={taxRules}
        privacy={privacy}
        whose={whose}
      />
    </div>
  );
}

/**
 * Everything under the head, for one person and one year: the two amounts typed in, the estimate they make with the
 * year's gains, and the notes under it that name the regime's rates.
 */
function TaxWorkspace({
  fy,
  yearLabel,
  inProgress,
  windowText,
  lastDay,
  gains,
  tax,
  lots,
  rules,
  privacy,
  whose,
}: {
  fy: number;
  yearLabel: string;
  inProgress: boolean;
  windowText: string;
  lastDay: string;
  gains: ReturnType<typeof taxFigures>['gains'];
  tax: ReturnType<typeof taxFigures>['tax'];
  lots: ReturnType<typeof taxFigures>['lots']['lots'];
  rules: Parameters<typeof computeIncomeTax>[0]['rules'];
  privacy: boolean;
  whose: string;
}) {
  const [regime, setRegime] = useState<Regime>('new');
  const [salaryText, setSalaryText] = useState('');
  const [otherText, setOtherText] = useState('');

  const salary = parseIncome(salaryText);
  const other = parseIncome(otherText);

  const result = useMemo(
    () =>
      computeIncomeTax({
        regime,
        fy,
        salary: salary.amount,
        otherIncome: other.amount,
        gains,
        rules,
      }),
    [regime, fy, salary.amount.minor, other.amount.minor, gains, rules],
  );
  const applied = useMemo(() => ratesApplied({ rules, regime, fy }), [rules, regime, fy]);

  // An amount that cannot be read is not an amount of nothing, so no figure is given beside it.
  const unreadable =
    salary.error !== null || other.error !== null
      ? 'An amount typed above is not a number, so there is no estimate until it is. It is not counted as nothing.'
      : null;

  return (
    <>
      <IncomeTaxCard
        result={result}
        regime={regime}
        onRegime={setRegime}
        salary={{ text: salaryText, error: salary.error, onChange: setSalaryText }}
        other={{ text: otherText, error: other.error, onChange: setOtherText }}
        inProgress={inProgress}
        privacy={privacy}
        unreadable={unreadable}
      />
      <GainsCard gains={gains} tax={tax} inProgress={inProgress} lastDay={lastDay} privacy={privacy} />
      <SalesCard
        lots={lots}
        heading={inProgress ? 'Sales this year' : `Sales in ${yearLabel}`}
        whose={whose}
        privacy={privacy}
      />
      <TaxNotes
        fy={fy}
        windowText={windowText}
        verifiedOn={result.verifiedOn}
        checked={freshness(result.verifiedOn, fy)}
        applied={applied}
        whose={whose}
      />
    </>
  );
}
