/**
 * What the page says about itself: one muted line, and two buttons for the rest.
 *
 * "It fills the schedules, it does not file the return." A figure on a page called Tax will be read as
 * authoritative whatever the small print says, so the line is there on every visit — a working paper, not a
 * filing, a CA should check it, and when the rates were last checked — and the rest is one press away: what the
 * estimate assumes and what it leaves out, and the rates it was rated with. Not several paragraphs and two amber
 * notices: amber is for what a person can act on (docs/tokens.md §2), and nobody here can make a Budget land.
 *
 * Where the rates were last checked is said in the line itself, in the same words every time and a different last
 * sentence: a date, a date that is before this year's Budget, or no record at all. A Budget can change a slab, so
 * the last two read as unconfirmed.
 */

import { useState } from 'react';
import type { RatesApplied } from '../../domain/income-tax.ts';
import type { IsoDate } from '../../lib/dates.ts';
import { formatIsoDate } from '../../lib/dates.ts';
import { RatesCard, hasRates } from './RatesCard.tsx';

/** What the estimate assumes, in the order a CA would check them. */
const ASSUMPTIONS: readonly string[] = [
  'A resident individual under 60. The old regime has a higher basic exemption for seniors, which is not modelled.',
  'Only the standard deduction. No 80C, 80D, home-loan interest or HRA — so the old regime reads high for anyone who claims them, and no verdict is drawn between the two.',
  'Tax is not rounded to the nearest ₹10, as a return rounds it.',
  'Tax already deducted (TDS) and advance tax paid are not credited, so this is the liability and not the balance due.',
  'Capital gains are the sales listed on this page, for this person, netted as shown there.',
];

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

type Panel = 'assumes' | 'rates';

export function TaxNotes({
  fy,
  windowText,
  verifiedOn,
  checked,
  applied,
  whose,
}: {
  fy: number;
  /** The tax year as dates: "1 Apr 2026 to 31 Mar 2027". */
  windowText: string;
  verifiedOn: IsoDate | null;
  checked: 'unrecorded' | 'before-budget' | 'after-budget';
  applied: RatesApplied;
  /** Whose return, for the sentence that says nothing typed here is saved. */
  whose: string;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const toggle = (which: Panel) => {
    setPanel((was) => (was === which ? null : which));
  };

  const line =
    checked === 'unrecorded'
      ? 'Nobody has recorded checking these rates against the law, so treat them as unconfirmed.'
      : verifiedOn !== null && checked === 'before-budget'
        ? `Rates last checked ${formatIsoDate(verifiedOn)}, before this tax year’s Budget — confirm them before relying on this.`
        : verifiedOn !== null
          ? `Rates checked ${formatIsoDate(verifiedOn)}.`
          : '';

  return (
    <>
      <div className="muted-note" data-testid="tax-caveat">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
        <span>A working paper, not a filing — your CA should check it. {line}</span>
      </div>

      <div className="tax-note-buttons">
        <button
          type="button"
          className="quiet-button tax-chip"
          aria-expanded={panel === 'assumes'}
          aria-controls="tax-assumes"
          onClick={() => {
            toggle('assumes');
          }}
        >
          What this assumes
        </button>
        {hasRates(applied) && (
          <button
            type="button"
            className="quiet-button tax-chip"
            aria-expanded={panel === 'rates'}
            aria-controls="tax-rates"
            onClick={() => {
              toggle('rates');
            }}
          >
            Rates applied
          </button>
        )}
      </div>

      {panel === 'assumes' && (
        <section className="card" id="tax-assumes" aria-label="What this assumes">
          <h2 className="card-title font-sans">What this assumes</h2>
          <p className="note mt-2">
            This page computes tax on the salary and other income you type in, and on capital gains on listed
            equity, equity funds, gold and unlisted shares, with only the standard deduction. It is an estimate of
            the liability on those figures and not the whole return — not tax advice, and your CA should check it.
          </p>
          <ul className="tax-list">
            <li>
              Tax year {String(fy)}–{String((fy + 1) % 100).padStart(2, '0')} runs {windowText}, IST.
            </li>
            <li>
              One person at a time. Tax is filed per person, and the ₹1.25 lakh equity allowance is each person’s
              own: adding two people together would give them one allowance between them, or set one person’s loss
              against the other’s gain.
            </li>
            <li>
              What you type for salary and other income is held on this page for {whose}’s return and gone when you
              leave it. Salary is the most private figure in the app, and where it is kept — and who may see its tax
              effect — is decided before it is stored, not after.
            </li>
            <li>
              A sale is matched first-in, first-out to its purchases, and each parcel is held for its own period — a
              sale that spans two purchases can be part long term and part short. The term is decided by the rule in
              force on the day of the sale, not today’s. No gain is ever stored; each is computed from the lots.
            </li>
            {ASSUMPTIONS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h3 className="label mt-3.5">Still to come</h3>
          <ul className="tax-list">
            {STILL_TO_COME.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {panel === 'rates' && <RatesCard applied={applied} id="tax-rates" />}
    </>
  );
}
