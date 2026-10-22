import { describe, expect, it } from 'vitest';
import { activityLine, activityPhrase, clockTime, dayLabel, groupByDay } from './activity.ts';

// Fixed instants, and Kolkata's answers: the test must give the same result on a device in any zone.
// 2026-10-15T16:30:00Z is 22:00 IST on 15 October.
const now = new Date('2026-10-15T16:30:00Z');

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

  it('has a phrase for the audited tables a screen would otherwise show as a raw name', () => {
    expect(activityPhrase('bond_rating_change', 'insert')).toBe('Recorded a rating change');
    expect(activityPhrase('user_account', 'update')).toBe('Updated an account');
  });

  it('shows an unknown table by its name and not as nothing: unlabelled should look unfinished', () => {
    expect(activityPhrase('reminder_rule', 'update')).toBe('Changed reminder rule');
    expect(activityPhrase('something_new', 'read')).toBe('Read something new');
  });

  it('puts a name after the phrase when there is one', () => {
    expect(activityLine('Recorded a value', 'Parag Parikh Flexi Cap')).toEqual({ lead: 'Recorded a value', name: 'Parag Parikh Flexi Cap' });
    expect(activityLine('Renewed', 'FD 1')).toEqual({ lead: 'Renewed', name: 'FD 1' });
  });

  it('turns a fragment into a sentence when no name follows it, and leaves a whole phrase alone', () => {
    expect(activityLine('Set the terms', null)).toEqual({ lead: "Set a deposit's terms", name: null });
    expect(activityLine('Renewed', '  ')).toEqual({ lead: 'Renewed a deposit', name: null });
    expect(activityLine('Invited', null)).toEqual({ lead: 'Invited someone', name: null });
    expect(activityLine('Changed a budget', null)).toEqual({ lead: 'Changed a budget', name: null });
  });
});

describe('days and times are Kolkata\'s', () => {
  it('calls today and yesterday by those names and any other day by its date', () => {
    expect(dayLabel('2026-10-15T16:12:00Z', now)).toBe('Today'); // 21:42 IST, 15 Oct
    expect(dayLabel('2026-10-14T00:35:00Z', now)).toBe('Yesterday'); // 06:05 IST, 14 Oct
    expect(dayLabel('2026-10-13T12:35:00Z', now)).toBe('13 Oct'); // 18:05 IST, 13 Oct
  });

  it('puts an entry made late in the evening in India under that evening, not under the next UTC day', () => {
    // 2026-10-15T19:00:00Z is 00:30 IST on the 16th; the 15th in UTC.
    const afterMidnight = new Date('2026-10-15T19:00:00Z');
    expect(dayLabel('2026-10-15T16:12:00Z', afterMidnight)).toBe('Yesterday');
    expect(dayLabel('2026-10-15T19:00:00Z', afterMidnight)).toBe('Today');
  });

  it('reads the time as the board does, in Kolkata: "9:42 pm"', () => {
    expect(clockTime('2026-10-15T16:12:00Z')).toBe('9:42 pm');
    expect(clockTime('2026-10-13T05:48:00Z')).toBe('11:18 am');
  });

  it('gathers entries under their Kolkata day, in the order given, with one heading a day', () => {
    const groups = groupByDay(
      [
        { at: '2026-10-15T16:12:00Z' }, // 21:42 on the 15th
        { at: '2026-10-15T10:30:00Z' }, // 16:00 on the 15th
        { at: '2026-10-13T12:35:00Z' }, // 18:05 on the 13th
        { at: '2026-10-13T05:48:00Z' }, // 11:18 on the 13th
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.entries.length])).toEqual([
      ['Today', 2],
      ['13 Oct', 2],
    ]);
  });

  it('keeps 18:30 UTC and 18:29 UTC on opposite sides of an Indian midnight', () => {
    const groups = groupByDay([{ at: '2026-10-14T18:31:00Z' }, { at: '2026-10-14T18:29:00Z' }], now);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
  });

  it('gives an empty list no groups', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});
