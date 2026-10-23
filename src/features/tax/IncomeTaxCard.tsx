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
 * ── the figures typed here are not saved ────────────────────────────────
 *
 * Deliberately. Salary is the most private figure in the app, and where it lives — whether a member may keep it
 * from the household, who sees its tax effect — is a design of its own that needs a table and its policies
 * reviewed before any screen is built on it. Until then it is held in this page and gone when it is closed, and
 * the card says so beside the fields ("Typed here, never saved") rather than after somebody has typed a year's
 * salary into a box that forgot it.
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
import { formatMoney, money, parseAmountToMinor, type Money } from '../../lib/money.ts';
import { Absent, Problem } from '../../ui/primitives.tsx';
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

/** A rupee amount typed in, as money — zero for empty, and an error for what is not an amount. */
export function parseIncome(text: string): { readonly amount: Money; readonly error: string | null } {
  if (text.trim() === '') return { amount: money(0n, 'INR'), error: null };
  try {
    return { amount: money(parseAmountToMinor(text, 'INR'), 'INR'), error: null };
  } catch (error) {
    return {
      amount: money(0n, 'INR'),
      error: error instanceof Error ? error.message : 'That is not an amount.',
    };
  }
}

/** One of the two amounts typed in: the text, what it was parsed as, and how to change it. */
export interface IncomeInput {
  readonly text: string;
  readonly error: string | null;
  readonly onChange: (text: string) => void;
}

export function IncomeTaxCard({
  result,
  regime,
  onRegime,
  salary,
  other,
  inProgress,
  privacy,
  unreadable,
}: {
  result: IncomeTaxComputation;
  regime: Regime;
  onRegime: (regime: Regime) => void;
  salary: IncomeInput;
  other: IncomeInput;
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

      <div className="tax-inputs">
        <IncomeRow label="Salary for the year" input={salary} />
        <IncomeRow label="Other income at slab rates" input={other} />
      </div>
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
        <span>Typed here, never saved</span>
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

/** An amount typed in, on one line with its name: the board's row, a box with the label at the left. */
function IncomeRow({ label, input }: { label: string; input: IncomeInput }) {
  return (
    <>
      <label className="tax-input">
        <span>{label}</span>
        <input
          type="text"
          inputMode="decimal"
          className="field-num"
          aria-label={label}
          aria-invalid={input.error !== null}
          placeholder="0"
          value={input.text}
          onChange={(event) => {
            input.onChange(event.target.value);
          }}
        />
      </label>
      {input.error !== null && <Problem>{input.error}</Problem>}
    </>
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
