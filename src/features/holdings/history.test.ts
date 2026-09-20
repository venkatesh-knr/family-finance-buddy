/**
 * The sentence that rides on a figure whose cost is short. It names the
 * numbers, so the numbers are what is held here: the first real import,
 * 280.479 units itemised against 4,013.730 reported on 30 Sep 2026.
 */

import { describe, expect, it } from 'vitest';
import { formatIsoDate } from '../../lib/dates.ts';
import { parseQuantity as q } from '../../lib/quantity.ts';
import { historySentence, unitsText } from './history.ts';

describe('unitsText', () => {
  it('groups the way an Indian statement does and keeps three decimals', () => {
    expect(unitsText(q('4013.73'))).toBe('4,013.730');
    expect(unitsText(q('280.479'))).toBe('280.479');
    expect(unitsText(q('1234567'))).toBe('12,34,567.000');
  });

  it('keeps precision a registrar would not print rather than dropping it', () => {
    expect(unitsText(q('0.12345678'))).toBe('0.12345678');
  });
});

describe('historySentence', () => {
  it('names the arithmetic of a short history', () => {
    const sentence = historySentence({
      kind: 'short',
      lotUnits: q('280.479'),
      statedUnits: q('4013.730'),
      asOf: '2026-09-30',
    });
    expect(sentence).toContain('280.479');
    expect(sentence).toContain('4,013.730');
    // The date as the app writes every date, not a spelling this test picked:
    // the month abbreviation is the runtime's locale data, and varies by it.
    expect(sentence).toContain(formatIsoDate('2026-09-30'));
  });

  it('says the other way round when the purchases are the larger', () => {
    const sentence = historySentence({
      kind: 'over',
      lotUnits: q('5000'),
      statedUnits: q('4013.730'),
      asOf: '2026-09-30',
    });
    expect(sentence).toMatch(/more than/);
  });

  it('says nothing about a position with nothing wrong', () => {
    expect(historySentence({ kind: 'unstated' })).toBeNull();
    expect(
      historySentence({
        kind: 'complete',
        lotUnits: q('10'),
        statedUnits: q('10'),
        asOf: '2026-09-30',
      }),
    ).toBeNull();
  });
});
