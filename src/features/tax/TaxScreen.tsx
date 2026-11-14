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

import { useEffect, useMemo, useState } from 'react';
import { computeIncomeTax, ratesApplied } from '../../domain/income-tax.ts';
import { taxYearBounds, taxYearOf, taxYearsToOffer } from '../../domain/budget.ts';
import { freshness, type Regime } from '../../domain/tax-rules.ts';
import { daysBetween, formatIsoDate } from '../../lib/dates.ts';
import { Notice, Problem } from '../../ui/primitives.tsx';
import { MutedNote } from '../../ui/MutedNote.tsx';
import { useHoldings } from '../holdings/useHoldings.ts';
import { GainsCard } from './GainsCard.tsx';
import { IncomeTaxCard } from './IncomeTaxCard.tsx';
import { figuresInForce, inputTexts, parseBusiness, parseIncome, rowsToSave, salarySourceInForce, stillToPay } from './incomeInputs.ts';
import { SalesCard } from './SalesCard.tsx';
import { TaxNotes } from './TaxNotes.tsx';
import { taxFigures } from './taxFigures.ts';
import { shortDate } from './saleLine.ts';
import { useTaxInputs, type TaxInputsState } from './useTaxInputs.ts';
import type { NewTaxInput, TaxInputRecord } from '../../repo/types.ts';
import type { Money } from '../../lib/money.ts';

const yearText = (fy: number): string => `${String(fy)}–${String((fy + 1) % 100).padStart(2, '0')}`;
/** The tax year as the table keeps it: `2026-27`. */
const taxYearKey = (fy: number): string => `${String(fy)}-${String((fy + 1) % 100).padStart(2, '0')}`;

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

  // The figures typed for this year and saved, as this caller may read them: their own, and whatever they typed for others.
  const typed = useTaxInputs(listing?.household.id ?? householdId, taxYearKey(fy));

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

  if (loading || typed.state.status === 'loading') return <p className="note px-4.5 py-4.5">Loading…</p>;

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
    <div className="flex flex-col gap-2.5">
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

      {typed.state.status === 'failed' && (
        <Notice>
          The figures saved for this year could not be read just now, so none are shown and what is typed is not added to them. Reload the page to read
          them again.
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
        householdId={listing.household.id}
        memberId={memberId}
        taxYear={taxYearKey(fy)}
        typed={typed.state}
        onSave={typed.save}
        canSave={listing.viewer.canRecord && (listing.viewer.role !== 'contributor' || isMine) && typed.state.status === 'ready'}
        readsFigures={listing.viewer.canRecord}
        isMine={isMine}
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
  householdId,
  memberId,
  taxYear,
  typed,
  onSave,
  canSave,
  readsFigures,
  isMine,
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
  householdId: string;
  memberId: string;
  taxYear: string;
  typed: TaxInputsState;
  onSave: (rows: readonly NewTaxInput[]) => Promise<void>;
  canSave: boolean;
  readsFigures: boolean;
  isMine: boolean;
}) {
  const [regime, setRegime] = useState<Regime>('new');
  const records: readonly TaxInputRecord[] = typed.status === 'ready' ? typed.records : [];
  const figures = useMemo(() => figuresInForce(records, memberId, taxYear), [records, memberId, taxYear]);
  const opening = useMemo(() => inputTexts(figures), [figures]);

  // What is typed is held here until Save; after a save the fields take what is now in force.
  const [salaryText, setSalaryText] = useState(opening.salary);
  const [businessText, setBusinessText] = useState(opening.business);
  const [otherText, setOtherText] = useState(opening.other);
  const [tdsText, setTdsText] = useState(opening.tds);
  const [saving, setSaving] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState(0);
  useEffect(() => {
    if (savedVersion === 0) return;
    setSalaryText(opening.salary);
    setBusinessText(opening.business);
    setOtherText(opening.other);
    setTdsText(opening.tds);
    // Only a save moves the fields: a re-read of the same figures must not take away what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedVersion]);

  const salary = parseIncome(salaryText);
  const business = parseBusiness(businessText);
  const other = parseIncome(otherText);
  const tds = parseIncome(tdsText);

  const save = async (salarySource: 'payslip' | 'form16'): Promise<void> => {
    const made = rowsToSave({ householdId, memberId, taxYear, salary: salaryText, business: businessText, other: otherText, tds: tdsText, salarySource });
    if (made.error !== null) {
      setSaveProblem(made.error);
      setSaid(null);
      return;
    }
    if (made.rows.length === 0) {
      setSaveProblem('Nothing is typed to save.');
      setSaid(null);
      return;
    }
    setSaving(true);
    setSaveProblem(null);
    try {
      await onSave(made.rows);
      setSavedVersion((was) => was + 1);
      setSaid(salarySource === 'form16' ? 'Saved. The Form 16 figure is used from now on.' : 'Saved.');
    } catch (error) {
      // For another member's return a refusal must not say that a row of theirs is there: row-level security hides it, and so does this.
      setSaveProblem(
        !isMine
          ? 'That could not be saved. Figures a member typed for themselves can only be changed by that member.'
          : error instanceof Error
            ? error.message
            : 'That could not be saved.',
      );
      setSaid(null);
    } finally {
      setSaving(false);
    }
  };

  const result = useMemo(
    () =>
      computeIncomeTax({
        regime,
        fy,
        salary: salary.amount,
        otherIncome: other.amount,
        business: business.amount,
        gains,
        rules,
      }),
    [regime, fy, salary.amount.minor, other.amount.minor, business.amount.minor, gains, rules],
  );
  const applied = useMemo(() => ratesApplied({ rules, regime, fy }), [rules, regime, fy]);

  // An amount that cannot be read is not an amount of nothing, so no figure is given beside it.
  const unreadable =
    business.error !== null && business.error.startsWith('A business loss')
      ? 'A business loss is typed above, and the estimate does not model one, so there is no estimate until it is a profit or is left empty.'
      : salary.error !== null || other.error !== null || business.error !== null || tds.error !== null
        ? 'An amount typed above is not a number, so there is no estimate until it is. It is not counted as nothing.'
        : null;
  const tdsTyped: Money | null = tdsText.trim() === '' || tds.error !== null ? null : tds.amount;

  return (
    <>
      <IncomeTaxCard
        result={result}
        regime={regime}
        onRegime={setRegime}
        inputs={{
          salary: { text: salaryText, error: salary.error, onChange: setSalaryText },
          business: { text: businessText, error: business.error, onChange: setBusinessText },
          other: { text: otherText, error: other.error, onChange: setOtherText },
          tds: { text: tdsText, error: tds.error, onChange: setTdsText },
        }}
        save={{
          canSave,
          busy: saving,
          problem: saveProblem,
          said,
          onSave: () => {
            // Where the salary in force is kept: after a Form 16 correction an edit goes to the Form 16 row, or it would be saved and never used.
            void save(salarySourceInForce(figures));
          },
          onForm16: () => {
            void save('form16');
          },
          wasPayslip: figures.salary?.source === 'form16' ? figures.salary.payslip : null,
          form16: figures.salary?.source === 'form16',
          whose,
          stillToPay: stillToPay(result.total, tdsTyped),
          // Another member's return: what they typed themselves is private to them, so the estimate may be missing figures; said, never silent.
          othersFigures: !isMine && readsFigures && typed.status === 'ready',
          readsFigures,
          salaryOrigin:
            figures.salary === null
              ? null
              : figures.salary.source === 'form16'
                ? `Form 16 · corrected ${formatIsoDate(figures.salary.on)}`
                : `From payslip · ${formatIsoDate(figures.salary.on)}`,
        }}
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
