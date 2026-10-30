import { describe, expect, it } from 'vitest';
import { allowedScreen, moreFor, roleSummary, screensFor, type AppScreen } from './access.ts';

describe('screensFor', () => {
  it('gives an owner and a partner five places in the bar, the last being More, and no summary', () => {
    for (const role of ['owner', 'partner'] as const) {
      expect(screensFor(role)).toEqual(['overview', 'expenses', 'holdings', 'fire', 'more']);
    }
  });

  it('keeps Tax and Insurance behind More for the roles that can read the household, and offers nobody else a More', () => {
    for (const role of ['owner', 'partner'] as const) expect(moreFor(role)).toEqual(['tax', 'reports', 'insurance', 'property']);
    for (const role of ['contributor', 'viewer', null] as const) {
      expect(moreFor(role)).toEqual([]);
      expect(screensFor(role)).not.toContain('more');
    }
  });

  it('gives a contributor their own records and the summary, and not the household-wide figures', () => {
    // Overview and FIRE are household net worth and the household plan: with only
    // their own rows readable they would show a partial figure that looks whole.
    expect(screensFor('contributor')).toEqual(['summary', 'expenses', 'holdings', 'tax']);
  });

  it('gives a viewer the summary and nothing else', () => {
    expect(screensFor('viewer')).toEqual(['summary']);
  });

  it('gives a caller with no known role the summary, which is what a refusal looks like', () => {
    expect(screensFor(null)).toEqual(['summary']);
  });
});

describe('allowedScreen', () => {
  it('keeps the screen a role may see, including the ones behind More', () => {
    expect(allowedScreen('owner', 'tax')).toBe('tax');
    expect(allowedScreen('partner', 'insurance')).toBe('insurance');
    expect(allowedScreen('partner', 'property')).toBe('property');
    expect(allowedScreen('owner', 'more')).toBe('more');
    expect(allowedScreen('contributor', 'expenses')).toBe('expenses');
  });

  it('sends a role away from a screen it may not see, to the first it may', () => {
    expect(allowedScreen('contributor', 'overview')).toBe('summary');
    expect(allowedScreen('viewer', 'holdings')).toBe('summary');
    expect(allowedScreen('owner', 'summary')).toBe('overview');
    // A policy is read by owner and partner and by a contributor only for their own; the screen is not offered
    // to a contributor, and a hash somebody typed is a request and not a grant.
    expect(allowedScreen('contributor', 'insurance')).toBe('summary');
    expect(allowedScreen('viewer', 'insurance')).toBe('summary');
    expect(allowedScreen('contributor', 'property')).toBe('summary');
    expect(allowedScreen('viewer', 'property')).toBe('summary');
    expect(allowedScreen('contributor', 'more')).toBe('summary');
  });

  it('gives a holding\'s own screen to whoever has Holdings, and to nobody else', () => {
    for (const role of ['owner', 'partner', 'contributor'] as const) {
      expect(allowedScreen(role, 'holding')).toBe('holding');
    }
    // A viewer has no Holdings, so a typed `#/holding?id=...` is a request and not a grant.
    expect(allowedScreen('viewer', 'holding')).toBe('summary');
    expect(allowedScreen(null, 'holding')).toBe('summary');
  });

  it('leaves the two screens that belong to everyone alone', () => {
    const everyone: AppScreen[] = ['profile', 'settings'];
    for (const role of ['owner', 'partner', 'contributor', 'viewer', null] as const) {
      for (const screen of everyone) expect(allowedScreen(role, screen)).toBe(screen);
    }
  });
});

describe('what a role can do, said in a sentence', () => {
  it('says something different and specific for each role', () => {
    const roles = ['owner', 'partner', 'contributor', 'viewer'] as const;
    const sentences = roles.map((role) => roleSummary(role));
    expect(new Set(sentences).size).toBe(4);
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(30);
  });

  it('keeps the owner as the only role that invites, changes roles and resets', () => {
    expect(roleSummary('owner')).toMatch(/invite people, change roles and reset/);
    expect(roleSummary('partner')).toMatch(/apart from inviting people and changing roles/);
  });

  it('says a person with no role has none, and does not guess', () => {
    expect(roleSummary(null)).toBe('Has no role in this household yet.');
  });
});
