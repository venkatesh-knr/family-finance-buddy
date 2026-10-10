import { useMemo, useRef, useState } from 'react';
import { fireProgress, fireProjection } from '../../domain/fire.ts';
import {
  exactMoney,
  formatMoney,
  minorUnitExponent,
  money,
  parseAmountToMinor,
  type Money,
} from '../../lib/money.ts';
import { projectionChart, type ChartFrame } from '../overview/chartGeometry.ts';
import { useMeasure } from '../overview/AssetsOverTime.tsx';
import { useOverviewData } from '../overview/useOverviewData.ts';
import { Absent, Amount, Button, Card, Caveat, Chevron, Problem } from '../../ui/primitives.tsx';
import { DraftNumber } from './DraftNumber.tsx';
import type { usePlan } from './usePlan.ts';

/**
 * Where the household stands against its FIRE target and where it is heading, above the planning that
 * sets the target (docs/design/vibrant-canvas.html, the FIRE board).
 *
 * Four things, in the order somebody asks them: what is the number, when does the corpus meet it, how
 * far along is it, and what is a year of living costing. The projection is `fireProjection`
 * (blueprint §06) over the household's own assumptions, and starts from the same net worth as the
 * Overview, from the same hook, so the two screens cannot give two answers.
 *
 * It says what it is not. A projection is not a forecast, and this one starts from what has been
 * recorded: property and the rest of the balance sheet arrive in later stages, and until they do the
 * corpus is short by whatever they are worth. That is said on the figure, where it applies.
 */

type Plan = ReturnType<typeof usePlan>;

/** The ring's stroke, as a fraction of its radius. */
const RING = { size: 120, stroke: 11 };

export function FireReadout({
  plan,
  privacy,
  editable,
  displayCurrency,
}: {
  plan: Plan;
  privacy: boolean;
  editable: boolean;
  /** Empty for the household's own currency. A device setting, which the target card below honours. */
  displayCurrency: string;
}) {
  const household = plan.listing?.household;
  const data = useOverviewData({ householdId: household?.id ?? null, displayCurrency: '', scope: 'household' });
  const assumptions = useRef<HTMLDivElement | null>(null);

  const { annual, projectionLadder, multiplier, inflationPct, returnPct, stepUpPct, monthlyContributionMinor } = plan;
  const first = projectionLadder[0];

  // Nothing valued is not a corpus of nothing. The Overview refuses it for the same reason: a total of
  // zero would say the household owns nothing, and measuring a target against it would say it is
  // nowhere near.
  const nothingValued = data.asOf === null && data.hiddenAssets.length === 0;

  const corpus = useMemo<Money | null>(() => {
    if (nothingValued || !data.worth.ok) return null;
    // Debts can take it below nothing; a corpus cannot be less than none.
    const minor = data.worth.amount.minor > 0n ? data.worth.amount.minor : 0n;
    return money(minor, data.worth.amount.currency);
  }, [data.worth, nothingValued]);

  const projection = useMemo(() => {
    if (corpus === null || first === undefined) return null;
    if (corpus.currency !== first.target.currency) return null;
    return fireProjection({
      corpus,
      monthlyContribution: money(monthlyContributionMinor, corpus.currency),
      returnPct,
      stepUpPct,
      ladder: projectionLadder,
    });
  }, [corpus, first, monthlyContributionMinor, returnPct, stepUpPct, projectionLadder]);

  if (annual === null || first === undefined || household === undefined) return null;
  if (annual.total.minor <= 0n) return null;

  // Net worth is read separately from the plan. Until it has been, a corpus of nothing would be drawn
  // as if the household had nothing, and a missing rate as if there were none to be had.
  if (data.loading) return <p className="note py-4.5">Loading…</p>;
  if (data.noHousehold) return null;
  if (data.problem !== null) {
    // The Overview says this too: a read that failed is not a household with nothing in it.
    return (
      <div className="flex flex-col gap-3">
        <Problem>{data.problem}</Problem>
        <div>
          <Button type="button" onClick={() => void data.load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const progress = corpus === null ? null : fireProgress(corpus, first.target);
  const reachedYear = projection?.reachedYear ?? null;
  const base = household.baseCurrency;

  /** What the date rests on, in words: a return of nothing and nothing put in is a projection of the corpus standing still. */
  const assumed = `${String(returnPct)}% a year on the corpus${monthlyContributionMinor === 0n ? ' and nothing put in' : ''}`;

  /** Why there is no corpus, in the words the Overview would use for the same state. */
  const noCorpus: string | null =
    corpus !== null
      ? null
      : nothingValued
        ? 'Nothing has been valued yet, so there is no corpus to measure against the target. Record a value on Holdings and it appears here.'
        : 'Net worth could not be added into one figure, so there is no corpus. The Overview names which rate is missing.';

  /** What is wrong with the corpus, said where it is used: the same list as on the Overview's hero. */
  const warnings =
    data.heroWarnings.length === 0 ? null : (
      <Caveat tone="warn" label="Why this figure may be wrong">
        {data.heroWarnings.length === 1 ? (
          data.heroWarnings[0]
        ) : (
          <ul className="list-disc pl-4.5">
            {data.heroWarnings.map((warning) => (
              <li key={warning} className="mt-1.5 first:mt-0">
                {warning}
              </li>
            ))}
          </ul>
        )}
      </Caveat>
    );

  const goAdjust = (): void => {
    assumptions.current?.scrollIntoView({ block: 'center' });
    assumptions.current?.querySelector('input')?.focus();
  };

  return (
    <div className="flex flex-col gap-4.5">
      <section aria-label="Financial independence">
        <p className="label">Financial independence</p>
        <div className="figure mt-1" title={exactMoney(first.target, privacy) ?? undefined}>
          <Amount value={first.target} privacy={privacy} compact />
        </div>
        <p className="note mt-1">
          {multiplier}× what the household spends, at today&rsquo;s prices
          {reachedYear === null
            ? projection === null
              ? ''
              : ` · not reached within ${String(projectionLadder.length - 1)} years, assuming ${assumed}. Set a return and what is put in each month below to see where it would be`
            : ` · projected to be reached in ${String(reachedYear)}, assuming ${assumed} and ${String(inflationPct)}% inflation`}
        </p>
        {displayCurrency !== '' && displayCurrency !== base && (
          <p className="note mt-1">
            Read in {base}, the household&rsquo;s own currency. The FIRE target below is read in {displayCurrency}.
          </p>
        )}
      </section>

      <ProjectionCard
        plan={plan}
        privacy={privacy}
        projection={projection}
        reachedYear={reachedYear}
        noCorpus={noCorpus}
        warnings={warnings}
        onAdjust={goAdjust}
      />

      <Card title="How far along">
        {progress === null || corpus === null ? (
          <div className="note">
            <Absent label="Why there is no progress yet">{noCorpus}</Absent>
          </div>
        ) : (
          <div className="fire-progress">
            <Ring percent={progress.percent} />
            <dl className="fire-progress-rows">
              <div>
                <dt>Reached</dt>
                <dd>
                  <Amount value={corpus} privacy={privacy} compact />
                  {warnings}
                </dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd className="fire-target">
                  <Amount value={first.target} privacy={privacy} compact />
                </dd>
              </div>
              <div>
                <dt>Shortfall</dt>
                <dd className="fire-short">
                  {progress.shortfall.minor === 0n ? (
                    'none'
                  ) : (
                    <>
                      {privacy ? '' : '−'}
                      <Amount value={progress.shortfall} privacy={privacy} compact />
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}
        <p className="note mt-3">
          Against today&rsquo;s target, from net worth as it stands. Property and anything else not yet
          recorded is not in it, so the figure is short by what those are worth.
        </p>
      </Card>

      <CostBar annual={annual} privacy={privacy} />

      <div ref={assumptions}>
        <Assumptions plan={plan} editable={editable} privacy={privacy} currency={annual.total.currency} />
      </div>
    </div>
  );
}

/** The percentage in a ring, drawn so that over a hundred is a full ring and still says what it is. */
function Ring({ percent }: { percent: number }) {
  const r = (RING.size - RING.stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (Math.min(Math.max(percent, 0), 100) / 100) * c;
  return (
    <svg
      className="fire-ring"
      viewBox={`0 0 ${String(RING.size)} ${String(RING.size)}`}
      role="img"
      aria-label={`${String(percent)} per cent of today's target`}
    >
      <circle cx={RING.size / 2} cy={RING.size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={RING.stroke} />
      <circle
        cx={RING.size / 2}
        cy={RING.size / 2}
        r={r}
        fill="none"
        stroke="var(--teal)"
        strokeWidth={RING.stroke}
        strokeLinecap="round"
        strokeDasharray={`${String(filled)} ${String(c)}`}
        transform={`rotate(-90 ${String(RING.size / 2)} ${String(RING.size / 2)})`}
      />
      <text className="fire-ring-text" x={RING.size / 2} y={RING.size / 2} textAnchor="middle" dominantBaseline="central">
        {percent}%
      </text>
    </svg>
  );
}

function ProjectionCard({
  plan,
  privacy,
  projection,
  reachedYear,
  noCorpus,
  warnings,
  onAdjust,
}: {
  plan: Plan;
  privacy: boolean;
  projection: ReturnType<typeof fireProjection> | null;
  reachedYear: number | null;
  noCorpus: string | null;
  warnings: React.ReactNode;
  onAdjust: () => void;
}) {
  const { ref, width, rem } = useMeasure(projection !== null);

  const shown = useMemo(() => {
    if (projection === null) return [];
    const reachedAt = projection.steps.findIndex((s) => s.year === reachedYear);
    // Two years past the crossing so it is seen to cross, and never fewer than the horizon the
    // household asked for or five years, so a near target is not a stub.
    const want = reachedAt >= 0 ? reachedAt + 2 : Math.max(plan.yearsAhead, 5);
    return projection.steps.slice(0, Math.min(projection.steps.length, Math.max(want, 5) + 1));
  }, [projection, reachedYear, plan.yearsAhead]);

  const drawn = useMemo(() => {
    if (width === 0 || shown.length < 2) return null;
    const frame: ChartFrame = {
      width,
      height: 12 * rem,
      top: 1.5 * rem,
      right: 1 * rem,
      bottom: 2 * rem,
      left: 4.25 * rem,
      maxLabels: Math.max(2, Math.min(6, Math.floor((width - 5.25 * rem) / (5 * rem)))),
    };
    return {
      frame,
      chart: projectionChart(
        shown.map((s) => ({ year: s.year, corpus: Number(s.corpus.minor), target: Number(s.target.minor) })),
        frame,
      ),
    };
  }, [shown, width, rem]);

  const lastStep = shown[shown.length - 1];
  const firstStep = shown[0];
  const amount = (minor: number, currency: string): string =>
    formatMoney(money(BigInt(Math.round(minor)), currency), { privacy, compact: true });

  return (
    <Card
      title="Projection"
      aside={
        <span className="flex items-center gap-2.5">
          {lastStep !== undefined && <span className="note">to {lastStep.year}</span>}
          {warnings}
          <Caveat tone="info" label="What this projection assumes">
            The corpus grows at {plan.returnPct}% a year and has {formatMoney(money(plan.monthlyContributionMinor, plan.annual?.total.currency ?? 'INR'), { privacy })} a
            month put in, raised by {plan.stepUpPct}% each year. The line is measured against the target as
            prices rise {plan.inflationPct}% a year. These are the household&rsquo;s own assumptions, set
            below. It is arithmetic on them and not a forecast: nothing here knows what markets will do.
          </Caveat>
        </span>
      }
    >
      {projection === null ? (
        <p className="note">{noCorpus ?? 'Nothing to project yet.'}</p>
      ) : (
        <>
          <div ref={ref} className="chart">
            {drawn !== null && firstStep !== undefined && lastStep !== undefined && (
              <svg
                width={drawn.frame.width}
                height={drawn.frame.height}
                role="img"
                aria-label={
                  privacy
                    ? `The corpus against the target from ${String(firstStep.year)} to ${String(lastStep.year)}, amounts hidden`
                    : `The corpus is ${formatMoney(firstStep.corpus, { compact: true })} in ${String(firstStep.year)} and ${formatMoney(lastStep.corpus, { compact: true })} by ${String(lastStep.year)}, against a target of ${formatMoney(lastStep.target, { compact: true })}`
                }
              >
                {drawn.chart.ticks.map((tick) => (
                  <g key={tick.value}>
                    <line x1={drawn.chart.plot.left} x2={drawn.chart.plot.right} y1={tick.y} y2={tick.y} stroke="var(--line)" strokeWidth="1" />
                    <text className="chart-tick" x={drawn.chart.plot.left - 0.6 * rem} y={tick.y} textAnchor="end" dominantBaseline="central">
                      {tick.value === 0 ? '0' : amount(tick.value, firstStep.corpus.currency)}
                    </text>
                  </g>
                ))}
                <path d={drawn.chart.corpus.area} fill="var(--ink-2)" opacity="0.14" />
                <path d={drawn.chart.target.line} fill="none" stroke="var(--brass)" strokeWidth="2" strokeDasharray="6 5" />
                <path d={drawn.chart.corpus.line} fill="none" stroke="var(--ink-2)" strokeWidth="2.4" />
                <circle cx={drawn.chart.corpus.end.x} cy={drawn.chart.corpus.end.y} r="4" fill="var(--ink-2)" />
                {reachedYear !== null &&
                  (() => {
                    const index = shown.findIndex((s) => s.year === reachedYear);
                    const point = drawn.chart.corpus.points[index];
                    return point === undefined ? null : (
                      <circle cx={point.x} cy={point.y} r="5" fill="var(--surface)" stroke="var(--ink-2)" strokeWidth="2.4" />
                    );
                  })()}
                {drawn.chart.labels.map((label, i, all) => {
                  const step = shown[label.index];
                  if (step === undefined) return null;
                  return (
                    <text
                      key={label.index}
                      className="chart-tick"
                      x={label.x}
                      y={drawn.frame.height - 0.6 * rem}
                      textAnchor={i === all.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}
                    >
                      {step.year}
                    </text>
                  );
                })}
              </svg>
            )}
          </div>
          {/* The two lines told apart by shape and by word, not by colour alone. */}
          <ul className="fire-legend">
            <li>
              <svg width="26" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="26" y2="4" stroke="var(--ink-2)" strokeWidth="2.4" />
              </svg>
              Corpus
            </li>
            <li>
              <svg width="26" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="26" y2="4" stroke="var(--brass)" strokeWidth="2" strokeDasharray="6 5" />
              </svg>
              Target, as prices rise
            </li>
            {reachedYear !== null && (
              <li>
                <svg width="12" height="12" aria-hidden="true">
                  <circle cx="6" cy="6" r="4.5" fill="var(--surface)" stroke="var(--ink-2)" strokeWidth="2" />
                </svg>
                Reached in {reachedYear}
              </li>
            )}
          </ul>
          <p className="note fire-assumes">
            Assumes contributions continue at the rate set below. Not a forecast.{' '}
            <button type="button" className="fire-adjust" onClick={onAdjust}>
              Adjust <Chevron />
            </button>
          </p>
        </>
      )}
    </Card>
  );
}

/** What a year of living costs, by where it goes. Text and shape as well as colour. */
function CostBar({ annual, privacy }: { annual: NonNullable<Plan['annual']>; privacy: boolean }) {
  // Neutral steps, told apart by the word and the share beside each: a cost is not an asset class, and a
  // class colour on it would say it was one (docs/tokens.md §6).
  const parts = [
    { key: 'category', label: 'Living', value: annual.bySource.category, colour: 'var(--ink-2)' },
    { key: 'liability', label: 'Loans', value: annual.bySource.liability, colour: 'var(--muted)' },
    { key: 'policy', label: 'Premiums', value: annual.bySource.policy, colour: 'var(--line-strong)' },
  ].filter((p) => p.value.minor > 0n);
  const total = annual.total.minor;
  if (total <= 0n || parts.length === 0) return null;
  const share = (v: Money): number => Number((v.minor * 1000n) / total) / 10;

  return (
    <Card
      title="What a year costs"
      aside={
        <span className="fire-cost-total">
          <Amount value={annual.total} privacy={privacy} compact />
        </span>
      }
    >
      <div className="fire-cost-bar" role="img" aria-label={parts.map((p) => `${p.label} ${String(Math.round(share(p.value)))}%`).join(', ')}>
        {parts.map((p) => (
          <span key={p.key} style={{ background: p.colour, flexGrow: Number(p.value.minor) }} />
        ))}
      </div>
      <ul className="fire-cost-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className="fire-cost-swatch" style={{ background: p.colour }} aria-hidden="true" />
            {p.label} <span className="note">{Math.round(share(p.value))}%</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The three assumptions the projection stands on, written to the household like the rest. */
function Assumptions({
  plan,
  editable,
  privacy,
  currency,
}: {
  plan: Plan;
  editable: boolean;
  privacy: boolean;
  currency: string;
}) {
  const exponent = minorUnitExponent(currency);
  const stored = (Number(plan.monthlyContributionMinor) / 10 ** exponent).toString();
  const [draft, setDraft] = useState<string | null>(null);

  const commitContribution = (): void => {
    if (draft === null) return;
    try {
      const minor = parseAmountToMinor(draft === '' ? '0' : draft, currency);
      if (minor >= 0n) plan.setMonthlyContributionMinor(minor);
    } catch {
      /* not a figure: the field goes back to what the household has */
    }
    setDraft(null);
  };

  return (
    <Card
      title="What the projection assumes"
      aside={
        <Caveat tone="info" label="Why these are the household's to set">
          None of these is a fact about the future. They are shared across the household, so a couple
          sees one projection, and changing one moves the line above at once.
        </Caveat>
      }
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3.5">
        <label className="flex flex-col gap-1.5">
          <span className="label">Put in each month</span>
          <span className="flex items-center gap-2">
            {/*
              An amount typed in a box is its digits in the page, and privacy mode removes the amount, not
              hides it. So while it is on, or when the role cannot edit, the figure is text, masked by the
              formatter like every other.
            */}
            {editable && !privacy ? (
              <>
                <span className="note">{currency}</span>
                <input
                  className="field field-num w-[110px]"
                  inputMode="decimal"
                  value={draft ?? stored}
                  onChange={(event) => {
                    setDraft(event.target.value);
                  }}
                  onBlur={commitContribution}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitContribution();
                  }}
                />
              </>
            ) : (
              <span className="tabular-nums">
                {formatMoney(money(plan.monthlyContributionMinor, currency), { privacy })}
              </span>
            )}
          </span>
        </label>
        <PctField label="Return" value={plan.returnPct} max={50} editable={editable} onSave={plan.setReturnPct} />
        <PctField
          label="Raise the contribution by"
          value={plan.stepUpPct}
          max={50}
          editable={editable}
          onSave={plan.setStepUpPct}
        />
      </div>
      {!editable && (
        <p className="note mt-3">Only an owner or partner can change these.</p>
      )}
    </Card>
  );
}

/** A percentage a year, typed and then kept: a draft until the field is left (`draftNumber.ts` says why). */
function PctField({
  label,
  value,
  max,
  editable,
  onSave,
}: {
  label: string;
  value: number;
  max: number;
  editable: boolean;
  onSave: (next: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <DraftNumber
          className="field field-num w-[62px]"
          value={value}
          range={{ min: 0, max, integer: false }}
          disabled={!editable}
          onSave={onSave}
        />
        <span className="note">% a year</span>
      </span>
    </label>
  );
}
