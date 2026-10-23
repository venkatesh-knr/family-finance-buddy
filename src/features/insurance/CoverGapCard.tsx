import { useState } from 'react';
import type { Money } from '../../lib/money.ts';
import { Amount, Notice } from '../../ui/primitives.tsx';
import { MutedNote } from '../../ui/MutedNote.tsx';
import type { InsuranceFacts } from './insuranceFacts.ts';

/**
 * Is the household covered? The one lifted surface on the Insurance screen (docs/design/vibrant-canvas.html).
 *
 * The answer first, stated as what it is: a calculation from the household's own figures, never a recommendation.
 * A number that looks like advice will be read as advice, and the app is not licensed to give it. Under the answer
 * a bar of the term cover in force against the suggested cover, and the working as four lines with every input on
 * the face of the card; the explanation of what the calculation is, and is not, is behind "How this is worked out".
 *
 * Where there is no figure the card says why, in words under the dash: a gap computed on a guess would be the
 * confident wrong number this app is built not to give. What nobody has recorded (a loan's balance, a term
 * policy's cover) is not zero and is said under the working, where it can be put right.
 */
export function CoverGapCard({
  facts,
  years,
  base,
  privacy,
  editable,
  onYears,
}: {
  facts: InsuranceFacts;
  years: number;
  base: string;
  privacy: boolean;
  editable: boolean;
  onYears: (years: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const gap = facts.gap;

  return (
    <section className="card card-lift" aria-label="Is the household covered?">
      <h2 className="label">Is the household covered?</h2>

      {gap === null ? (
        <>
          <div className="figure-month cover-result">
            <span className="absent" role="img" aria-label="not shown">
              —
            </span>
          </div>
          <div className="mt-2.5">
            <MutedNote>
              {facts.gapRefusedBecause === null ? 'Nothing to work out yet.' : `There is no figure yet: ${facts.gapRefusedBecause}`}
            </MutedNote>
          </div>
        </>
      ) : (
        <div data-testid="cover-gap">
          <div className="figure-month cover-result" data-testid="cover-gap-result">
            {gap.short.minor > 0n ? (
              <>
                Short by <Amount value={gap.short} privacy={privacy} compact />
              </>
            ) : (
              'Not short'
            )}
          </div>
          <p className="note">by this arithmetic — a calculation, not advice</p>

          {facts.termCount === 0 ? (
            <p className="note mt-3">Term cover in force: none recorded.</p>
          ) : facts.termCount === facts.termCoverUnknown ? (
            // Term policies with no cover recorded: not a cover of nothing, so no bar and no zero.
            <p className="note mt-3">Term cover in force: not recorded.</p>
          ) : (
            <CoverBar termCover={gap.termCover} suggested={gap.suggested} privacy={privacy} />
          )}

          <dl className="cover-working">
            <div className="cover-line">
              <dt>Still owed on loans</dt>
              <dd className="num">
                <Amount value={gap.liabilities} privacy={privacy} compact />
              </dd>
            </div>
            <div className="cover-line cover-line-years">
              <dt>
                {facts.annualForCover !== null && (
                  <>
                    <Amount value={facts.annualForCover} privacy={privacy} compact /> a year ×{' '}
                  </>
                )}
                <YearsStepper years={years} editable={editable} onYears={onYears} /> years
              </dt>
              <dd className="num">
                <Amount value={gap.expensesOverYears} privacy={privacy} compact />
              </dd>
            </div>
            <div className="cover-line">
              <dt>Less what could be had</dt>
              <dd className="num">
                {privacy ? '' : '−'}
                <Amount value={gap.liquidCorpus} privacy={privacy} compact />
              </dd>
            </div>
            <div className="cover-line cover-line-total">
              <dt>Suggested cover</dt>
              <dd className="num">
                <Amount value={gap.suggested} privacy={privacy} compact />
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* What nobody has recorded is not zero, and it can be recorded: said where the gap is, not behind a fold. */}
      {facts.notes.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2">
          {facts.notes.map((note) => (
            <Notice key={note}>{note}</Notice>
          ))}
        </div>
      )}

      <div className="card-fold">
        <button
          type="button"
          className="disclosure"
          aria-expanded={open}
          aria-controls="cover-explained"
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
          How this is worked out
        </button>
      </div>

      {open && (
        <div id="cover-explained" className="note flex flex-col gap-2.5">
          <p>
            A stated calculation from the figures on this card, every one of them the household&rsquo;s own. It is not
            a recommendation: the app does not know how old the children are or when the mortgage ends, and is not
            licensed to say how much cover to buy. Change any figure and it changes.
          </p>
          <p>
            In {base}. The years of expenses are the household&rsquo;s own setting (ten until changed). A loan&rsquo;s
            instalments are left out of the year&rsquo;s expenses because what is still owed on it is already in the
            sum
            {facts.instalmentsLeftOut !== null && facts.instalmentsLeftOut.minor > 0n && (
              <>
                {' '}
                (<Amount value={facts.instalmentsLeftOut} privacy={privacy} compact /> a year)
              </>
            )}
            . Other members&rsquo; private holdings are not in the money that could be had. Health cover has no
            suggested figure: what is in force is listed below, with its renewal.
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * The term cover in force against the suggested cover, as the board draws it: what is covered, then what is not,
 * with the two named beneath. The two are told apart by fill and by outline, and by their names, and never by
 * colour alone.
 */
function CoverBar({ termCover, suggested, privacy }: { termCover: Money; suggested: Money; privacy: boolean }) {
  const pct =
    suggested.minor <= 0n ? 100 : Math.min(100, Math.round((Number(termCover.minor) / Number(suggested.minor)) * 100));
  const short = termCover.minor < suggested.minor;

  return (
    <>
      <div
        className="cover-bar"
        role="img"
        aria-label={
          privacy
            ? 'Term cover in force against the suggested cover'
            : `Term cover in force is ${String(pct)} percent of the suggested cover${short ? '' : ', or more'}`
        }
      >
        <span className="cover-bar-fill" style={{ width: `${String(pct)}%` }} />
        {short && <span className="cover-bar-rest" />}
      </div>
      <div className="cover-legend">
        <span>
          <i className="cover-swatch cover-swatch-fill" aria-hidden="true" />
          Term cover{' '}
          <span className="num">
            <Amount value={termCover} privacy={privacy} compact />
          </span>
        </span>
        <span>
          {short && <i className="cover-swatch cover-swatch-rest" aria-hidden="true" />}
          Suggested{' '}
          <span className="num">
            <Amount value={suggested} privacy={privacy} compact />
          </span>
        </span>
      </div>
    </>
  );
}

/** Years of dependency, one press at a time. A household setting, saved on each press. */
function YearsStepper({
  years,
  editable,
  onYears,
}: {
  years: number;
  editable: boolean;
  onYears: (years: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const step = (by: number) => {
    setBusy(true);
    void onYears(years + by).finally(() => {
      setBusy(false);
    });
  };

  if (!editable) {
    return (
      <strong role="group" aria-label="Years of dependency">
        {String(years)}
      </strong>
    );
  }

  return (
    <span className="stepper" role="group" aria-label="Years of dependency">
      <button
        type="button"
        aria-label="Fewer years"
        disabled={busy || years <= 0}
        onClick={() => {
          step(-1);
        }}
      >
        −
      </button>
      <output>{String(years)}</output>
      <button
        type="button"
        aria-label="More years"
        disabled={busy || years >= 50}
        onClick={() => {
          step(1);
        }}
      >
        +
      </button>
    </span>
  );
}
