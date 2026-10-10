import { describe, expect, it } from 'vitest';
import { draftPattern, parseDraft } from './draftNumber.ts';

describe('parseDraft', () => {
  const pct = { min: 0, max: 50, integer: false };

  it('reads a decimal as typed, which a number bound to the field cannot hold halfway', () => {
    expect(parseDraft('7.5', pct)).toBe(7.5);
    expect(parseDraft('0.25', pct)).toBe(0.25);
  });

  it('reads a whole number', () => {
    expect(parseDraft('12', { min: 0, max: 60, integer: true })).toBe(12);
  });

  it('is nothing for an empty field or a lone point, so the field goes back to what is stored', () => {
    expect(parseDraft('', pct)).toBeNull();
    expect(parseDraft('   ', pct)).toBeNull();
    expect(parseDraft('.', pct)).toBeNull();
  });

  it('is nothing for what is not a number', () => {
    expect(parseDraft('abc', pct)).toBeNull();
    expect(parseDraft('1.2.3', pct)).toBeNull();
    expect(parseDraft('-5', pct)).toBeNull();
  });

  it('holds a figure to its bounds rather than refusing it', () => {
    expect(parseDraft('75', pct)).toBe(50);
    expect(parseDraft('100', { min: 0, max: 60, integer: true })).toBe(60);
    expect(parseDraft('0', { min: 1, max: 200, integer: false })).toBe(1);
  });

  it('is nothing for a decimal where only whole numbers are allowed', () => {
    expect(parseDraft('7.5', { min: 0, max: 60, integer: true })).toBeNull();
  });
});

describe('draftPattern', () => {
  it('lets a decimal be typed up to the point and past it, and refuses letters and a second point', () => {
    const p = draftPattern(false);
    for (const ok of ['', '7', '7.', '7.5', '.5']) expect(p.test(ok), ok).toBe(true);
    for (const no of ['a', '7.5.1', '-1', '7,5']) expect(p.test(no), no).toBe(false);
  });

  it('lets only digits be typed where the field is whole numbers', () => {
    const p = draftPattern(true);
    expect(p.test('12')).toBe(true);
    expect(p.test('1.2')).toBe(false);
  });
});
