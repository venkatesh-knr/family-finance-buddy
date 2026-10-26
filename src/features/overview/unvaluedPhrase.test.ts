import { describe, expect, it } from 'vitest';
import { unvaluedPhrase } from './unvaluedPhrase.ts';

describe('what has never been valued, said as it is', () => {
  it('counts holdings alone as it always did', () => {
    expect(unvaluedPhrase(1, 0)).toBe('1 holding has');
    expect(unvaluedPhrase(3, 0)).toBe('3 holdings have');
  });

  it('names a property as a property, not a holding', () => {
    expect(unvaluedPhrase(1, 1)).toBe('1 property has');
    expect(unvaluedPhrase(2, 2)).toBe('2 properties have');
  });

  it('says both when there are both, and agrees with the total', () => {
    expect(unvaluedPhrase(2, 1)).toBe('1 holding and 1 property have');
    expect(unvaluedPhrase(4, 1)).toBe('3 holdings and 1 property have');
  });
});
