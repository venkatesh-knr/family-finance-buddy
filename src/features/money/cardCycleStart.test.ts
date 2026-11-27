import { describe, expect, it } from 'vitest';
import { cycleSwitchSentence, firstStatementMonth, monthYear, statementBeforeFirstMonth } from './cardCycleStart.ts';

/** Where a card's statement date starts, in words (card-cycles.md 6.1, CY-I18): the month after its latest month-end due, which is what the database sets when the card is switched. */
describe('CY-I18 — firstStatementMonth: the month after the card’s latest month-end due', () => {
  it('is November for the design’s card, with dues of 30 September and 31 October and the statement of 17 October between them', () => {
    expect(firstStatementMonth(['2026-09-30', '2026-10-17', '2026-10-31'])).toBe('2026-11');
  });

  it('reads only a due on a month’s last day, so a statement dated mid-month closes nothing', () => {
    expect(firstStatementMonth(['2026-10-17', '2026-11-17'])).toBeNull();
  });

  it('is January for a due on 31 December, and counts 29 February in a leap year', () => {
    expect(firstStatementMonth(['2026-12-31'])).toBe('2027-01');
    expect(firstStatementMonth(['2028-02-29'])).toBe('2028-03');
    expect(firstStatementMonth(['2027-02-28'])).toBe('2027-03');
  });

  it('is nothing for a card with no due at all: it is on its statement date in every month', () => {
    expect(firstStatementMonth([])).toBeNull();
  });
});

describe('CY-I18 — cycleSwitchSentence: what a switch does before it is saved', () => {
  it('says every month when no month was closed at month end, as the design’s wording has it', () => {
    expect(cycleSwitchSentence({ to: 'statement', firstMonth: null })).toBe('Every month will be worked out again with this card’s statements.');
  });

  it('says which months stay as they were, and from which the statements are used', () => {
    expect(cycleSwitchSentence({ to: 'statement', firstMonth: '2026-11' })).toBe(
      'Months up to October 2026 stay as they were, closed at month end. From November 2026 they are worked out with this card’s statements.',
    );
    expect(cycleSwitchSentence({ to: 'statement', firstMonth: '2027-01' })).toContain('up to December 2026');
  });

  it('says a switch back is refused once a statement date’s dues are recorded, since closed months would change', () => {
    expect(cycleSwitchSentence({ to: 'month_end', firstMonth: null })).toBe(
      'This card will close at month end again. That is refused once a due is recorded on its statement date, because months already closed would change.',
    );
  });
});

describe('CY-I18 — statementBeforeFirstMonth: a statement dated in a month the card still closes at month end', () => {
  it('is true for a statement dated before the first month and false from it', () => {
    expect(statementBeforeFirstMonth('2026-10-17', '2026-11')).toBe(true);
    expect(statementBeforeFirstMonth('2026-11-17', '2026-11')).toBe(false);
    expect(statementBeforeFirstMonth('2026-10-17', undefined)).toBe(false);
  });
});

describe('monthYear', () => {
  it('names the month and its year', () => {
    expect(monthYear('2026-11')).toBe('November 2026');
  });
});
