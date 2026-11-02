/**
 * What the migrations say about a column: whether it must be given, whether the database fills it in when it is left out, and the
 * short list of values a check allows.
 *
 * The upload's preview tells a person a cell is wrong before anything is written (blueprint section 17), and it can only say what
 * the database will say. So the rules come from the database's own definition and are read out of `supabase/migrations/`, in order,
 * with the last word winning, and a test holds the checked-in copy (`src/domain/export/rules.generated.ts`) to what this reads. A
 * migration that changes a column fails that test until the copy is regenerated: `node scripts/gen-template-rules.mjs`.
 *
 * This is a reader of the SQL this project writes, not of SQL in general: it handles `create table`, and `alter table` with
 * `add column`, `drop column`, `alter column ... set/drop not null`, `add constraint ... check` and `drop constraint`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Split on commas that are not inside brackets or a string. */
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "'") inString = !inString;
    if (!inString) {
      if (ch === '(' || ch === '[') depth += 1;
      if (ch === ')' || ch === ']') depth -= 1;
      if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** The text between the bracket that opens at `start` and its match. */
function balanced(text, start) {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "'") inString = !inString;
    if (inString) continue;
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { inside: text.slice(start + 1, index), end: index };
    }
  }
  return { inside: text.slice(start + 1), end: text.length };
}

const strip = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The values a check allows, as { col: [values] }, from a check that does nothing else: `check (col in ('a', 'b'))`. A check that
 * says more (`kind in ('ulip') or cover is null`, a condition that holds only for some kinds) is not a list of the values a column
 * may take, and is left out rather than read as one.
 */
function enumsIn(text) {
  const found = {};
  for (const start of [...text.matchAll(/check\s*\(/gi)]) {
    const { inside } = balanced(text, start.index + start[0].length - 1);
    const match = /^\s*"?(\w+)"?\s+in\s*\(\s*((?:'(?:[^']|'')*'\s*,?\s*)+)\)\s*$/i.exec(inside);
    if (match === null) continue;
    found[match[1]] = [...match[2].matchAll(/'((?:[^']|'')*)'/g)].map((value) => value[1].replace(/''/g, "'"));
  }
  return found;
}

function column(def) {
  const name = /^"?(\w+)"?\s/.exec(def + ' ')?.[1];
  if (name === undefined) return null;
  const lower = def.toLowerCase();
  const rest = def.slice(def.indexOf(name) + name.length);
  return {
    name,
    notNull: /\bnot\s+null\b/.test(lower) || /\bprimary\s+key\b/.test(lower),
    hasDefault: /\bdefault\b/.test(lower) || /\bgenerated\b/.test(lower),
    values: enumsIn(rest)[name],
  };
}

export function schemaRules(root = process.cwd()) {
  const dir = join(root, 'supabase', 'migrations');
  const tables = {};

  for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = strip(readFileSync(join(dir, file), 'utf8'));

    for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(/gi)) {
      const { inside } = balanced(sql, match.index + match[0].length - 1);
      const columns = {};
      const checks = [];
      for (const part of splitTop(inside)) {
        if (/^(constraint|primary|unique|foreign|check)\b/i.test(part)) {
          checks.push(part);
          continue;
        }
        const parsed = column(part);
        if (parsed !== null) columns[parsed.name] = { notNull: parsed.notNull, hasDefault: parsed.hasDefault, ...(parsed.values === undefined ? {} : { values: parsed.values }) };
      }
      for (const check of checks) for (const [name, values] of Object.entries(enumsIn(check))) if (columns[name] !== undefined) columns[name].values = values;
      tables[match[1]] = columns;
    }

    for (const match of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?(\w+)\s+([\s\S]*?);/gi)) {
      const columns = tables[match[1]];
      if (columns === undefined) continue;
      for (const clause of splitTop(match[2])) {
        let m;
        if ((m = /^add\s+column\s+(?:if\s+not\s+exists\s+)?(.*)$/is.exec(clause))) {
          const parsed = column(m[1]);
          if (parsed !== null) columns[parsed.name] = { notNull: parsed.notNull, hasDefault: parsed.hasDefault, ...(parsed.values === undefined ? {} : { values: parsed.values }) };
        } else if ((m = /^drop\s+column\s+(?:if\s+exists\s+)?"?(\w+)"?/i.exec(clause))) {
          delete columns[m[1]];
        } else if ((m = /^alter\s+column\s+"?(\w+)"?\s+set\s+not\s+null/i.exec(clause))) {
          if (columns[m[1]] !== undefined) columns[m[1]].notNull = true;
        } else if ((m = /^alter\s+column\s+"?(\w+)"?\s+drop\s+not\s+null/i.exec(clause))) {
          if (columns[m[1]] !== undefined) columns[m[1]].notNull = false;
        } else if ((m = /^alter\s+column\s+"?(\w+)"?\s+set\s+default/i.exec(clause))) {
          if (columns[m[1]] !== undefined) columns[m[1]].hasDefault = true;
        } else if ((m = /^alter\s+column\s+"?(\w+)"?\s+drop\s+default/i.exec(clause))) {
          if (columns[m[1]] !== undefined) columns[m[1]].hasDefault = false;
        } else if (/^add\s+constraint\b/i.test(clause)) {
          for (const [name, values] of Object.entries(enumsIn(clause))) if (columns[name] !== undefined) columns[name].values = values;
        }
      }
    }
  }
  return tables;
}

/** The entities and columns an upload writes, read from the migration that fixes them. */
export function templateEntities(root = process.cwd()) {
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20261031120000_template_upload.sql'), 'utf8');
  const body = /select \* from \(values([\s\S]*?)\) as t\(ord, entity, key_col, cols\)/.exec(sql)?.[1] ?? '';
  const out = [];
  for (const match of body.matchAll(/\(\s*(\d+)\s*,\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*array\[([^\]]*)\]\s*\)/g)) {
    out.push({ entity: match[2], keyCol: match[3], cols: [...match[4].matchAll(/'(\w+)'/g)].map((c) => c[1]) });
  }
  return out;
}

/** The rules of every column an upload may write, as the source of the checked-in module. */
export function templateRules(root = process.cwd()) {
  const tables = schemaRules(root);
  const rules = {};
  for (const { entity, keyCol, cols } of templateEntities(root)) {
    rules[entity] = {};
    for (const key of [keyCol, ...cols]) {
      const rule = tables[entity]?.[key];
      if (rule === undefined) throw new Error(`The migrations define no column ${entity}.${key}`);
      rules[entity][key] = rule;
    }
  }
  return rules;
}

export function renderModule(rules) {
  const lines = [
    '// GENERATED by scripts/gen-template-rules.mjs from supabase/migrations/. Do not edit: a test fails if it is out of date.',
    '// What the database requires of each column an upload may write (docs/decisions.md, Upload).',
    '',
    'export interface ColumnRule {',
    '  /** The database refuses a null. */',
    '  readonly notNull: boolean;',
    '  /** The database fills the column in when a row leaves it out. */',
    '  readonly hasDefault: boolean;',
    '  /** The values a check allows, when it allows only a few. */',
    '  readonly values?: readonly string[];',
    '}',
    '',
    'export const COLUMN_RULES: Readonly<Record<string, Readonly<Record<string, ColumnRule>>>> = {',
  ];
  for (const [entity, columns] of Object.entries(rules)) {
    lines.push(`  ${entity}: {`);
    for (const [name, rule] of Object.entries(columns)) {
      const values = rule.values === undefined ? '' : `, values: [${rule.values.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(', ')}]`;
      lines.push(`    ${name}: { notNull: ${String(rule.notNull)}, hasDefault: ${String(rule.hasDefault)}${values} },`);
    }
    lines.push('  },');
  }
  lines.push('};', '');
  return lines.join('\n');
}
