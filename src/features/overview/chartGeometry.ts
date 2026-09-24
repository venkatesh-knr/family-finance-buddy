/**
 * Where a line and a donut go on a page. Nothing here knows what money is.
 *
 * The numbers arrive as plain doubles because a coordinate is not an amount:
 * a figure on screen is drawn to the nearest pixel, and being a fraction of a
 * paise out is invisible. The amounts themselves stay `Money` until they reach
 * this edge, and the labels beside the shapes are formatted from the `Money`,
 * never from these.
 *
 * Kept out of the components so the arithmetic can be tested with hand-worked
 * frames rather than by looking at a drawing.
 */

import { daysBetween, type IsoDate } from '../../lib/dates.ts';

/** A number in a path, to a tenth of a pixel and without a trailing `.0`. */
function n(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * Axis marks from zero to a round number at or above `max`.
 *
 * Steps of 1, 2, 2.5 or 5 times a power of ten, so the marks read as figures
 * a person would choose: ₹25 L, ₹50 L, not ₹24.19 L. Starts at zero because an
 * axis that does not is a picture of the wobble and not of the size.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = (([1, 2, 2.5, 5, 10].find((s) => s >= normalised - 1e-9) ?? 10)) * magnitude;
  const ticks: number[] = [];
  const top = Math.ceil(max / step - 1e-9);
  for (let i = 0; i <= top; i += 1) ticks.push(i * step);
  return ticks;
}

export interface ChartFrame {
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  /**
   * As many x labels as will fit without touching. Below two there is room
   * for one, and it is the last: the as-at date, the one worth reading.
   */
  readonly maxLabels: number;
}

export interface ChartPoint {
  readonly date: IsoDate;
  readonly value: number;
}

export interface LineChart {
  /** The stroke: `M x y L x y …`. */
  readonly line: string;
  /** The same path closed down to the baseline, for the fill under it. */
  readonly area: string;
  /** The last point, where the dot and the figure go. */
  readonly end: { readonly x: number; readonly y: number };
  readonly ticks: readonly { readonly value: number; readonly y: number }[];
  /** The y of the zero line, where the area closes. */
  readonly baseline: number;
  /** Indexes into the points that carry a label, first to last. */
  readonly labels: readonly { readonly index: number; readonly x: number }[];
  readonly plot: { readonly left: number; readonly right: number };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jan 26" — the month and two digits of the year, from a calendar date. */
export function monthLabel(date: IsoDate): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''} ${date.slice(2, 4)}`;
}

/**
 * Lay a series out in a frame. At least two points, oldest first.
 *
 * Spaced by the calendar, not by position in the list. Month-ends are nearly
 * even, but the final point is wherever the last reading was, and drawing a
 * fortnight as long as a month would say the last stretch was slower than it
 * was.
 */
export function lineChart(points: readonly ChartPoint[], frame: ChartFrame): LineChart {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || points.length < 2) {
    throw new Error('A line needs at least two points.');
  }

  const left = frame.left;
  const right = frame.width - frame.right;
  const top = frame.top;
  const baseline = frame.height - frame.bottom;

  const max = points.reduce((m, p) => Math.max(m, p.value), 0);
  const ticks = niceTicks(max);
  const ceiling = ticks[ticks.length - 1] ?? 1;

  const span = daysBetween(first.date, last.date);
  const x = (date: IsoDate): number =>
    span === 0 ? left : left + (daysBetween(first.date, date) / span) * (right - left);
  const y = (value: number): number =>
    ceiling === 0 ? baseline : baseline - (value / ceiling) * (baseline - top);

  const xs = points.map((p) => x(p.date));
  const ys = points.map((p) => y(p.value));
  const line = points.map((_, i) => `${i === 0 ? 'M' : 'L'}${n(xs[i] ?? 0)} ${n(ys[i] ?? 0)}`).join('');
  const area = `${line}L${n(right)} ${n(baseline)}L${n(left)} ${n(baseline)}Z`;

  const wanted = Math.max(1, Math.min(frame.maxLabels, points.length));
  const chosen = new Set<number>();
  if (wanted === 1) chosen.add(points.length - 1);
  for (let j = 0; wanted > 1 && j < wanted; j += 1) {
    chosen.add(Math.round((j * (points.length - 1)) / (wanted - 1)));
  }

  return {
    line,
    area,
    end: { x: xs[xs.length - 1] ?? right, y: ys[ys.length - 1] ?? baseline },
    ticks: ticks.map((value) => ({ value, y: y(value) })),
    baseline,
    labels: [...chosen].sort((a, b) => a - b).map((index) => ({ index, x: xs[index] ?? left })),
    plot: { left, right },
  };
}

export interface DonutSlice {
  readonly key: string;
  readonly value: number;
}

export interface DonutArc {
  readonly key: string;
  readonly path: string;
}

/**
 * The arcs of a ring, from twelve o'clock, clockwise.
 *
 * The prototype's ring on a 208 grid: outer radius 82, inner 52, a gap of about
 * 0.018 radians between slices so neighbours read as separate. A slice too thin
 * to keep its gap is drawn whole rather than vanishing, and one that is not
 * there at all is left out. A ring that is a single class has no neighbour to
 * be separate from and is a full circle — which one arc cannot draw, so it is
 * two halves.
 */
export function donutArcs(
  slices: readonly DonutSlice[],
  size = 208,
  outer = 82,
  inner = 52,
  gap = 0.018,
): DonutArc[] {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (!(total > 0)) return [];
  const c = size / 2;

  const point = (radius: number, angle: number): string =>
    `${n2(c + radius * Math.cos(angle))} ${n2(c + radius * Math.sin(angle))}`;

  const arc = (a0: number, a1: number): string => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return (
      `M${point(outer, a0)}A${String(outer)} ${String(outer)} 0 ${String(large)} 1 ${point(outer, a1)}` +
      `L${point(inner, a1)}A${String(inner)} ${String(inner)} 0 ${String(large)} 0 ${point(inner, a0)}Z`
    );
  };

  const live = slices.filter((s) => s.value > 0);
  if (live.length === 1 && live[0] !== undefined) {
    const start = -Math.PI / 2;
    return [
      { key: live[0].key, path: `${arc(start, start + Math.PI)}${arc(start + Math.PI, start + 2 * Math.PI)}` },
    ];
  }

  const arcs: DonutArc[] = [];
  let angle = -Math.PI / 2;
  for (const slice of slices) {
    const sweep = (Math.max(0, slice.value) / total) * Math.PI * 2;
    if (sweep > gap * 1.4) {
      arcs.push({ key: slice.key, path: arc(angle + gap / 2, angle + sweep - gap / 2) });
    } else if (sweep > 0.0005) {
      arcs.push({ key: slice.key, path: arc(angle, angle + sweep) });
    }
    angle += sweep;
  }
  return arcs;
}

/** Two decimals, for arc endpoints, where a tenth of a pixel shows as a seam. */
function n2(value: number): string {
  return value.toFixed(2);
}
