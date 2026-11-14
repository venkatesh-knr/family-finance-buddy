/**
 * Estimated tax on one person's income — the answer, and the working behind it.
 *
 * The figure is first, as docs/design/vibrant-canvas.html draws the Tax board: the total on the salary and other
 * income somebody types in, with the year's capital gains added beside them. Under it the two inputs, and a fold,
 * "How it adds up", that holds every step — slabs, then the rebate, then the surcharge, then the cess — so a CA can
 * check each line against a return. A line that cannot be given says so and why, in place: an empty row would read
 * as a tax of nothing. And a figure that cannot be given at all says so under the number, always visible, because
 * a fold that hides the reason a number is missing would hide the news.
 *
 * ── the figures typed here, and saving them ──────────────────────────────
 *
 * Salary is the most private figure in the app. The four figures typed here — gross salary, a business or professional
 * net profit, other income at slab rates and the tax deducted so far — are kept for the member and the tax year,
 * and only when somebody presses Save: until then they are held in this page and gone when it is closed. Once saved
 * they are readable only by the member's own login and by whoever typed them (ledger-income.md section 8), which the
 * card says beside the fields. A figure is corrected by typing it again; a Form 16 figure is its own row, used from
 * then on, with the payslip's kept beside it.
 *
 * ── what it does not claim ──────────────────────────────────────────────
 *
 * It applies the standard deduction and no other. The new regime has almost none, so its figure is close to
 * whole; the old regime's is not, and reads high for anyone who claims 80C, 80D or a home-loan deduction — which
 * is why no "which regime is better" verdict is drawn here. That needs the deductions. The list of what is
 * assumed is behind the "What this assumes" button under the screen (`TaxNotes`).
 *
 * The state — the regime, the two amounts — and the computation are the screen's (`TaxScreen`), so the notes
 * under it can name the regime's rates without a second copy of the state.
 */

import { useState } from 'react';
import type { IncomeTaxComputation, Refusal } from '../../domain/income-tax.ts';
import type { Regime } from '../../domain/tax-rules.ts';
import { formatMoney, money, type Money } from '../../lib/money.ts';
import { Absent, Field, Pill } from '../../ui/primitives.tsx';
import { MutedNote } from '../../ui/MutedNote.tsx';

export const REFUSAL_TEXT: Record<Refusal, string> = {
  'no-rule-for-year':
    'No slab, cess or standard-deduction rule covers this tax year, so nothing is computed. Earlier years are not loaded, and this app will not apply another year’s slabs to one they did not govern.',
  'surcharge-on-capital-gains':
    'Your income is above ₹50 lakh and includes capital gains. The surcharge on a gain is capped at 15% and has a relief of its own, which is not modelled — so there is no total rather than one that leaves it out.',
  'rebate-relief-on-capital-gains':
    'Your income is just above the rebate ceiling and includes capital gains. How the rebate’s marginal relief combines with a gain is not modelled — so there is no total rather than a guess.',
  'capital-gains-tax-unknown':
    'A capital gain has no rate in the rules for this year, so the tax on it — and so the total — cannot be given.',
};

/** One of the two amounts typed in: the text, what it was parsed as, and how to change it. */
export interface IncomeInput {
  readonly text: string;
  readonly error: string | null;
  readonly onChange: (text: string) => void;
}

/** Saving what is typed: whether it can be, what is in force, and what came of the last try. */
export interface SaveState {
  /** The viewer may write figures for this member: an owner or a partner for anyone, a contributor for themselves, a viewer for no one. */
  readonly canSave: boolean;
  readonly busy: boolean;
  readonly problem: string | null;
  /** What was saved, said once it has been. */
  readonly said: string | null;
  readonly onSave: () => void;
  /** Writes the salary as a Form 16 figure of its own. */
  readonly onForm16: () => void;
  /** For a Form 16 figure in force: the payslip's, kept beside it ("was ₹22,80,000 from payslip"). */
  readonly wasPayslip: Money | null;
  /** The salary in force is Form 16's. */
  readonly form16: boolean;
  /** Whose these figures are: the name the lock line gives. */
  readonly whose: string;
  /** The tax so far, typed, and what is left of the estimate after it; null where either is missing. */
  readonly stillToPay: Money | null;
  /**
   * Another member's return: the figures they typed themselves are private to them, so this estimate has only what the viewer typed for them,
   * which is said and not hidden, whether none of it or some of it is readable.
   */
  readonly othersFigures: boolean;
  /** The viewer's role can read typed income at all. A viewer reads none, so what looks empty is not figures. */
  readonly readsFigures: boolean;
  /** Where the salary in force came from and when, for the source pill: *From payslip · 14 Apr 2026*. Null when none is saved. */
  readonly salaryOrigin: string | null;
}

export function IncomeTaxCard({
  result,
  regime,
  onRegime,
  inputs,
  save,
  inProgress,
  privacy,
  unreadable,
}: {
  result: IncomeTaxComputation;
  regime: Regime;
  onRegime: (regime: Regime) => void;
  inputs: { readonly salary: IncomeInput; readonly business: IncomeInput; readonly other: IncomeInput; readonly tds: IncomeInput };
  save: SaveState;
  inProgress: boolean;
  privacy: boolean;
  /**
   * Why no figure can be given while an amount typed above cannot be read, or null. An amount that is not a number
   * is not nothing: the total beside it would be the tax on the other amount alone, shown as the answer.
   */
  unreadable: string | null;
}) {
  const [open, setOpen] = useState(false);
  const show = (value: Money): string => formatMoney(value, { privacy });

  const anyRefusal = result.refused[0];
  const whyMissing = anyRefusal === undefined ? '' : REFUSAL_TEXT[anyRefusal];

  /** A figure, or "not shown" with the reason it is not — never a blank. */
  const figure = (value: Money | null, why: string) =>
    value === null || unreadable !== null ? (
      <Absent tone="info" label="Why there is no figure here">
        {unreadable ?? why}
      </Absent>
    ) : (
      show(value)
    );

  return (
    <section className="card card-lift" aria-label="Estimated tax">
      <div className="tax-estimate-top">
        <h2 className="label">Estimated tax</h2>
        <span className="segmented" role="group" aria-label="Tax regime">
          {(['new', 'old'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={regime === option}
              onClick={() => {
                onRegime(option);
              }}
            >
              {option === 'new' ? 'New regime' : 'Old'}
            </button>
          ))}
        </span>
      </div>

      {/* A div, not a p: the mark beside a missing figure opens a popover, and a div may not sit inside a p. */}
      <div className="figure-month tax-figure tabular-nums">
        {unreadable !== null || result.total === null ? (
          <Absent tone="info" label="Why there is no estimate">
            {unreadable ?? whyMissing}
          </Absent>
        ) : (
          show(result.total)
        )}
      </div>
      <p className="note">
        on the income below and {inProgress ? 'this year’s' : 'that year’s'} sales
      </p>
      {save.stillToPay !== null && unreadable === null && result.total !== null && (
        <p className="note tabular-nums" data-testid="still-to-pay">
          {save.stillToPay.minor >= 0n
            ? `still to pay after the tax already deducted: ${show(save.stillToPay)}`
            : `more than the estimate has been deducted: ${show(money(-save.stillToPay.minor, save.stillToPay.currency))}, to come back as a refund`}
        </p>
      )}

      {save.othersFigures && (
        <p className="note mt-2">
          These are {save.whose}’s figures. What {save.whose} typed themselves is private to them and is not in this estimate: only what you typed for them
          is, so it may be missing figures, and nothing here can tell you whether it is.
        </p>
      )}
      {!save.readsFigures && <p className="note mt-2">Your role cannot read typed income, so none of it is in this estimate.</p>}

      <p className="note mt-2">All optional. The estimate covers what is typed, and says what it left out.</p>

      <div className="tax-inputs">
        <IncomeRow
          privacy={privacy}
          label={save.form16 ? 'Gross salary for the year (Form 16)' : 'Gross salary for the year'}
          input={inputs.salary}
          hint={
            save.wasPayslip !== null
              ? `was ${show(save.wasPayslip)} from payslip`
              : 'Typed from the payslip’s gross earnings. Not the CTC, and not the Salary credits in Money, which are take-home.'
          }
        />
        {save.salaryOrigin !== null && (
          <span className="self-start">
            <Pill tone="neutral">{save.salaryOrigin}</Pill>
          </span>
        )}
        <IncomeRow
          privacy={privacy}
          label="Business or professional income"
          input={inputs.business}
          hint="The net profit for the year, from the books or the return, after business expenses. Not the Business income in Money, which is drawings. A loss, presumptive taxation (44AD, 44ADA) and advance-tax instalments are not modelled."
        />
        <IncomeRow privacy={privacy} label="Other income at slab rates" input={inputs.other} hint="Savings and FD interest, rent after its 30%." />
        <IncomeRow privacy={privacy} label="TDS so far" input={inputs.tds} hint="From the payslip or Form 26AS. Optional." />
      </div>

      {save.canSave && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="qa-chip" disabled={save.busy || privacy} onClick={save.onSave}>
            {save.busy ? 'Saving…' : 'Save these figures'}
          </button>
          <button type="button" className="qa-chip" disabled={save.busy || privacy || inputs.salary.text.trim() === ''} onClick={save.onForm16}>
            Correct from Form 16
          </button>
        </div>
      )}
      {save.problem !== null && (
        <p className="field-error mt-2" role="alert">
          {save.problem}
        </p>
      )}
      <p className="note mt-1" role="status">
        {save.said}
      </p>
      <p className="tax-never-saved">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span>
          {!save.readsFigures
            ? 'Typed income is not shown to your role.'
            : save.canSave
              ? `Kept for ${save.whose}, once saved: only they and whoever typed it can read these figures.`
              : 'You can read these figures but not change them.'}
        </span>
      </p>

      {unreadable === null && result.refused.length > 0 && (
        <div className="mt-3.5">
          <MutedNote>{result.refused.map((reason) => REFUSAL_TEXT[reason]).join(' ')}</MutedNote>
        </div>
      )}

      <div className="card-fold">
        <button
          type="button"
          className="disclosure"
          aria-expanded={open}
          aria-controls="tax-workings"
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          <svg
            className="disclosure-chevron"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          How it adds up
        </button>
      </div>

      {open && unreadable !== null && (
        <p id="tax-workings" className="note">
          The working is shown once the amounts above can be read.
        </p>
      )}

      {open && unreadable === null && (
        <dl id="tax-workings" className="flex flex-col">
          <Row label="Salary" value={show(result.salary)} />
          <Row
            label="Standard deduction"
            note="taken off salary, never more than it"
            value={`−${show(result.standardDeduction)}`}
          />
          {result.business.minor > 0n && (
            <Row
              label="Business or professional income"
              note="the net profit typed, taxed at your slab rate with no standard deduction"
              value={show(result.business)}
            />
          )}
          <Row
            label="Other income"
            note="interest, rent, dividends — anything taxed at your slab rate"
            value={show(result.otherIncome)}
          />
          {result.shortTermAtSlab.minor > 0n && (
            <Row
              label="Short-term gold and unlisted gains"
              note="from the sales below, taxed as income"
              value={show(result.shortTermAtSlab)}
            />
          )}
          <Row strong label="Taxable income" value={show(result.taxableOrdinary)} />

          <Row label="Tax at the slab rates" value={figure(result.slabTax, whyMissing)} />
          {result.rebate !== null && result.rebate.minor > 0n && (
            <Row
              label="Rebate under section 87A"
              note="against tax on income, never on a gain"
              value={`−${show(result.rebate)}`}
            />
          )}
          {result.marginalRelief.minor > 0n && (
            <Row
              label="Marginal relief on the rebate"
              note="the tax cannot exceed the income above ₹12 lakh"
              value={`−${show(result.marginalRelief)}`}
            />
          )}
          {(result.surcharge === null || result.surcharge.minor > 0n) && (
            <Row
              label="Surcharge"
              note={
                result.surchargeRelief.minor > 0n
                  ? `after marginal relief of ${show(result.surchargeRelief)}`
                  : 'on tax, once income passes ₹50 lakh'
              }
              value={figure(result.surcharge, whyMissing)}
            />
          )}
          <Row
            label="Tax on capital gains"
            note={
              result.basicExemptionAdjustment.minor > 0n
                ? `at their own rates, after ${show(result.basicExemptionAdjustment)} of unused basic exemption`
                : 'at their own rates'
            }
            value={figure(result.capitalGains.total, REFUSAL_TEXT['capital-gains-tax-unknown'])}
          />
          <Row
            label="Health and education cess"
            note="4% of the above"
            value={figure(result.cess, whyMissing)}
          />
          <Row strong label="Total tax" value={figure(result.total, whyMissing)} />
        </dl>
      )}
    </section>
  );
}

/** An amount typed in: the underline field, its name above and what is wrong with it said under it (simple-layout.md section 3). */
function IncomeRow({ label, input, hint, privacy }: { label: string; input: IncomeInput; hint?: string; privacy: boolean }) {
  // A figure typed into a box is its digits in the markup, so privacy mode shows the masked text in its place while it is on, as every other
  // editable figure does. Switch privacy off to change it.
  if (privacy && input.text.trim() !== '') {
    return <Field label={label} numeric readOnly value="••••••" hint="Hidden while amounts are hidden." onChange={() => undefined} />;
  }
  return (
    <Field
      label={label}
      numeric
      inputMode="decimal"
      placeholder="0"
      {...(hint === undefined ? {} : { hint })}
      value={input.text}
      error={input.error}
      onChange={(event) => {
        input.onChange(event.target.value);
      }}
    />
  );
}

/** One line of the computation: what it is, where it comes from, what it comes to. */
function Row({
  label,
  note,
  value,
  strong = false,
}: {
  label: string;
  note?: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t py-2.5"
      style={{ borderColor: 'var(--line)' }}
    >
      <div className="min-w-0">
        <dt style={{ color: 'var(--ink)', fontWeight: strong ? 600 : 500 }}>{label}</dt>
        {note !== undefined && <span className="note">{note}</span>}
      </div>
      <dd className="tabular-nums" style={{ color: 'var(--ink)', fontWeight: strong ? 600 : 400 }}>
        {value}
      </dd>
    </div>
  );
}
