/**
 * The shape of an allocation, beside the rows that carry its numbers.
 *
 * Not instead of them. A ring shows one thing, relative size, where a row of
 * the same height shows the class, its share, its value and its return, and on
 * a phone that is the difference between a picture and an answer. So the ring
 * sits next to the rows and the rows are still the way to read it: each arc is
 * the colour of the dot on its row, both from `kindColour`, so a class is one
 * colour on the ring, in the rows and everywhere else.
 *
 * One ring per currency, because a share across currencies needs a rate and
 * this is the one place that must not invent one.
 */

import type { AllocationRow } from '../../domain/networth.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { kindColour, kindLabel } from '../../ui/labels.ts';
import { donutArcs } from './chartGeometry.ts';

const SIZE = 208;

export function AllocationDonut({
  rows,
  currency,
  privacy,
}: {
  rows: readonly AllocationRow[];
  currency: string;
  privacy: boolean;
}): React.JSX.Element | null {
  // Sizes are drawn from the amounts, as doubles, only as far as an arc: the
  // total on the ring is summed as bigint and formatted from that.
  const total = rows.reduce((sum, row) => sum + row.value.minor, 0n);
  const arcs = donutArcs(rows.map((row) => ({ key: row.kind, value: Number(row.value.minor) })));
  if (arcs.length === 0) return null;

  const shares = new Map(rows.map((row) => [row.kind, row.share]));
  const words = rows
    .map((row) => `${kindLabel(row.kind)} ${(row.share * 100).toFixed(1)}%`)
    .join(', ');

  return (
    <svg
      className="alloc-donut"
      viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
      role="img"
      aria-label={`Allocation of what is valued, in ${currency}: ${words}`}
    >
      {arcs.map((arc) => (
        <path key={arc.key} d={arc.path} fill={kindColour(arc.key)}>
          <title>{`${kindLabel(arc.key)} ${((shares.get(arc.key) ?? 0) * 100).toFixed(1)}%`}</title>
        </path>
      ))}
      <text className="donut-label" x={SIZE / 2} y={SIZE / 2 - 4} textAnchor="middle">
        TOTAL
      </text>
      <text className="donut-total" x={SIZE / 2} y={SIZE / 2 + 16} textAnchor="middle">
        {formatMoney(money(total, currency), { privacy, compact: true })}
      </text>
    </svg>
  );
}
