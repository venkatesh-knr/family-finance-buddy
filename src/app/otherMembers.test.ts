import { describe, expect, it } from 'vitest';
import { othersHoldNote } from './otherMembers.ts';

const label = (kind: string) => ({ gold: 'Gold', deposit: 'Deposits', bond: 'Bonds', mutual_fund: 'Mutual funds' })[kind] ?? kind;

describe('what Mine leaves out', () => {
  it('says nothing when everything held is the signed-in member’s', () => {
    expect(othersHoldNote([{ memberId: 'a', kind: 'gold' }], 'a', label)).toBeNull();
  });

  it('says nothing for a household that holds nothing', () => {
    expect(othersHoldNote([], 'a', label)).toBeNull();
  });

  it('says nothing before the signed-in member is known, so it cannot call everything somebody else’s', () => {
    expect(othersHoldNote([{ memberId: 'b', kind: 'gold' }], null, label)).toBeNull();
  });

  it('names the class and the count, and sends the reader to Household', () => {
    const note = othersHoldNote([{ memberId: 'b', kind: 'gold' }, { memberId: 'a', kind: 'mutual_fund' }], 'a', label);
    expect(note).toBe('Other members hold gold (1 holding), which is not in your figures: choose Household to see it.');
  });

  it('lists classes most holdings first, with "and" before the last', () => {
    const held = [
      { memberId: 'b', kind: 'bond' },
      { memberId: 'b', kind: 'gold' },
      { memberId: 'c', kind: 'gold' },
      { memberId: 'b', kind: 'deposit' },
      { memberId: 'c', kind: 'deposit' },
      { memberId: 'c', kind: 'deposit' },
    ];
    expect(othersHoldNote(held, 'a', label)).toBe(
      'Other members hold deposits, gold and bonds (6 holdings), which is not in your figures: choose Household to see them.',
    );
  });
});
