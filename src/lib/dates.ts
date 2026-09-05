/**
 * Dates — calendar dates in IST, never a timestamp pretending to be one.
 *
 * All period boundaries are Asia/Kolkata whatever the device says. A spend on
 * the 5th is on the 5th whether it was entered from Bengaluru or from a laptop
 * still set to UTC, so an expense carries a calendar date and not an instant.
 *
 * Nothing here reads the clock. `istCalendarDate` takes the instant as an
 * argument, which keeps it pure and testable; the one call to `new Date()`
 * lives at the UI edge where it belongs.
 */

/** A calendar date, `YYYY-MM-DD`. Not an instant, and carries no timezone. */
export type IsoDate = string;

const IST = 'Asia/Kolkata';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// en-CA renders as YYYY-MM-DD, which is the format we want to store.
const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DISPLAY_DATE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** The calendar date in Kolkata at the given instant. */
export function istCalendarDate(instant: Date): IsoDate {
  return IST_DATE.format(instant);
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  // Reject 2026-13-01 and 2026-02-30: round-tripping catches both.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Render a calendar date for display.
 *
 * Anchored at UTC midnight on purpose. The value is already a calendar date, so
 * there is nothing to convert — anchoring anywhere else is how a date shifts by
 * a day when the reader happens to be west of Greenwich.
 */
export function formatIsoDate(value: IsoDate): string {
  return DISPLAY_DATE.format(new Date(`${value}T00:00:00Z`));
}
