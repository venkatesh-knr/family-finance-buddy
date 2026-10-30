import { isIsoDate } from '../../lib/dates.ts';

/**
 * The name of the file an export is saved as, and what the device remembers of the last one.
 *
 * A sample household's file says so in its name, as it does on its first sheet, so a demo export cannot be mistaken for a real
 * one in a folder. The date is the day in India (Asia/Kolkata) the export was made, whatever the device says.
 */

export function exportFilename(householdName: string, isoDate: string, sample: boolean): string {
  const slug = householdName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const day = isIsoDate(isoDate) ? isoDate : 'undated';
  return `family-finance-buddy-${slug === '' ? 'household' : slug}-${day}${sample ? '-sample' : ''}.xlsx`;
}

// ── the last export, kept on this device only ───────────────────────────────────────────────────────────────────

const keyFor = (householdId: string) => `ffb.lastExport.${householdId}`;

/** When this device last made a full export of the household, as an instant; null if it never has, or cannot say. */
export function readLastExport(householdId: string): string | null {
  try {
    const value = window.localStorage.getItem(keyFor(householdId));
    return value !== null && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

export function rememberExport(householdId: string, instant: string): void {
  try {
    window.localStorage.setItem(keyFor(householdId), instant);
  } catch {
    // Private windows and blocked storage refuse; the export has been made either way.
  }
}
