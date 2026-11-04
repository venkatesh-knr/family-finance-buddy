/**
 * What recurs, worked out (docs/design/spending-capture.md section 3; SC-I10).
 *
 * The poster itself is `public.post_due_recurring`, which runs where the rows are and is the only place that enters anything. This is the
 * arithmetic a screen needs of its own: where a stopped rule picks up again, and what a rule comes to in a year. Pure: no I/O and
 * no clock, the day is passed in. Money is integer minor units.
 */

export type Cadence = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

export function cadenceMonths(cadence: Cadence): number {
  switch (cadence) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'half_yearly':
      return 6;
    case 'yearly':
      return 12;
  }
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

function onDay(year: number, monthIndex: number, day: number): string {
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return `${pad(y, 4)}-${pad(m + 1, 2)}-${pad(day, 2)}`;
}

/** The first day on or after `from` that falls on `dueDay` (1 to 28) of its month. */
export function firstDueFrom(from: string, dueDay: number): string {
  const year = Number(from.slice(0, 4));
  const monthIndex = Number(from.slice(5, 7)) - 1;
  const day = Number(from.slice(8, 10));
  return day <= dueDay ? onDay(year, monthIndex, dueDay) : onDay(year, monthIndex + 1, dueDay);
}

/**
 * Where a rule that was stopped (paused, or archived and restored) next falls due. The period it was stopped for is not entered: the
 * poster would enter every due day from the stored one up to today, up to two years of it, for a bill nobody paid while it was off. So
 * the next due day is the first on or after today, unless the stored one is already later.
 */
export function resumeFrom(nextDue: string, dueDay: number, today: string): string {
  const fromToday = firstDueFrom(today, dueDay);
  return nextDue > fromToday ? nextDue : fromToday;
}

/** What a rule comes to over twelve months, so a yearly premium and a monthly bill can be read side by side. */
export function perYear(amountMinor: bigint, cadence: Cadence): bigint {
  return amountMinor * BigInt(12 / cadenceMonths(cadence));
}
