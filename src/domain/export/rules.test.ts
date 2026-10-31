import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLUMN_RULES } from './rules.generated.ts';
import { ENTITIES } from './entities.ts';

/**
 * The rules the upload's preview checks a cell against are the database's own, read out of the migrations. The checked-in copy is
 * generated; this fails when a migration has changed a column and the copy has not been regenerated
 * (`node scripts/gen-template-rules.mjs`), so the preview never says less, or more, than the database will.
 */

describe('the column rules an upload is checked against', () => {
  it('are what the migrations say now', () => {
    const fresh = execFileSync(process.execPath, ['scripts/gen-template-rules.mjs', '--stdout'], { cwd: process.cwd(), encoding: 'utf8' });
    const checkedIn = readFileSync(join(process.cwd(), 'src', 'domain', 'export', 'rules.generated.ts'), 'utf8');
    expect(checkedIn.replace(/\r\n/g, '\n')).toBe(fresh.replace(/\r\n/g, '\n'));
  });

  it('cover every column of every entity an upload writes', () => {
    for (const entity of ENTITIES.filter((candidate) => candidate.upload === 'rows')) {
      const rules = COLUMN_RULES[entity.key];
      expect(rules, entity.key).toBeDefined();
      for (const column of entity.columns) expect(rules?.[column.key], `${entity.key}.${column.key}`).toBeDefined();
    }
  });

  it('say what a person is told: a name is required, a nature is one of two, a holding’s quantity is required', () => {
    expect(COLUMN_RULES['expense_category']?.['name']).toMatchObject({ notNull: true, hasDefault: false });
    expect(COLUMN_RULES['expense_category']?.['nature']?.values).toEqual(['fixed', 'variable']);
    expect(COLUMN_RULES['holding']?.['quantity']).toMatchObject({ notNull: true, hasDefault: false });
    expect(COLUMN_RULES['expense_category']?.['is_essential']).toMatchObject({ notNull: true, hasDefault: true });
    expect(COLUMN_RULES['instrument']?.['kind']?.values).toContain('retirement');
    expect(COLUMN_RULES['instrument']?.['kind']?.values).not.toContain('gold');
    // A check that says more than a list of values (a condition that holds for some kinds only) is not read as one: the policy's kind is the whole list.
    expect(COLUMN_RULES['insurance_policy']?.['kind']?.values).toEqual(['health', 'term_life', 'endowment', 'ulip', 'money_back', 'vehicle', 'home', 'personal_accident', 'other']);
  });
});
