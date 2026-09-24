import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import type { Rate } from './fx.ts';
import { assetHistory, monthEndsThrough, type HistoryHolding, type HistoryReading } from './history.ts';

const inr = (rupees: number) => money(BigInt(rupees) * 100n, 'INR');
const usd = (dollars: number) => money(BigInt(dollars) * 100n, 'USD');

const holding = (id: string, currency = 'INR', openedOn: string | null = null): HistoryHolding => ({
  id,
  currency,
  openedOn,
  isArchived: false,
});

const reading = (holdingId: string, date: string, amount = inr(0)): HistoryReading => ({
  holdingId,
  date,
  amount,
});

const run = (
  holdings: HistoryHolding[],
  readings: HistoryReading[],
  asOf: string,
  rates: Rate[] = [],
  display = 'INR',
) => assetHistory({ holdings, readings, rates, display, asOf });

describe('monthEndsThrough', () => {
  it('lists the last day of each month, leap February included', () => {
    expect(monthEndsThrough('2024-01-10', '2024-04-02')).toEqual([
      '2024-01-31',
      '2024-02-29',
      '2024-03-31',
    ]);
  });

  it('includes a month-end that is the end date itself', () => {
    expect(monthEndsThrough('2026-01-15', '2026-02-28')).toEqual(['2026-01-31', '2026-02-28']);
  });

  it('is empty when the end is before the first month-end', () => {
    expect(monthEndsThrough('2026-03-10', '2026-03-20')).toEqual([]);
  });

  it('crosses a year', () => {
    expect(monthEndsThrough('2025-12-05', '2026-01-31')).toEqual(['2025-12-31', '2026-01-31']);
  });
});

describe('assetHistory', () => {
  it('reads each month-end from the latest reading on or before it, then the as-at date', () => {
    // Jan 31 sees the Jan 15 reading; Feb 28 the Feb 10 one; Mar 20 (the as-at
    // point) has no newer reading and repeats Feb 10.
    const result = run(
      [holding('a')],
      [reading('a', '2026-01-15', inr(1000)), reading('a', '2026-02-10', inr(1200))],
      '2026-03-20',
    );
    expect(result).toEqual({
      ok: true,
      points: [
        { date: '2026-01-31', total: inr(1000) },
        { date: '2026-02-28', total: inr(1200) },
        { date: '2026-03-20', total: inr(1200) },
      ],
      limitedBy: null,
    });
  });

  it('counts a reading dated on the month-end itself, and never one dated after', () => {
    const result = run(
      [holding('a')],
      [reading('a', '2026-01-31', inr(1000)), reading('a', '2026-02-01', inr(9999))],
      '2026-02-28',
    );
    expect(result.ok && result.points[0]).toEqual({ date: '2026-01-31', total: inr(1000) });
  });

  it('does not repeat the as-at date when it is a month-end', () => {
    const result = run([holding('a')], [reading('a', '2026-01-15', inr(1000))], '2026-02-28');
    expect(result.ok && result.points.map((p) => p.date)).toEqual(['2026-01-31', '2026-02-28']);
  });

  it('sums holdings, each at its own latest reading', () => {
    const result = run(
      [holding('a'), holding('b')],
      [
        reading('a', '2026-01-10', inr(1000)),
        reading('b', '2026-01-20', inr(500)),
        reading('a', '2026-02-10', inr(1100)),
      ],
      '2026-02-28',
    );
    expect(result.ok && result.points).toEqual([
      { date: '2026-01-31', total: inr(1500) },
      { date: '2026-02-28', total: inr(1600) },
    ]);
  });

  it('starts at the first month every holding has been read, and says what stopped it', () => {
    // b is first read on 5 Feb and has no opening date, so it is owed a
    // reading from the start: 31 Jan would be a total without b in it.
    const result = run(
      [holding('a'), holding('b')],
      [reading('a', '2026-01-10', inr(1000)), reading('b', '2026-02-05', inr(500))],
      '2026-03-15',
    );
    expect(result).toEqual({
      ok: true,
      points: [
        { date: '2026-02-28', total: inr(1500) },
        { date: '2026-03-15', total: inr(1500) },
      ],
      limitedBy: { reason: 'unread', at: '2026-01-31', holdingIds: ['b'] },
    });
  });

  it('does not expect a holding before it was opened', () => {
    const result = run(
      [holding('a'), holding('b', 'INR', '2026-02-01')],
      [reading('a', '2026-01-10', inr(1000)), reading('b', '2026-02-05', inr(500))],
      '2026-02-28',
    );
    expect(result).toEqual({
      ok: true,
      points: [
        { date: '2026-01-31', total: inr(1000) },
        { date: '2026-02-28', total: inr(1500) },
      ],
      limitedBy: null,
    });
  });

  it('expects a holding on its opening date, read or not', () => {
    const result = run(
      [holding('a'), holding('b', 'INR', '2026-01-25')],
      [reading('a', '2026-01-10', inr(1000)), reading('b', '2026-02-05', inr(500))],
      '2026-03-15',
    );
    expect(result.ok && result.limitedBy).toEqual({
      reason: 'unread',
      at: '2026-01-31',
      holdingIds: ['b'],
    });
    expect(result.ok && result.points.map((p) => p.date)).toEqual(['2026-02-28', '2026-03-15']);
  });

  it('leaves archived holdings out of every point', () => {
    const gone = { ...holding('gone'), isArchived: true };
    const result = run(
      [holding('a'), gone],
      [reading('a', '2026-01-10', inr(1000)), reading('gone', '2026-01-10', inr(7000))],
      '2026-02-28',
    );
    expect(result.ok && result.points[0]).toEqual({ date: '2026-01-31', total: inr(1000) });
  });

  it('converts each month at the rate of its own date', () => {
    // $1,000 read on 15 Jan. 31 Jan is at 80, 28 Feb at 90: 80,000 and
    // 90,000 rupees, plus 10,000 rupees held throughout. A past month must not
    // move because the rupee did.
    const rates: Rate[] = [
      { base: 'USD', quote: 'INR', asOf: '2026-01-01', rate: '80' },
      { base: 'USD', quote: 'INR', asOf: '2026-02-20', rate: '90' },
    ];
    const result = run(
      [holding('a'), holding('u', 'USD')],
      [reading('a', '2026-01-10', inr(10000)), reading('u', '2026-01-15', usd(1000))],
      '2026-02-28',
      rates,
    );
    expect(result.ok && result.points).toEqual([
      { date: '2026-01-31', total: inr(90000) },
      { date: '2026-02-28', total: inr(100000) },
    ]);
  });

  it('starts after the months a rate is missing for, and names the pair', () => {
    const rates: Rate[] = [{ base: 'USD', quote: 'INR', asOf: '2026-02-20', rate: '90' }];
    const result = run(
      [holding('u', 'USD')],
      [reading('u', '2026-01-15', usd(1000))],
      '2026-03-10',
      rates,
    );
    expect(result).toEqual({
      ok: true,
      points: [
        { date: '2026-02-28', total: inr(90000) },
        { date: '2026-03-10', total: inr(90000) },
      ],
      limitedBy: { reason: 'rate', at: '2026-01-31', missing: [{ base: 'USD', quote: 'INR' }] },
    });
  });

  it('refuses when the as-at figure itself cannot be converted', () => {
    const result = run([holding('u', 'USD')], [reading('u', '2026-01-15', usd(1000))], '2026-03-10');
    expect(result).toEqual({ ok: false, reason: 'rate', missing: [{ base: 'USD', quote: 'INR' }] });
  });

  it('refuses when a holding has still not been read at the as-at date', () => {
    const result = run(
      [holding('a'), holding('b')],
      [reading('a', '2026-01-10', inr(1000))],
      '2026-03-10',
    );
    expect(result).toEqual({ ok: false, reason: 'unread', holdingIds: ['b'] });
  });

  it('refuses when there is nothing to draw', () => {
    expect(run([], [], '2026-03-10')).toEqual({ ok: false, reason: 'nothing' });
    expect(run([holding('a')], [], '2026-03-10')).toEqual({
      ok: false,
      reason: 'unread',
      holdingIds: ['a'],
    });
  });

  it('refuses a single point, which is a dot and not a history', () => {
    const result = run([holding('a')], [reading('a', '2026-03-10', inr(1000))], '2026-03-20');
    expect(result).toEqual({ ok: false, reason: 'short' });
  });
});
