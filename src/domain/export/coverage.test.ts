import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENTITIES, NOT_EXPORTED } from './entities.ts';

/**
 * The full export is generated from `ENTITIES` and nothing else, so a table or a column that is not accounted for there is quietly
 * missing from every backup. These tests read the migrations and hold the list to the whole schema: a slice that adds a table, or a
 * column, fails here until it has said whether the export carries it. (Registering in the list is part of "done": docs/build-plan.md,
 * step 5.)
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/** Columns that are in a table and in no sheet, on purpose: the account that did it is an identity, not household data. */
const LEFT_OUT_COLUMNS = new Set(['created_by', 'voided_by', 'accepted_by']);

function schema(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, '');

    for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
      const [, table, body] = match;
      if (table === undefined || body === undefined) continue;
      const columns = new Set<string>();
      let depth = 0;
      let current = '';
      const parts: string[] = [];
      for (const character of body) {
        if (character === '(') depth += 1;
        if (character === ')') depth -= 1;
        if (character === ',' && depth === 0) {
          parts.push(current);
          current = '';
        } else {
          current += character;
        }
      }
      parts.push(current);
      for (const part of parts) {
        const word = part.trim().split(/\s+/)[0]?.toLowerCase();
        if (word === undefined || word === '' || ['constraint', 'primary', 'unique', 'check', 'foreign'].includes(word)) continue;
        columns.add(word.replace(/"/g, ''));
      }
      tables.set(table, columns);
    }

    for (const match of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?(\w+)\s+([\s\S]*?);/gi)) {
      const [, table, body] = match;
      const columns = table === undefined ? undefined : tables.get(table);
      if (columns === undefined || body === undefined) continue;
      for (const add of body.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi)) if (add[1] !== undefined) columns.add(add[1]);
      for (const drop of body.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?"?(\w+)"?/gi)) if (drop[1] !== undefined) columns.delete(drop[1]);
      for (const rename of body.matchAll(/rename\s+column\s+"?(\w+)"?\s+to\s+"?(\w+)"?/gi)) {
        if (rename[1] !== undefined && rename[2] !== undefined) {
          columns.delete(rename[1]);
          columns.add(rename[2]);
        }
      }
    }

    for (const match of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/gi)) if (match[1] !== undefined) tables.delete(match[1]);
  }
  return tables;
}

describe('the export holds the whole schema to account', () => {
  const tables = schema();

  it('reads a schema it recognises', () => {
    expect(tables.size).toBeGreaterThan(25);
    expect(tables.get('holding')?.has('instrument_id')).toBe(true);
  });

  it('has every table either as an entity or left out with a reason', () => {
    const accounted = new Set([...ENTITIES.map((entity) => entity.key), ...Object.keys(NOT_EXPORTED)]);
    const unaccounted = [...tables.keys()].filter((table) => !accounted.has(table));
    expect(unaccounted, 'add each of these to ENTITIES, or to NOT_EXPORTED with the reason').toEqual([]);
  });

  it('names no table that does not exist, and none twice', () => {
    for (const entity of ENTITIES) expect(tables.has(entity.key), entity.key).toBe(true);
    for (const table of Object.keys(NOT_EXPORTED)) expect(tables.has(table), table).toBe(true);
    const both = ENTITIES.map((entity) => entity.key).filter((key) => key in NOT_EXPORTED);
    expect(both).toEqual([]);
  });

  it('has every column of an entity’s table either in its sheet or left out on purpose', () => {
    const missing: string[] = [];
    for (const entity of ENTITIES) {
      const present = tables.get(entity.key);
      if (present === undefined) continue;
      const registered = new Set(entity.columns.map((column) => column.key));
      for (const column of present) if (!registered.has(column) && !LEFT_OUT_COLUMNS.has(column)) missing.push(`${entity.key}.${column}`);
    }
    expect(missing, 'add each to the entity’s columns, or to LEFT_OUT_COLUMNS with the reason').toEqual([]);
  });

  it('names no column that the table does not have', () => {
    const invented: string[] = [];
    for (const entity of ENTITIES) {
      const present = tables.get(entity.key);
      if (present === undefined) continue;
      for (const column of entity.columns) if (!present.has(column.key)) invented.push(`${entity.key}.${column.key}`);
    }
    expect(invented).toEqual([]);
  });
});
