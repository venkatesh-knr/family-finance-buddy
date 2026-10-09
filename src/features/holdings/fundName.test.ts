import { describe, expect, it } from 'vitest';
import { splitFundName } from './fundName.ts';

describe('splitFundName', () => {
  it('puts the fund first, and the plan and the old name on a second line', () => {
    expect(
      splitFundName(
        'Parag Parikh Flexi Cap Fund - Direct Plan Growth (formerly Parag Parikh Long Term Value Fund)',
      ),
    ).toEqual({
      title: 'Parag Parikh Flexi Cap Fund',
      detail: 'Direct Plan Growth · formerly Parag Parikh Long Term Value Fund',
    });
  });

  it('keeps every plan descriptor, in order', () => {
    expect(splitFundName('HDFC Mid Cap Fund - Direct Plan - Growth Option')).toEqual({
      title: 'HDFC Mid Cap Fund',
      detail: 'Direct Plan · Growth Option',
    });
  });

  it('does not split a hyphen inside a word', () => {
    expect(splitFundName('Axis Small-Cap Fund')).toEqual({ title: 'Axis Small-Cap Fund', detail: null });
  });

  it('leaves a short name alone', () => {
    expect(splitFundName('Vanguard S&P 500 ETF')).toEqual({ title: 'Vanguard S&P 500 ETF', detail: null });
  });

  it('takes a parenthetical that is not a rename too, without the brackets', () => {
    expect(splitFundName('Nippon India Gold Savings Fund (Growth)')).toEqual({
      title: 'Nippon India Gold Savings Fund',
      detail: 'Growth',
    });
  });

  it('never loses any of the words', () => {
    const name = 'A Fund - Direct Plan Growth (formerly B Fund)';
    const { title, detail } = splitFundName(name);
    const words = (s: string) => s.replace(/[()·-]/g, ' ').split(/\s+/).filter(Boolean).sort();
    expect(words(`${title} ${detail ?? ''}`)).toEqual(words(name));
  });

  it('gives back a name with nothing before the separator whole', () => {
    expect(splitFundName(' - Growth')).toEqual({ title: '- Growth', detail: null });
    expect(splitFundName('')).toEqual({ title: '', detail: null });
  });
});
