import { describe, expect, it } from 'vitest';
import { activityLine, activityPhrase, clockTime, dayLabel, groupByDay } from './activity.ts';

// Local times, as the screen reads them: the device's own clock is what "today" means here.
const at = (month: number, day: number, hour: number, minute = 0) => new Date(2026, month - 1, day, hour, minute).toISOString();
const now = new Date(2026, 9, 15, 22, 0);

describe('the log in plain words', () => {
  it('says what was done, as the board does: "Recorded a value", "Added a policy", "Renewed"', () => {
    expect(activityPhrase('valuation_snapshot', 'insert')).toBe('Recorded a value');
    expect(activityPhrase('insurance_policy', 'insert')).toBe('Added a policy');
    expect(activityPhrase('deposit_renewal', 'insert')).toBe('Renewed');
    expect(activityPhrase('import_batch', 'insert')).toBe('Imported a statement');
  });

  it('tells a correction from a first entry, and a removal from both', () => {
    expect(activityPhrase('lot', 'insert')).toBe('Recorded a purchase');
    expect(activityPhrase('lot', 'update')).toBe('Corrected a purchase');
    expect(activityPhrase('expense_txn', 'delete')).toBe('Removed an expense');
  });

  it('shows an unknown table by its name and not as nothing: unlabelled should look unfinished', () => {
    expect(activityPhrase('reminder_rule', 'update')).toBe('Changed reminder rule');
    expect(activityPhrase('something_new', 'read')).toBe('Read something new');
  });

  it('puts a name after the sentence only when there is one', () => {
    expect(activityLine('Recorded a value', 'Parag Parikh Flexi Cap')).toEqual({ lead: 'Recorded a value', name: 'Parag Parikh Flexi Cap' });
    expect(activityLine('Changed a budget', null)).toEqual({ lead: 'Changed a budget', name: null });
    expect(activityLine('Added an expense', '   ')).toEqual({ lead: 'Added an expense', name: null });
  });
});

describe('days and times', () => {
  it('calls today and yesterday by those names and any other day by its date', () => {
    expect(dayLabel(at(10, 15, 21, 42), now)).toBe('Today');
    expect(dayLabel(at(10, 14, 6, 5), now)).toBe('Yesterday');
    expect(dayLabel(at(10, 13, 18, 5), now)).toBe('13 Oct');
  });

  it('reads the time as the board does: "9:42 pm"', () => {
    expect(clockTime(at(10, 15, 21, 42))).toBe('9:42 pm');
    expect(clockTime(at(10, 13, 11, 18))).toBe('11:18 am');
  });

  it('gathers entries under their day, in the order given, with one heading a day', () => {
    const groups = groupByDay(
      [{ at: at(10, 15, 21, 42) }, { at: at(10, 15, 21, 30) }, { at: at(10, 13, 18, 5) }, { at: at(10, 13, 11, 18) }],
      now,
    );
    expect(groups.map((g) => [g.label, g.entries.length])).toEqual([
      ['Today', 2],
      ['13 Oct', 2],
    ]);
  });

  it('gives an empty list no groups', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});
