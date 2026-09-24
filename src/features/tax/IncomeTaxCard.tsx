/**
 * Tax on one person's income — the computation, with every step shown.
 *
 * Slabs, then the rebate, then the surcharge, then the cess, on the salary and
 * other income somebody types in, with the year's capital gains added beside
 * them. Each line is a step a CA can check against a return, and a line that
 * cannot be given says so and why, in place — an empty row would read as a tax of
 * nothing.
 *
 * ── the figures typed here are not saved ────────────────────────────────
 *
 * Deliberately. Salary is the most private figure in the app, and where it lives
 * — whether a member may keep it from the household, who sees its tax effect —
 * is a design of its own that needs a table and its policies reviewed before any
 * screen is built on it. Until then it is held in this page and gone when it is
 * closed, and the card says so beside the fields rather than after somebody has
 * typed a year's salary into a box that forgot it.
 *
 * ── what it does not claim ──────────────────────────────────────────────
 *
 * It applies the standard deduction and no other. The new regime has almost
 * none, so its figure is close to whole; the old regime's is not, and reads high
 * for anyone who claims 80C, 80D or a home-loan deduction — which is why no
 * "which regime is better" verdict is drawn here. That needs the deductions.
 */

import { useMemo, useState } from 'react';
import { computeIncomeTax, type Refusal } from '../../domain/income-tax.ts';
import type { CapitalGains } from '../../domain/capital-gains.ts';
import { freshness, type Regime, type TaxRule } from '../../domain/tax-rules.ts';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money, parseAmountToMinor, type Money } from '../../lib/money.ts';
import { Absent, Card, Field, Notice } from '../../ui/primitives.tsx';

const REFUSAL_TEXT: Record<Refusal, string> = {
  'no-rule-for-year':
    'No slab, cess or standard-deduction rule covers this tax year, so nothing is computed. Earlier years are not loaded, and this app will not apply another year’s slabs to one they did not govern.',
  'surcharge-on-capital-gains':
    'Your income is above ₹50 lakh and includes capital gains. The surcharge on a gain is capped at 15% and has a relief of its own, which is not modelled — so there is no total rather than one that leaves it out.',
  'rebate-relief-on-capital-gains':
    'Your income is just above the rebate ceiling and includes capital gains. How the rebate’s marginal relief combines with a gain is not modelled — so there is no total rather than a guess.',
  'capital-gains-tax-unknown':
    'A capital gain has no rate in the rules for this year, so the tax on it — and so the total — cannot be given.',
};

const ASSUMPTIONS: readonly string[] = [
  'A resident individual under 60. The old regime has a higher basic exemption for seniors, which is not modelled.',
  'Only the standard deduction. No 80C, 80D, home-loan interest or HRA — so the old regime reads high for anyone who claims them, and no verdict is drawn between the two.',
  'Tax is not rounded to the nearest ₹10, as a return rounds it.',
  'Tax already deducted (TDS) and advance tax paid are not credited, so this is the liability and not the balance due.',
  'Capital gains are the sales listed above, for this person, netted as shown there.',
];

/** A rupee amount typed in, as money — zero for empty, and an error for what is not an amount. */
function parseIncome(text: string): { readonly amount: Money; readonly error: string | null } {
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

export function IncomeTaxCard({
  fy,
  gains,
  rules,
  privacy,
  whose,
}: {
  fy: number;
  gains: CapitalGains;
  rules: readonly TaxRule[];
  privacy: boolean;
  /** Whose return, for the sentence that says nothing here is saved. */
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

  const show = (value: Money): string => formatMoney(value, { privacy });
  const checked = freshness(result.verifiedOn, fy);

  /** A figure, or "not shown" with the reason it is not — never a blank. */
  const figure = (value: Money | null, why: string) =>
    value === null ? (
      <Absent label="Why there is no figure here">{why}</Absent>
    ) : (
      show(value)
    );

  const anyRefusal = result.refused[0];
  const whyMissing = anyRefusal === undefined ? '' : REFUSAL_TEXT[anyRefusal];

  return (
    <Card
      title="Tax on your income"
      aside={
        <span className="segmented" role="group" aria-label="Tax regime">
          {(['new', 'old'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={regime === option}
              onClick={() => {
                setRegime(option);
              }}
            >
              {option === 'new' ? 'New regime' : 'Old regime'}
            </button>
          ))}
        </span>
      }
    >

      <p className="note">
        What you enter here is not saved. It is held on this page for {whose}&rsquo;s return and
        gone when you leave it: salary is the most private figure in the app, and where it is kept
        — and who may see its tax effect — is decided before it is stored, not after.
      </p>

      <div className="mt-3.5 flex flex-col gap-3">
        <Field
          label="Salary for the year"
          hint={
            salary.error ??
            'Before the standard deduction, which is taken off automatically. Leave empty if there is none.'
          }
          inputMode="decimal"
          numeric
          placeholder="0.00"
          value={salaryText}
          onChange={(event) => {
            setSalaryText(event.target.value);
          }}
        />
        <Field
          label="Other income the slab taxes"
          hint={other.error ?? 'Interest, rent, dividends — anything that is taxed at your slab rate.'}
          inputMode="decimal"
          numeric
          placeholder="0.00"
          value={otherText}
          onChange={(event) => {
            setOtherText(event.target.value);
          }}
        />
      </div>

      <hr className="my-4" style={{ borderColor: 'var(--line)' }} />

      <dl className="flex flex-col">
        <Row label="Salary" value={show(result.salary)} />
        <Row
          label="Standard deduction"
          note="taken off salary, never more than it"
          value={`−${show(result.standardDeduction)}`}
        />
        <Row label="Other income" value={show(result.otherIncome)} />
        {result.shortTermAtSlab.minor > 0n && (
          <Row
            label="Short-term gold and unlisted gains"
            note="from the sales above, taxed as income"
            value={show(result.shortTermAtSlab)}
          />
        )}
        <Row strong label="Taxable income" value={show(result.taxableOrdinary)} />

        <Row
          label="Tax at the slab rates"
          value={figure(result.slabTax, whyMissing)}
        />
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

      {result.refused.length > 0 && (
        <div className="mt-3.5">
          <Notice tone="due">
            {result.refused.map((reason) => REFUSAL_TEXT[reason]).join(' ')}
          </Notice>
        </div>
      )}

      <p className="note mt-3.5">
        Rates for tax year {String(fy)}–{String((fy + 1) % 100).padStart(2, '0')}
        {result.verifiedOn === null
          ? ', with no record of when they were last checked.'
          : `, last checked against the law on ${formatIsoDate(result.verifiedOn)}.`}
      </p>

      {checked !== 'after-budget' && (
        <div className="mt-3">
          <Notice>
            {checked === 'unrecorded'
              ? 'Nobody has recorded checking these rates against the law. A Budget can change a slab, so treat this as unconfirmed.'
              : `These rates were last checked before this tax year's Budget. A Budget can change a slab or a rebate, so confirm them before relying on this.`}
          </Notice>
        </div>
      )}

      <div className="mt-3">
        <Notice names={ASSUMPTIONS} namesLabel="What this assumes">
          A working paper, computed on the figures above and no more. It is not tax advice, and
          your CA should check it.
        </Notice>
      </div>
    </Card>
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
        <dt style={{ color: 'var(--ink)', fontWeight: strong ? 700 : 500 }}>{label}</dt>
        {note !== undefined && <span className="note">{note}</span>}
      </div>
      <dd className="num" style={{ color: 'var(--ink)', fontWeight: strong ? 700 : 400 }}>
        {value}
      </dd>
    </div>
  );
}
