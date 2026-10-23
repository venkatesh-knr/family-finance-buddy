import { describe, expect, it } from 'vitest';
import type { InsurancePolicy, PolicyKind } from '../../repo/types.ts';
import { groupOf, policyGroups, renewalPillText } from './policyGroups.ts';

const policy = (id: string, kind: PolicyKind, isLapsed = false): InsurancePolicy =>
  ({ id, kind, isLapsed }) as unknown as InsurancePolicy;

describe('groupOf', () => {
  it('puts term life under Life, health under Health, and the savings policies under their surrender value', () => {
    expect(groupOf('term_life')).toBe('life');
    expect(groupOf('health')).toBe('health');
    for (const kind of ['endowment', 'ulip', 'money_back'] as const) expect(groupOf(kind)).toBe('surrender');
  });

  it('keeps everything else together, so no policy is left out of the list', () => {
    for (const kind of ['vehicle', 'home', 'personal_accident', 'other'] as const) expect(groupOf(kind)).toBe('other');
  });
});

describe('policyGroups', () => {
  it('lists the groups in the board order and leaves out the ones with nothing in them', () => {
    const groups = policyGroups([policy('a', 'ulip'), policy('b', 'health'), policy('c', 'vehicle')]);
    expect(groups.map((g) => g.key)).toEqual(['health', 'surrender', 'other']);
    expect(groups.map((g) => g.label)).toEqual(['Health', 'With a surrender value', 'Other']);
  });

  it('puts a policy in force before one that has lapsed, and keeps the order given otherwise', () => {
    const [health] = policyGroups([
      policy('lapsed', 'health', true),
      policy('one', 'health'),
      policy('two', 'health'),
    ]);
    expect(health?.policies.map((p) => p.id)).toEqual(['one', 'two', 'lapsed']);
  });

  it('is empty for no policies', () => {
    expect(policyGroups([])).toEqual([]);
  });
});

describe('renewalPillText', () => {
  it('says when, in days, and says overdue and today in words', () => {
    expect(renewalPillText({ daysLeft: 18, overdue: false })).toBe('Renews in 18 days');
    expect(renewalPillText({ daysLeft: 1, overdue: false })).toBe('Renews in 1 day');
    expect(renewalPillText({ daysLeft: 0, overdue: false })).toBe('Renews today');
    expect(renewalPillText({ daysLeft: -3, overdue: true })).toBe('Renewal overdue');
  });
});
