import { describe, expect, it } from 'vitest';
import { allowedScreen, screensFor, type AppScreen } from './access.ts';

describe('screensFor', () => {
  it('gives an owner and a partner every household screen and no summary', () => {
    for (const role of ['owner', 'partner'] as const) {
      expect(screensFor(role)).toEqual(['overview', 'expenses', 'holdings', 'tax', 'fire']);
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
  it('keeps the screen a role may see', () => {
    expect(allowedScreen('owner', 'tax')).toBe('tax');
    expect(allowedScreen('contributor', 'expenses')).toBe('expenses');
  });

  it('sends a role away from a screen it may not see, to the first it may', () => {
    expect(allowedScreen('contributor', 'overview')).toBe('summary');
    expect(allowedScreen('viewer', 'holdings')).toBe('summary');
    expect(allowedScreen('owner', 'summary')).toBe('overview');
  });

  it('leaves the two screens that belong to everyone alone', () => {
    const everyone: AppScreen[] = ['profile', 'settings'];
    for (const role of ['owner', 'partner', 'contributor', 'viewer', null] as const) {
      for (const screen of everyone) expect(allowedScreen(role, screen)).toBe(screen);
    }
  });
});
