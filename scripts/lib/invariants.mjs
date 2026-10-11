/**
 * Invariants: what the design documents say must stay true, and the tests that say it does.
 *
 * `docs/design/keeping-docs-honest.md` is the reasoning. In short: a rule a document states and no test
 * enforces is a wish, so every rule gets an ID, every ID must appear in the title of a test, and a test
 * that names an ID no document declares is a failure too, because that is what a renumbered or deleted
 * invariant looks like from the test's side.
 *
 * Pure, and the clock and the filesystem root are arguments, so the checks can be tested on a fixture
 * tree and are not tied to this repository.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import ts from 'typescript';
import { readPgTap } from './sql-tap.mjs';

const ID_SOURCE = '([A-Z]{2,4})-([A-Z]+[0-9]+)';
/** An ID wherever it appears in a title. */
const ID_IN_TEXT = new RegExp(`\\b${ID_SOURCE}\\b`, 'g');
/** The line that declares an invariant: bold, opening with the ID, then an em dash and the rule. */
const DECLARATION = new RegExp(`^\\*\\*${ID_SOURCE} — `);
const PREFIX_DECLARATION = /<!--\s*invariant-prefix:\s*([A-Za-z0-9-]+)\s*-->/g;
const HAS_PREFIX = /<!--\s*invariant-prefix:/;
const PREFIX_SHAPE = /^[A-Z]{2,4}$/;
const WAIVER_LINE = new RegExp(`^- ${ID_SOURCE}(?: — (.*?))?(?: — (\\d{4}-\\d{2}-\\d{2}))?\\s*$`);

/** Documents that are findings logs, not specifications. They carry no invariants and must not start to. */
export const NO_INVARIANTS = ['docs/design/ui-review.md'];

export const WAIVERS_PATH = 'docs/design/waivers.md';
const WAIVER_WARN_DAYS = 90;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report', 'screenshots']);

const norm = (p) => p.split(sep).join('/');

function walk(root, dir, keep) {
  const found = [];
  const base = join(root, dir);
  if (!existsSync(base)) return found;
  for (const name of readdirSync(base)) {
    if (SKIP_DIRS.has(name)) continue;
    const rel = join(dir, name);
    const full = join(root, rel);
    if (statSync(full).isDirectory()) found.push(...walk(root, rel, keep));
    else if (keep(norm(rel))) found.push(norm(rel));
  }
  return found;
}

/** Every `docs/**` markdown file, minus the findings logs. */
export function designDocs(root) {
  return walk(root, 'docs', (p) => p.endsWith('.md'));
}

/**
 * The text with fenced code blocks emptied, line for line. A document that explains the format by
 * showing it (this one's own design doc does) must not have its examples read as declarations, and the
 * line numbers an error names must still be the file's.
 */
export function withoutFences(text) {
  let fenced = false;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return '';
      }
      return fenced ? '' : line;
    })
    .join('\n');
}

/**
 * Read one document: its prefix, and the invariants it declares.
 * Problems are returned, not thrown, so a run reports all of them together.
 */
export function parseDoc(path, rawText) {
  const text = withoutFences(rawText);
  const problems = [];
  const prefixes = [...text.matchAll(PREFIX_DECLARATION)].map((m) => m[1]);
  let prefix = null;
  if (prefixes.length > 1) problems.push(`${path}: declares an invariant prefix ${String(prefixes.length)} times`);
  if (prefixes.length > 0) {
    prefix = prefixes[0];
    if (!PREFIX_SHAPE.test(prefix)) {
      problems.push(`${path}: the prefix "${prefix}" must be two to four capital letters`);
      prefix = null;
    }
  }

  const invariants = [];
  const seen = new Map();
  text.split(/\r?\n/).forEach((line, index) => {
    const m = DECLARATION.exec(line);
    if (m === null) return;
    const id = `${m[1]}-${m[2]}`;
    const where = `${path}:${String(index + 1)}`;
    if (prefix === null) {
      problems.push(`${where}: declares ${id} but the document has no valid <!-- invariant-prefix: ${m[1]} -->`);
      return;
    }
    if (m[1] !== prefix) {
      problems.push(`${where}: declares ${id} but this document's prefix is ${prefix}`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`${where}: ${id} is declared twice (first at line ${String(seen.get(id))})`);
      return;
    }
    seen.set(id, index + 1);
    invariants.push({ id, doc: path, line: index + 1 });
  });
  return { prefix, invariants, problems };
}

/** The waivers file: one line each, `- ID — reason — YYYY-MM-DD`. */
export function parseWaivers(rawText, path = WAIVERS_PATH) {
  const waivers = [];
  const problems = [];
  withoutFences(rawText).split(/\r?\n/).forEach((line, index) => {
    if (!line.startsWith('- ')) return;
    const where = `${path}:${String(index + 1)}`;
    const m = WAIVER_LINE.exec(line);
    if (m === null) {
      // A bullet that does not open with an ID is prose about waivers, not a waiver.
      if (!new RegExp(`^- ${ID_SOURCE}\\b`).test(line)) return;
      problems.push(`${where}: not a waiver line (expected "- ID — reason — YYYY-MM-DD")`);
      return;
    }
    const id = `${m[1]}-${m[2]}`;
    const reason = (m[3] ?? '').trim();
    const date = m[4] ?? null;
    if (reason === '') problems.push(`${where}: the waiver for ${id} gives no reason`);
    if (date === null) problems.push(`${where}: the waiver for ${id} has no date, so it cannot age`);
    waivers.push({ id, reason, date, line: index + 1, where });
  });
  return { waivers, problems };
}

/** The title of a test or suite call, if the call is one. */
function titleOf(node) {
  const roots = new Set(['it', 'test', 'describe', 'specify', 'suite']);
  const rootOf = (e) => {
    while (ts.isPropertyAccessExpression(e)) e = e.expression;
    return ts.isIdentifier(e) ? e.text : null;
  };
  let callee = node.expression;
  // it.each(table)('title', fn): the title belongs to the outer call.
  if (ts.isCallExpression(callee)) callee = callee.expression;
  if (!roots.has(rootOf(callee) ?? '')) return null;
  const first = node.arguments[0];
  if (first === undefined) return null;
  if (ts.isStringLiteralLike(first)) return first.text;
  if (ts.isTemplateExpression(first)) return first.head.text + first.templateSpans.map((s) => '${}' + s.literal.text).join('');
  return null;
}

export function readTsTitles(text, name) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const titles = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const t = titleOf(node);
      if (t !== null) titles.push(t);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return titles;
}

/** Every ID a title names. */
const idsIn = (text) => [...text.matchAll(ID_IN_TEXT)].map((m) => `${m[1]}-${m[2]}`);

const TEST_FILES = [
  (p) => /^src\/.*\.test\.tsx?$/.test(p),
  (p) => /^tests\/e2e\/.*\.spec\.ts$/.test(p),
  (p) => /^scripts\/.*\.test\.mjs$/.test(p),
];

/**
 * What the tests name. IDs come from titles only, never from comments: a comment does not appear in the
 * output of a run, so it is not evidence a test exists. A pgTAP file whose descriptions cannot be read
 * reliably contributes nothing, and says so if it mentions an ID.
 */
export function readTests(root) {
  const named = []; // { id, file, title }
  const problems = [];

  for (const file of walk(root, '.', (p) => TEST_FILES.some((f) => f(p)))) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const title of readTsTitles(text, file)) for (const id of idsIn(title)) named.push({ id, file, title });
  }

  for (const file of walk(root, 'supabase/tests', (p) => p.endsWith('.sql'))) {
    const text = readFileSync(join(root, file), 'utf8');
    const read = readPgTap(text);
    if (read.reliable) {
      for (const title of read.titles) for (const id of idsIn(title)) named.push({ id, file, title });
    } else {
      const mentioned = [...new Set(idsIn(text))];
      if (mentioned.length > 0) {
        problems.push(
          `${file}: mentions ${mentioned.join(', ')} but its pgTAP descriptions cannot be read reliably (${read.why ?? 'unknown'}), so nothing in it counts`,
        );
      }
    }
  }
  return { named, problems };
}

const daysBetween = (from, to) => Math.floor((to.getTime() - from.getTime()) / 86_400_000);

/**
 * The whole check.
 * @param {string} root the repository root
 * @param {Date} now injected, because a waiver's age is the one thing here that depends on the clock
 */
export function checkInvariants(root, now) {
  const errors = [];
  const warnings = [];

  // ---- the documents
  const declared = new Map();
  const prefixOwner = new Map();
  for (const path of designDocs(root)) {
    const text = readFileSync(join(root, path), 'utf8');
    if (NO_INVARIANTS.includes(path)) {
      const body = withoutFences(text);
      if (HAS_PREFIX.test(body) || body.split(/\r?\n/).some((l) => DECLARATION.test(l))) {
        errors.push(`${path}: is a findings log and must carry no invariants: numbering fixed bugs as rules makes them look standing`);
      }
      continue;
    }
    const doc = parseDoc(path, text);
    errors.push(...doc.problems);
    if (doc.prefix !== null) {
      const owner = prefixOwner.get(doc.prefix);
      if (owner !== undefined) errors.push(`${path}: prefix ${doc.prefix} is already declared by ${owner}`);
      else prefixOwner.set(doc.prefix, path);
      if (doc.invariants.length === 0) warnings.push(`${path}: declares prefix ${doc.prefix} but no invariants yet`);
    }
    for (const inv of doc.invariants) declared.set(inv.id, inv);
  }

  // ---- the waivers
  const waiverPath = join(root, WAIVERS_PATH);
  const waived = new Map();
  if (existsSync(waiverPath)) {
    const { waivers, problems } = parseWaivers(readFileSync(waiverPath, 'utf8'));
    errors.push(...problems);
    for (const w of waivers) {
      if (!declared.has(w.id)) {
        errors.push(`${w.where}: waives ${w.id}, which no document declares`);
        continue;
      }
      waived.set(w.id, w);
      if (w.date !== null) {
        const age = daysBetween(new Date(`${w.date}T00:00:00Z`), now);
        if (age > WAIVER_WARN_DAYS) {
          warnings.push(`${w.where}: the waiver for ${w.id} is ${String(age)} days old (over ${String(WAIVER_WARN_DAYS)}): restate it or test it`);
        }
      }
    }
  }

  // ---- the tests
  const { named, problems: testProblems } = readTests(root);
  errors.push(...testProblems);
  const covered = new Map();
  for (const t of named) {
    if (!declared.has(t.id)) {
      errors.push(`${t.file}: "${t.title}" names ${t.id}, which no document declares (renumbered or removed? the test is the stale half)`);
      continue;
    }
    covered.set(t.id, [...(covered.get(t.id) ?? []), t]);
  }

  // ---- both directions
  for (const [id, inv] of declared) {
    if (covered.has(id)) {
      if (waived.has(id)) warnings.push(`${waived.get(id).where}: ${id} has a test now (${covered.get(id)[0].file}); the waiver can go`);
      continue;
    }
    if (waived.has(id)) continue;
    errors.push(`${inv.doc}:${String(inv.line)}: ${id} has no test and no waiver`);
  }

  const counts = {
    declared: declared.size,
    tested: [...declared.keys()].filter((id) => covered.has(id)).length,
    waivedOnly: [...declared.keys()].filter((id) => !covered.has(id) && waived.has(id)).length,
    prefixes: [...prefixOwner.keys()],
  };
  return { errors, warnings, counts };
}
