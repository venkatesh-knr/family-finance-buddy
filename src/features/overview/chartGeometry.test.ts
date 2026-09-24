import { describe, expect, it } from 'vitest';
import { donutArcs, lineChart, monthLabel, niceTicks, type ChartFrame } from './chartGeometry.ts';

describe('niceTicks', () => {
  it('rounds up to a figure a person would choose', () => {
    // 96,76,000 paise over four steps is 24,19,000; the next round step is 25,00,000.
    expect(niceTicks(96_760_000)).toEqual([0, 25_000_000, 50_000_000, 75_000_000, 100_000_000]);
  });

  it('does not add a step when the maximum already sits on one', () => {
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100]);
  });

  it('uses steps of 1, 2, 2.5 and 5', () => {
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(40)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(180)).toEqual([0, 50, 100, 150, 200]);
  });

  it('is a lone zero when there is nothing to size', () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(-3)).toEqual([0]);
  });
});

describe('monthLabel', () => {
  it('is the month and two digits of the year', () => {
    expect(monthLabel('2026-01-31')).toBe('Jan 26');
    expect(monthLabel('2025-12-31')).toBe('Dec 25');
  });
});

const frame: ChartFrame = { width: 100, height: 60, top: 10, right: 10, bottom: 10, left: 10, maxLabels: 5 };

describe('lineChart', () => {
  it('spaces points by the calendar and scales the height to the top tick', () => {
    // Ten days apart each: x at 10, 50, 90. Top tick is 100, so 50 is half way
    // up a 40-high plot (y 30) and 100 is at the top (y 10).
    const chart = lineChart(
      [
        { date: '2026-01-01', value: 50 },
        { date: '2026-01-11', value: 100 },
        { date: '2026-01-21', value: 100 },
      ],
      frame,
    );
    expect(chart.line).toBe('M10 30L50 10L90 10');
    expect(chart.area).toBe('M10 30L50 10L90 10L90 50L10 50Z');
    expect(chart.end).toEqual({ x: 90, y: 10 });
    expect(chart.baseline).toBe(50);
    expect(chart.ticks.map((t) => t.y)).toEqual([50, 40, 30, 20, 10]);
  });

  it('draws a short last stretch short', () => {
    // 20 days, then 10: the last segment is a third of the width, not a half.
    const chart = lineChart(
      [
        { date: '2026-01-01', value: 100 },
        { date: '2026-01-21', value: 100 },
        { date: '2026-01-31', value: 100 },
      ],
      frame,
    );
    expect(chart.line).toBe('M10 10L63.3 10L90 10');
  });

  it('labels the first and last and thins the rest to what fits', () => {
    const points = Array.from({ length: 9 }, (_, i) => ({
      date: `2026-0${String(i + 1)}-15`,
      value: 10 * (i + 1),
    }));
    const chart = lineChart(points, { ...frame, maxLabels: 3 });
    expect(chart.labels.map((l) => l.index)).toEqual([0, 4, 8]);
    // With room for one, it is the last: the as-at date.
    const one = lineChart(points, { ...frame, maxLabels: 1 });
    expect(one.labels.map((l) => l.index)).toEqual([8]);
  });

  it('labels every point when there are fewer than fit', () => {
    const chart = lineChart(
      [
        { date: '2026-01-31', value: 1 },
        { date: '2026-02-28', value: 2 },
      ],
      frame,
    );
    expect(chart.labels.map((l) => l.index)).toEqual([0, 1]);
  });

  it('refuses a single point', () => {
    expect(() => lineChart([{ date: '2026-01-31', value: 1 }], frame)).toThrow();
  });
});

describe('donutArcs', () => {
  it('draws a quarter and three quarters on the prototype grid, from twelve o clock', () => {
    const arcs = donutArcs(
      [
        { key: 'a', value: 25 },
        { key: 'b', value: 75 },
      ],
      208,
      82,
      52,
      0,
    );
    expect(arcs).toHaveLength(2);
    // Outer 82 and inner 52 about (104, 104): the quarter runs from the top to the right.
    expect(arcs[0]?.path).toBe(
      'M104.00 22.00A82 82 0 0 1 186.00 104.00L156.00 104.00A52 52 0 0 0 104.00 52.00Z',
    );
    // The three quarters is the larger arc.
    expect(arcs[1]?.path.startsWith('M186.00 104.00A82 82 0 1 1')).toBe(true);
  });

  it('leaves a gap between neighbours', () => {
    const [a, b] = donutArcs([
      { key: 'a', value: 1 },
      { key: 'b', value: 1 },
    ]);
    // With no gap the first would end at exactly (104.00, 186.00); the gap
    // pulls it short, so it does not.
    expect(a?.path).not.toContain('104.00 186.00');
    expect(b?.path).not.toBe(a?.path);
  });

  it('keeps a slice too thin for a gap, and drops one that is not there', () => {
    const arcs = donutArcs([
      { key: 'big', value: 1000 },
      { key: 'thin', value: 3 },
      { key: 'none', value: 0 },
    ]);
    expect(arcs.map((a) => a.key)).toEqual(['big', 'thin']);
  });

  it('draws a ring that is one class, as a whole circle', () => {
    const arcs = donutArcs([
      { key: 'a', value: 5 },
      { key: 'b', value: 0 },
    ]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.path.match(/M/g)?.length).toBe(2);
  });

  it('draws nothing where there is nothing', () => {
    expect(donutArcs([])).toEqual([]);
    expect(donutArcs([{ key: 'a', value: 0 }])).toEqual([]);
  });
});
