import { describe, expect, it } from 'vitest';
import { hashFor, parseHash } from './route.ts';

describe('parseHash — the screen and its filters, from the URL and from nothing else', () => {
  it('reads the screen name, with and without the slash', () => {
    expect(parseHash('#/holdings').screen).toBe('holdings');
    expect(parseHash('#holdings').screen).toBe('holdings');
    expect(parseHash('#fire').screen).toBe('fire');
  });

  it('falls back to Expenses for a name it does not know, and for nothing', () => {
    expect(parseHash('#/nowhere').screen).toBe('expenses');
    expect(parseHash('').screen).toBe('expenses');
    expect(parseHash('#').screen).toBe('expenses');
  });

  it('reads the filters after the question mark, on the screen before it', () => {
    const route = parseHash('#/holdings?kind=deposit&currency=INR');
    expect(route.screen).toBe('holdings');
    expect(route.params.get('kind')).toBe('deposit');
    expect(route.params.get('currency')).toBe('INR');
  });

  it('reads a holding\'s own screen and which holding it is', () => {
    const route = parseHash('#/holding?id=abc-123');
    expect(route.screen).toBe('holding');
    expect(route.params.get('id')).toBe('abc-123');
    expect(hashFor('holding', { id: 'abc-123' })).toBe('#/holding?id=abc-123');
  });

  it('reads an earmark filter', () => {
    expect(parseHash('#/holdings?earmark=emergency').params.get('earmark')).toBe('emergency');
  });

  it('does not let a query turn an unknown screen into a known one', () => {
    expect(parseHash('#/holdings-x?kind=deposit').screen).toBe('expenses');
  });

  it('has no filters where the URL has none', () => {
    expect([...parseHash('#/holdings').params.keys()]).toEqual([]);
  });
});

describe('hashFor — the URL a link or a chip points at', () => {
  it('is the screen alone when there are no filters', () => {
    expect(hashFor('holdings')).toBe('#/holdings');
    expect(hashFor('holdings', {})).toBe('#/holdings');
  });

  it('puts the filters after the screen, in the order given', () => {
    expect(hashFor('holdings', { kind: 'deposit', currency: 'INR' })).toBe('#/holdings?kind=deposit&currency=INR');
  });

  it('leaves out a filter with no value, so All is the bare screen', () => {
    expect(hashFor('holdings', { kind: undefined, earmark: '' })).toBe('#/holdings');
  });

  it('escapes what it is given, so a filter cannot add a screen or another filter', () => {
    expect(hashFor('holdings', { kind: 'a&b=c' })).toBe('#/holdings?kind=a%26b%3Dc');
  });

  it('round-trips through parseHash', () => {
    const hash = hashFor('holdings', { earmark: 'emergency' });
    const route = parseHash(hash);
    expect(route.screen).toBe('holdings');
    expect(route.params.get('earmark')).toBe('emergency');
  });
});
