import { describe, expect, it } from 'vitest';
import type { AssetHistory } from '../../domain/history.ts';
import { historyAbsence } from './historyAbsence.ts';

describe('historyAbsence — one line for why the card is not there', () => {
  it('says nothing when there is a line to draw', () => {
    expect(historyAbsence({ ok: true, points: [], limitedBy: null } as unknown as AssetHistory, 'INR')).toBeNull();
  });

  it('says nothing when there are no holdings, where the figure above already says so', () => {
    expect(historyAbsence({ ok: false, reason: 'nothing' }, 'INR')).toBeNull();
  });

  it('says what is missing for a short history, and does not say anything is hidden', () => {
    const line = historyAbsence({ ok: false, reason: 'short' }, 'INR');
    expect(line).toMatch(/two different months/);
    expect(line).not.toMatch(/hidden/i);
  });

  it('names the month and the holdings that stopped it, and does not say the history is short', () => {
    const line = historyAbsence(
      { ok: false, reason: 'stopped', limit: { reason: 'unread', at: '2026-08-31', holdingIds: ['a', 'b'] } },
      'INR',
    );
    expect(line).toMatch(/31 Aug 2026/);
    expect(line).toMatch(/2 holdings/);
    expect(line).not.toMatch(/two different months/);
  });

  it('names the rate that stopped it', () => {
    const line = historyAbsence(
      { ok: false, reason: 'stopped', limit: { reason: 'rate', at: '2026-08-31', missing: [{ base: 'USD', quote: 'INR' }] } },
      'INR',
    );
    expect(line).toMatch(/USD to INR/);
    expect(line).toMatch(/31 Aug 2026/);
  });

  it('counts the holdings that have not been read', () => {
    expect(historyAbsence({ ok: false, reason: 'unread', holdingIds: ['a'] }, 'INR')).toMatch(/1 holding has not been read/);
    expect(historyAbsence({ ok: false, reason: 'unread', holdingIds: ['a', 'b'] }, 'INR')).toMatch(/2 holdings have not been read/);
  });

  it('names what stopped the line when it is given the names, a property as well as a holding', () => {
    const names: Record<string, string> = { fund: 'Index fund · Meera', house: 'House · Venkat' };
    const nameOf = (id: string) => names[id] ?? 'A holding';
    expect(
      historyAbsence({ ok: false, reason: 'stopped', limit: { reason: 'unread', at: '2026-07-31', holdingIds: ['house'] } }, 'INR', nameOf),
    ).toMatch(/House · Venkat had no reading on 31 Jul 2026/);
    expect(historyAbsence({ ok: false, reason: 'unread', holdingIds: ['fund', 'house'] }, 'INR', nameOf)).toMatch(
      /Index fund · Meera, House · Venkat have not been read yet/,
    );
  });

  it('names the rate that is missing and the currency it was wanted in', () => {
    const line = historyAbsence(
      { ok: false, reason: 'rate', missing: [{ base: 'USD', quote: 'INR' }] },
      'INR',
    );
    expect(line).toMatch(/USD to INR/);
    expect(line).toMatch(/in INR/);
  });
});
