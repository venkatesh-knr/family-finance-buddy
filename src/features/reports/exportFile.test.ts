import { describe, expect, it } from 'vitest';
import { exportFilename } from './exportFile.ts';

describe('the name of an export file', () => {
  it('is the app, the household and the day', () => {
    expect(exportFilename('The Rao household', '2026-10-30', false)).toBe('family-finance-buddy-the-rao-household-2026-10-30.xlsx');
  });

  it('says sample in the name of a demo household’s file', () => {
    expect(exportFilename('Demo household', '2026-10-30', true)).toBe('family-finance-buddy-demo-household-2026-10-30-sample.xlsx');
  });

  it('keeps to letters and digits, drops accents, and does not end in a dash when it is cut', () => {
    expect(exportFilename('Ràó / Famîly: 2026!', '2026-10-30', false)).toBe('family-finance-buddy-rao-family-2026-2026-10-30.xlsx');
    const long = exportFilename('a'.repeat(39) + ' bbbbbbbb', '2026-10-30', false);
    expect(long).not.toMatch(/--/);
    expect(long).toMatch(/^family-finance-buddy-a+-2026-10-30\.xlsx$/);
  });

  it('has a name for a household with none that can be written, and for a date that is not one', () => {
    expect(exportFilename('వెంకట', '2026-10-30', false)).toBe('family-finance-buddy-household-2026-10-30.xlsx');
    expect(exportFilename('X', 'yesterday', false)).toBe('family-finance-buddy-x-undated.xlsx');
  });
});
