/**
 * What the household's holdings were worth, month by month, since they were
 * first read.
 *
 * Titled "Assets" and not "Net worth", and the marker on the heading says why:
 * a loan records an instalment, and only some have a dated balance, so there is
 * no history of debt to take off. Drawing it would be a line that looks like net
 * worth and is high by whatever was owed.
 *
 * Every colour is a token, and none is the colour of a class: this is a total
 * over all of them, and a total in the equity colour would read as equity.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetHistory } from '../../domain/history.ts';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { Card, Caveat } from '../../ui/primitives.tsx';
import { lineChart, monthLabel, type ChartFrame } from './chartGeometry.ts';

/**
 * The width the container has, and the root font size the frame is measured in.
 *
 * `present` is whether the container is in the tree at all: it is only there
 * when there is a line to draw, and an effect that ran once while it was absent
 * would never look again.
 */
function useMeasure(present: boolean): { ref: React.RefObject<HTMLDivElement | null>; width: number; rem: number } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, rem: 16 });
  useEffect(() => {
    const node = ref.current;
    if (node === null) return undefined;
    const read = (): void => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      setSize({ width: node.clientWidth, rem: Number.isFinite(rem) && rem > 0 ? rem : 16 });
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [present]);
  return { ref, width: size.width, rem: size.rem };
}

/** "1 holding" / "3 holdings". The names are on the reading-gaps card below; a sentence of fund names is not a sentence. */
function holdings(count: number): string {
  return count === 1 ? '1 holding' : `${String(count)} holdings`;
}

export function AssetsOverTime({
  history,
  display,
  privacy,
  otherPrivate,
}: {
  history: AssetHistory;
  display: string;
  privacy: boolean;
  /** Whether other members' private holdings exist and are therefore not in the line. */
  otherPrivate: boolean;
}): React.JSX.Element | null {
  const { ref, width, rem } = useMeasure(history.ok);

  const drawn = useMemo(() => {
    if (!history.ok || width === 0) return null;
    const frame: ChartFrame = {
      width,
      height: 11 * rem,
      top: 1.75 * rem,
      right: 1 * rem,
      bottom: 2 * rem,
      left: 4.25 * rem,
      maxLabels: Math.max(1, Math.min(6, Math.floor((width - 5.25 * rem) / (5 * rem)))),
    };
    return {
      frame,
      chart: lineChart(
        history.points.map((p) => ({ date: p.date, value: Number(p.total.minor) })),
        frame,
      ),
    };
  }, [history, width, rem]);

  // Nothing to draw a history of: no card, not an empty one.
  if (!history.ok && history.reason === 'nothing') return null;

  const amount = (minor: number): string =>
    formatMoney(money(BigInt(Math.round(minor)), display), { privacy, compact: true });

  const heading = (
    <Caveat tone="info" label="What this line is">
      Assets only, read in {display}. Each month is the latest reading of every holding on or before
      its last day, converted at the exchange rate of that day, so a past month does not move when
      the rate does. Debt is not taken off: a loan has no dated balance to draw a history from, so
      this is not net worth.
    </Caveat>
  );

  if (!history.ok) {
    let words: string;
    if (history.reason === 'short') {
      words = 'There is a line to draw once holdings have been read in two different months.';
    } else if (history.reason === 'unread') {
      words = `${holdings(history.holdingIds.length)} ${history.holdingIds.length === 1 ? 'has' : 'have'} not been read yet, so there is no total to draw a history of.`;
    } else {
      words = `No ${history.missing.map((m) => `${m.base} to ${m.quote}`).join(', ')} rate is recorded, so this cannot be drawn in ${display}.`;
    }
    return (
      <Card title="Assets over time" aside={heading}>
        <p className="note">{words}</p>
      </Card>
    );
  }

  const first = history.points[0];
  const last = history.points[history.points.length - 1];
  const limit = history.limitedBy;

  return (
    <Card
      title="Assets over time"
      aside={
        <span className="flex items-center gap-2.5">
          <span className="note">read in {display}</span>
          {heading}
        </span>
      }
    >
      <div ref={ref} className="chart">
        {drawn !== null && first !== undefined && last !== undefined && (
          <svg
            width={drawn.frame.width}
            height={drawn.frame.height}
            role="img"
            aria-label={
              privacy
                ? `Assets from ${monthLabel(first.date)} to ${monthLabel(last.date)}, amounts hidden`
                : `Assets from ${monthLabel(first.date)}, ${formatMoney(first.total, { compact: true })}, to ${monthLabel(last.date)}, ${formatMoney(last.total, { compact: true })}`
            }
          >
            {drawn.chart.ticks.map((tick) => (
              <g key={tick.value}>
                <line
                  x1={drawn.chart.plot.left}
                  x2={drawn.chart.plot.right}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="var(--line)"
                  strokeWidth="1"
                />
                <text
                  className="chart-tick"
                  x={drawn.chart.plot.left - 0.6 * rem}
                  y={tick.y}
                  textAnchor="end"
                  dominantBaseline="central"
                >
                  {tick.value === 0 ? '0' : amount(tick.value)}
                </text>
              </g>
            ))}
            <path d={drawn.chart.area} fill="var(--ink-2)" opacity="0.14" />
            <path d={drawn.chart.line} fill="none" stroke="var(--ink-2)" strokeWidth="2.2" />
            <circle cx={drawn.chart.end.x} cy={drawn.chart.end.y} r="4" fill="var(--ink-2)" />
            <text
              className="chart-end"
              x={drawn.chart.end.x}
              y={drawn.chart.end.y - 0.7 * rem}
              textAnchor="end"
            >
              {formatMoney(last.total, { privacy, compact: true })}
            </text>
            {drawn.chart.labels.map((label, i, all) => {
              const point = history.points[label.index];
              if (point === undefined) return null;
              return (
                <text
                  key={label.index}
                  className="chart-tick"
                  x={label.x}
                  y={drawn.frame.height - 0.6 * rem}
                  textAnchor={i === all.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}
                >
                  {monthLabel(point.date)}
                </text>
              );
            })}
          </svg>
        )}
      </div>

      {first !== undefined && (
        <p className="note mt-2">
          Since {formatIsoDate(first.date)}.
          {limit !== null &&
            (limit.reason === 'unread'
              ? ` On ${formatIsoDate(limit.at)}, ${holdings(limit.holdingIds.length)} had no reading, so an earlier total would have left ${limit.holdingIds.length === 1 ? 'it' : 'them'} out.`
              : ` No ${limit.missing.map((m) => `${m.base} to ${m.quote}`).join(', ')} rate was recorded on or before ${formatIsoDate(limit.at)}.`)}
        </p>
      )}
      {otherPrivate && (
        <p className="note mt-1">
          Other members&rsquo; private holdings are not in this line: their detail is theirs, and a
          sum without dates cannot be placed on a month.
        </p>
      )}
    </Card>
  );
}
