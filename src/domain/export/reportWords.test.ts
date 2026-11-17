import { describe, expect, it } from 'vitest';
import { CREDIT_CATEGORIES } from '../credit.ts';
import { ACCOUNT_TYPES } from '../../repo/types.ts';
import { COLUMN_RULES } from './rules.generated.ts';
import { ACCOUNT_WORDS, CREDIT_WORDS, EARMARK_WORDS, KIND_WORDS, WORD_TABLES, investmentType, wordFor } from './reportWords.ts';

/**
 * XR-I1 — every code a person would otherwise read has a word, and the words are held to the database's own lists (docs/design/export-redesign.md section 2).
 * The lists are read out of the migrations (`rules.generated.ts`, itself checked against them), so a value a migration adds and this file lacks fails here,
 * before it reaches a person's file as `half_yearly` or `esop`.
 */

describe('XR-I1 — each table of words is held to the schema’s own list of codes', () => {
  it.each(WORD_TABLES)('$name has a word for every value the check on $entity.$column allows, and no word for one it does not', ({ words, entity, column }) => {
    const allowed = COLUMN_RULES[entity]?.[column]?.values;
    expect(allowed, `${entity}.${column} is a list in the schema`).toBeDefined();
    expect([...(allowed ?? [])].sort()).toEqual(Object.keys(words).sort());
  });

  it('has no word that repeats within a table, so two codes are never told apart by nothing', () => {
    for (const { name, words } of WORD_TABLES) {
      const used = Object.values(words);
      expect(new Set(used).size, name).toBe(used.length);
    }
  });

  it('has a word for every kind of account and every kind of credit the app reads', () => {
    expect(Object.keys(ACCOUNT_WORDS).sort()).toEqual([...ACCOUNT_TYPES].sort());
    expect(Object.keys(CREDIT_WORDS).sort()).toEqual([...CREDIT_CATEGORIES].sort());
  });

  it('leaves out an earmark of none: nothing kept for is a blank, never the word none', () => {
    expect(COLUMN_RULES['holding']?.['earmark']?.values).toContain('none');
    expect(EARMARK_WORDS['none']).toBeUndefined();
    expect(wordFor(EARMARK_WORDS, 'none')).toBeNull();
  });
});

describe('investmentType — kind, scheme and retirement type in one word', () => {
  it('tells a deposit by its scheme and a retirement holding by its type', () => {
    expect(investmentType('deposit', 'fd', null)).toBe('Fixed deposit (FD)');
    expect(investmentType('deposit', 'rd', null)).toBe('Recurring deposit (RD)');
    expect(investmentType('deposit', 'ssy', null)).toBe('Sukanya Samriddhi (SSY)');
    expect(investmentType('retirement', null, 'nps')).toBe('NPS');
    expect(investmentType('retirement', null, 'epf')).toBe('EPF');
  });

  it('tells anything else by its kind', () => {
    expect(investmentType('mutual_fund', null, null)).toBe('Mutual fund');
    expect(investmentType('etf', null, null)).toBe('ETF');
    expect(investmentType('bond', null, null)).toBe('Bond');
    expect(investmentType('gold', null, null)).toBe(KIND_WORDS['gold']);
  });
});
