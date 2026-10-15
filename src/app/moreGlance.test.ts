import { describe, expect, it } from 'vitest';
import { insuranceGlance, policiesPhrase, profileLine, renewalPill, taxYearLabel } from './moreGlance.ts';

const policy = (id: string, renewalOn: string | null, isLapsed = false) => ({ id, name: id, isLapsed, renewalOn });

describe('the line under Insurance on More', () => {
  it('counts the policies in force and leaves a lapsed one out', () => {
    const g = insuranceGlance([policy('a', null), policy('b', null), policy('c', null, true)], '2026-10-15');
    expect(g.inForce).toBe(2);
    expect(policiesPhrase(g.inForce)).toBe('2 policies');
    expect(policiesPhrase(1)).toBe('1 policy');
    expect(policiesPhrase(0)).toBe('No policies yet');
  });

  it('says nothing about renewals when none is within thirty days', () => {
    const g = insuranceGlance([policy('a', '2027-03-01')], '2026-10-15');
    expect(g.due).toBeNull();
    expect(renewalPill(g.due)).toBeNull();
  });

  it('names the soonest renewal in days, as the board does: "1 renews in 18 days"', () => {
    const g = insuranceGlance([policy('a', '2026-11-02'), policy('b', '2027-03-01')], '2026-10-15');
    expect(renewalPill(g.due)).toBe('1 renews in 18 days');
  });

  it('says how many when several fall within the window, and today as today', () => {
    const several = insuranceGlance([policy('a', '2026-10-20'), policy('b', '2026-11-01')], '2026-10-15');
    expect(renewalPill(several.due)).toBe('2 renew within 30 days');
    const today = insuranceGlance([policy('a', '2026-10-15')], '2026-10-15');
    expect(renewalPill(today.due)).toBe('1 renews today');
  });

  it('puts an overdue renewal first: it is the one something can be done about', () => {
    const g = insuranceGlance([policy('a', '2026-10-10'), policy('b', '2026-10-25')], '2026-10-15');
    expect(renewalPill(g.due)).toBe('1 renewal overdue');
  });

  it('does not call out a lapsed policy or one with no date', () => {
    const g = insuranceGlance([policy('a', '2026-10-16', true), policy('b', null)], '2026-10-15');
    expect(g.due).toBeNull();
  });
});

describe('the other lines', () => {
  it('writes a tax year as a return does', () => {
    expect(taxYearLabel(2026)).toBe('2026–27');
    expect(taxYearLabel(2099)).toBe('2099–00');
  });

  it('says the role and that two-step sign-in is on', () => {
    expect(profileLine('owner')).toBe('Owner · two-step sign-in on');
    expect(profileLine(null)).toBe('Two-step sign-in on');
  });
});
