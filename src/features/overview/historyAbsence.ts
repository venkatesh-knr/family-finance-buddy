import type { AssetHistory } from '../../domain/history.ts';
import { formatIsoDate } from '../../lib/dates.ts';

/** "1 holding" / "3 holdings". */
function holdings(count: number): string {
  return count === 1 ? '1 holding' : `${String(count)} holdings`;
}

/**
 * Why there is no "Assets over time" card, in a line, or null where there is one or there is nothing to
 * draw a history of.
 *
 * The card is hidden until there is a line to draw: an empty card occupied the second place on the screen to
 * say nothing, and the figure above it is what a person came for. What is left is an explanation of an
 * absence of data, which `docs/design/detail-level.md` (DL-I4) keeps visible as that: one muted line under the
 * net worth, saying what is missing and not that something is hidden. Nothing here depends on the detail level.
 */
export function historyAbsence(history: AssetHistory, display: string): string | null {
  if (history.ok) return null;
  switch (history.reason) {
    case 'nothing':
      return null;
    case 'short':
      return 'Assets over time appears once holdings have been read in two different months.';
    case 'stopped':
      return history.limit.reason === 'unread'
        ? `Assets over time needs a month to join today to: ${holdings(history.limit.holdingIds.length)} had no reading on ${formatIsoDate(history.limit.at)}.`
        : `Assets over time needs a month to join today to: no ${history.limit.missing.map((m) => `${m.base} to ${m.quote}`).join(', ')} rate is recorded on or before ${formatIsoDate(history.limit.at)}.`;
    case 'unread':
      return `Assets over time needs every holding read once: ${holdings(history.holdingIds.length)} ${history.holdingIds.length === 1 ? 'has' : 'have'} not been read yet.`;
    case 'rate':
      return `Assets over time cannot be drawn in ${display}: no ${history.missing.map((m) => `${m.base} to ${m.quote}`).join(', ')} rate is recorded.`;
  }
}
