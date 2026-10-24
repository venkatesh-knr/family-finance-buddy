import { useMemo, useRef, useState } from 'react';
import { fireProgress, fireProjection, fireWhatIf, whatIfExtra } from '../../domain/fire.ts';
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
import { useDevicePreference } from '../../app/preferences.ts';
import { EARMARK_LABELS } from '../../domain/earmark.ts';
import { Absent, Amount, Button, Card, Caveat, Problem } from '../../ui/primitives.tsx';
import { DraftNumber } from './DraftNumber.tsx';
import type { usePlan } from './usePlan.ts';

/**
 * Where the household stands against its FIRE target and where it is heading, above the planning that
 * sets the target (docs/design/vibrant-canvas.html, the FIRE board).
 *
 * Four things, in the order somebody asks them: what is the number, when does the corpus meet it, how
 * far along is it, and what is a year of living costing. The projection is `fireProjection`
 * (blueprint §06) over the household's own assumptions, and starts from the corpus: the Overview's net
 * worth, from the same hook, less what is earmarked as an emergency fund, a child's savings or a house
 * deposit. The two screens cannot disagree about anything but those earmarks.
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
  const [leftOutOpen, setLeftOutOpen] = useState(false);

  const { annual, projectionLadder, multiplier, inflationPct, returnPct, stepUpPct, monthlyContributionMinor } = plan;
  const first = projectionLadder[0];

  // Nothing valued is not a corpus of nothing. The Overview refuses it for the same reason: a total of
  // zero would say the household owns nothing, and measuring a target against it would say it is
  // nowhere near.
  const nothingValued = data.asOf === null && data.hiddenAssets.length === 0;

  const corpus = useMemo<Money | null>(() => {
    // The corpus and not the net worth: what is set aside as an emergency fund, for a child or for a
    // house is not money the household is counting on to live from (protection-and-flow.md §3).
    const worth = data.fire.corpus;
    if (nothingValued || !worth.ok) return null;
    // Debts can take it below nothing; a corpus cannot be less than none.
    const minor = worth.amount.minor > 0n ? worth.amount.minor : 0n;
    return money(minor, worth.amount.currency);
  }, [data.fire.corpus, nothingValued]);

  // The standing line's figures: what is left out, by earmark, in the same currency as the corpus.
  const leftOut = useMemo(() => {
    const parts = data.fire.excluded.flatMap((entry) =>
      entry.amount.ok && entry.amount.amount.minor > 0n
        ? [{ earmark: entry.earmark, amount: entry.amount.amount }]
        : [],
    );
    const currency = parts[0]?.amount.currency;
    const total =
      currency === undefined ? null : money(parts.reduce((sum, p) => sum + p.amount.minor, 0n), currency);
    const held = data.fire.earmarked;
    const anyEarmarked = held.count.emergency + held.count.child + held.count.house > 0;
    // A total of nothing is not nothing earmarked. A holding nobody has valued, or an amount in a
    // currency with no rate, leaves the sum short, and the line says so rather than read as complete.
    const unconverted = data.fire.excluded.some((entry) => !entry.amount.ok);
    const shortBy: string | null =
      held.unvalued > 0 || unconverted
        ? `${
            held.unvalued > 0
              ? `${String(held.unvalued)} earmarked ${held.unvalued === 1 ? 'holding has' : 'holdings have'} never been valued`
              : ''
          }${held.unvalued > 0 && unconverted ? ' and ' : ''}${unconverted ? 'some earmarked amounts could not be converted without a rate' : ''}, so what is left out is short by ${held.unvalued > 0 && !unconverted ? 'it' : 'them'}.`
        : null;
    return { parts, total, anyEarmarked, shortBy };
  }, [data.fire.excluded, data.fire.earmarked]);

  // The first time the number falls because of this, say why. It is the most consequential figure on
  // the screen and it changed under somebody without their doing anything.
  const [noticeSeen, setNoticeSeen] = useDevicePreference('fire-corpus-notice-seen', false);

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

  // "Adding X a month brings it to year Y": the household's own projection with a round extra put in each month, shown
  // only when it moves the date earlier. A what-if on its own assumptions, and no advice about what to put in.
  const whatIf = useMemo(() => {
    if (projection === null || corpus === null || first === undefined || annual === null) return null;
    const extra = whatIfExtra(annual.total);
    if (extra.currency !== corpus.currency) return null;
    const result = fireWhatIf(
      {
        corpus,
        monthlyContribution: money(monthlyContributionMinor, corpus.currency),
        returnPct,
        stepUpPct,
        ladder: projectionLadder,
      },
      extra,
    );
    if (result.reachedYear === null) return null;
    if (result.baseYear !== null && result.reachedYear >= result.baseYear) return null;
    return { extra, year: result.reachedYear };
  }, [projection, corpus, first, annual, monthlyContributionMinor, returnPct, stepUpPct, projectionLadder]);

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
      <Caveat tone={data.heroActionable ? 'warn' : 'info'} label="Why this figure may be wrong">
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
    // The monthly amount the line is about; with amounts hidden it is text, and the first field is the return.
    const field = assumptions.current?.querySelector<HTMLInputElement>('#fire-contribution');
    (field ?? assumptions.current?.querySelector('input'))?.focus();
  };

  return (
    <div className="flex flex-col gap-4.5">
      <section aria-label="Financial independence">
        <p className="label">Financial independence</p>
        <div className="figure mt-1" title={exactMoney(first.target, privacy) ?? undefined}>
          <Amount value={first.target} privacy={privacy} compact />
        </div>
        {/* One muted line, as the board draws it; what the target and the date rest on is behind its mark. */}
        <p className="note mt-1">
          Target at today&rsquo;s prices, {String(inflationPct)}% inflation
          {reachedYear === null
            ? projection === null
              ? ''
              : ` · not reached within ${String(projectionLadder.length - 1)} years`
            : ` · reached ${String(reachedYear)}`}
          <Caveat tone="info" label="How the target and the date are worked out">
            {multiplier}× what the household spends in a year, at today&rsquo;s prices.
            {projection !== null && (
              <>
                {' '}
                {reachedYear === null
                  ? `With ${assumed}, the corpus does not meet the target as prices rise within ${String(projectionLadder.length - 1)} years. Set a return and what is put in each month below to see where it would be.`
                  : `The date is when the corpus, growing ${assumed}, meets the target as prices rise ${String(inflationPct)}% a year.`}
              </>
            )}
          </Caveat>
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
      />

      <section className="card" aria-label="How far along">
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
        {whatIf !== null && (
          <div className="fire-whatif">
            <span>
              Adding{' '}
              <span className="num fire-whatif-figure">
                <Amount value={whatIf.extra} privacy={privacy} compact />
              </span>{' '}
              a month brings it to {String(whatIf.year)}
            </span>
            <button type="button" className="fire-adjust" onClick={goAdjust}>
              Adjust
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h13" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        {/*
          What is left out of the corpus, stated on the face (PF-C8): the earmarked parts and their total, and that a
          member's private holdings count in full, so the corpus may be high. What else the figure does not hold is one
          press away.
        */}
        <p className="note mt-3" data-testid="fire-left-out">
          {!leftOut.anyEarmarked ? (
            <>Nothing is earmarked, so nothing is left out of the corpus.</>
          ) : leftOut.total === null ? (
            <>
              Holdings earmarked as an emergency fund, a child&rsquo;s savings or a house deposit are left out, but there
              is no amount to show for them: {leftOut.shortBy ?? 'they have no value recorded.'}
            </>
          ) : (
            <>
              Left out because it is set aside for something other than retirement:{' '}
              {leftOut.parts.map((part, index) => (
                <span key={part.earmark}>
                  {index > 0 && ', '}
                  {EARMARK_LABELS[part.earmark].toLowerCase()} <Amount value={part.amount} privacy={privacy} compact />
                </span>
              ))}
              {leftOut.parts.length > 1 && (
                <>
                  {' '}
                  (<Amount value={leftOut.total} privacy={privacy} compact /> in all)
                </>
              )}
              .{leftOut.shortBy !== null && <> {leftOut.shortBy.charAt(0).toUpperCase() + leftOut.shortBy.slice(1)}</>}
            </>
          )}
          {data.fire.privateMembers > 0 && (
            <>
              {' '}
              {data.fire.privateMembers === 1 ? 'One member keeps' : `${String(data.fire.privateMembers)} members keep`}{' '}
              private holdings that count here in full, because their earmarks are not visible to this
              household: the corpus may be high by whatever of it is set aside.
            </>
          )}
        </p>

        <button
          type="button"
          className="disclosure"
          aria-expanded={leftOutOpen}
          aria-controls="fire-rests-on"
          onClick={() => {
            setLeftOutOpen((was) => !was);
          }}
        >
          <DisclosureChevron />
          What else it leaves out
        </button>
        {leftOutOpen && (
          <p id="fire-rests-on" className="note" data-testid="fire-rests-on">
            Against today&rsquo;s target, from net worth as it stands. Property and anything else not yet recorded is
            not in it, so the figure is short by what those are worth.
          </p>
        )}
        {leftOut.anyEarmarked && !noticeSeen && (
          <div className="note mt-3 flex flex-wrap items-center gap-3" role="status">
            <span>
              Earmarked money is not counted, so this is lower than net worth, and lower than this screen used to say.
            </span>
            <Button type="button" onClick={() => setNoticeSeen(true)}>
              Got it
            </Button>
          </div>
        )}
      </section>

      <CostBar annual={annual} privacy={privacy} />

      <div ref={assumptions}>
        <Assumptions plan={plan} editable={editable} privacy={privacy} currency={annual.total.currency} />
      </div>
    </div>
  );
}

/** The turning chevron of a disclosure, as `.disclosure` draws it. */
function DisclosureChevron() {
  return (
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
        stroke="var(--ink-2)"
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
}: {
  plan: Plan;
  privacy: boolean;
  projection: ReturnType<typeof fireProjection> | null;
  reachedYear: number | null;
  noCorpus: string | null;
  warnings: React.ReactNode;
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
      lift
      title="Projection"
      aside={
        <span className="flex items-center gap-2.5">
          {lastStep !== undefined && <span className="note">to {lastStep.year}</span>}
          {warnings}
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
                {/* The target named on its own line, as the board draws it, so there is no legend to read across to. */}
                {(() => {
                  // At the crossing when there is one, so the head and the chart name the same year; else at the end.
                  const at = reachedYear === null ? -1 : shown.findIndex((step) => step.year === reachedYear);
                  const index = at >= 0 ? at : shown.length - 1;
                  const step = shown[index];
                  const point = drawn.chart.target.points[index];
                  if (step === undefined || point === undefined) return null;
                  return (
                    <text
                      className="chart-tick chart-target-label"
                      x={Math.min(point.x, drawn.chart.plot.right)}
                      y={point.y - 0.55 * rem}
                      textAnchor={index === shown.length - 1 ? 'end' : 'middle'}
                    >
                      Target {String(step.year)} · {amount(Number(step.target.minor), step.target.currency)}
                    </text>
                  );
                })()}
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
          {/* One note, with the assumptions behind its mark. A line and not a forecast, and the lines are told apart by shape and by word. */}
          <div className="chart-note">
            <Caveat tone="info" label="What this projection assumes">
              The corpus grows at {plan.returnPct}% a year and has{' '}
              {formatMoney(money(plan.monthlyContributionMinor, plan.annual?.total.currency ?? 'INR'), { privacy })} a
              month put in, raised by {plan.stepUpPct}% each year. The line is measured against the target as prices
              rise {plan.inflationPct}% a year. These are the household&rsquo;s own assumptions, set below. It is
              arithmetic on them and not a forecast: nothing here knows what markets will do.
            </Caveat>
            <span>Assumes contributions continue at the rate set below. Not a forecast.</span>
          </div>
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
                  id="fire-contribution"
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
