import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENTITIES } from './entities.ts';

/**
 * The database decides which sheets an upload may write and which columns of each, in `app.template_entities()`
 * (supabase/migrations/20261031120000_template_upload.sql): a fixed list, so a crafted file cannot name another table. The export's
 * entity list says the same thing from the other side. They are two statements of one fact, so this holds them to each other, and a
 * column added to one and not the other fails here and not in a person's upload.
 */

const MIGRATION = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261031120000_template_upload.sql'), 'utf8');

interface SqlEntity {
  readonly ord: number;
  readonly entity: string;
  readonly keyCol: string;
  readonly cols: readonly string[];
}

function sqlEntities(): SqlEntity[] {
  const body = /app\.template_entities\(\)[\s\S]*?select \* from \(values([\s\S]*?)\) as t\(ord, entity, key_col, cols\)/.exec(MIGRATION)?.[1] ?? '';
  const out: SqlEntity[] = [];
  for (const match of body.matchAll(/\(\s*(\d+)\s*,\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*array\[([^\]]*)\]\s*\)/g)) {
    out.push({
      ord: Number(match[1]),
      entity: match[2] ?? '',
      keyCol: match[3] ?? '',
      cols: [...(match[4] ?? '').matchAll(/'(\w+)'/g)].map((column) => column[1] ?? ''),
    });
  }
  return out;
}

describe('what an upload may write, as the database and the export each say it', () => {
  const sql = sqlEntities();
  const uploadable = ENTITIES.filter((entity) => entity.upload === 'rows');

  it('reads the list from the migration', () => {
    expect(sql.length).toBeGreaterThanOrEqual(15);
  });

  it('names the same entities', () => {
    expect(sql.map((entity) => entity.entity).sort()).toEqual(uploadable.map((entity) => entity.key).sort());
  });

  it.each(uploadable.map((entity) => entity.key))('writes the same columns of %s, keyed the same way', (key) => {
    const entity = ENTITIES.find((candidate) => candidate.key === key);
    const row = sql.find((candidate) => candidate.entity === key);
    expect(row, key).toBeDefined();
    expect(entity).toBeDefined();
    if (entity === undefined || row === undefined) return;
    expect(entity.rowKey).toEqual([row.keyCol]);
    const registered = entity.columns.map((column) => column.key).filter((column) => column !== row.keyCol);
    expect([...row.cols].sort(), `${key}: the database's columns and the export's`).toEqual([...registered].sort());
  });

  it('writes parents before the rows that point at them', () => {
    const order = new Map(sql.map((entity) => [entity.entity, entity.ord]));
    for (const entity of uploadable) {
      const own = order.get(entity.key) ?? 0;
      for (const column of entity.columns) {
        if (column.ref === undefined || column.ref === entity.key) continue;
        const parent = order.get(column.ref);
        if (parent === undefined) continue; // a record an upload does not write: members
        expect(parent, `${entity.key}.${column.key} points at ${column.ref}`).toBeLessThan(own);
      }
    }
  });

  it('gives a holding’s instrument a place before it, since a holding points at it', () => {
    const order = new Map(sql.map((entity) => [entity.entity, entity.ord]));
    expect(order.get('instrument')).toBeLessThan(order.get('holding') ?? 0);
  });

  it('grants nobody a delete on what it adds, and no table to update the ledger', () => {
    expect(MIGRATION).not.toMatch(/grant[^;]*\bdelete\b[^;]*on\s+public\.import_(ref|batch_row)/i);
    expect(MIGRATION).not.toMatch(/grant[^;]*\bupdate\b[^;]*on\s+public\.import_(ref|batch_row)/i);
  });
});
