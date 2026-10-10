/**
 * Does the design-conformance brief know every document in docs/design?
 *
 * The brief is the reviewer's whole idea of what the specification is. When a design document is added
 * and the brief is not, the reviewer keeps producing findings that look entirely reasonable while
 * measuring the code against a specification that is missing a part, and nothing about its output says
 * so. That is the worst thing a reviewer can do, and it happened here: three design documents existed
 * for a while that the brief had never heard of.
 *
 * So every file in docs/design/ is either named in the brief, or listed in its exclusions block with a
 * reason. "Named" means the filename appears in the brief outside that block. The two are exclusive: a
 * file cannot be both an authority and not one.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

export const BRIEF_PATH = '.claude/agents/design-conformance.md';
export const DESIGN_DIR = 'docs/design';
export const EXCLUSIONS_START = '<!-- authority-exclusions:start -->';
export const EXCLUSIONS_END = '<!-- authority-exclusions:end -->';

function files(root, dir) {
  const out = [];
  const base = join(root, dir);
  if (!existsSync(base)) return out;
  for (const name of readdirSync(base)) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) out.push(...files(root, rel));
    else out.push(rel.split(sep).join('/'));
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The document named, either by its path from the repository root or as a bare filename. Never as the
 * tail of a longer name (`my-icons.md`) or the head of one (`icons.md.bak`), which is not naming it.
 */
const named = (name, text) =>
  new RegExp(`${escapeRe(DESIGN_DIR)}/${escapeRe(name)}(?![\\w-]|\\.\\w)`).test(text) ||
  new RegExp(`(?<![\\w./-])${escapeRe(name)}(?![\\w-]|\\.\\w)`).test(text);

export function checkAgentAuthority(root) {
  const errors = [];
  const warnings = [];
  const briefFile = join(root, BRIEF_PATH);
  if (!existsSync(briefFile)) return { errors: [`${BRIEF_PATH} does not exist`], warnings, counts: { documents: 0, named: 0, excluded: 0 } };
  const brief = readFileSync(briefFile, 'utf8');

  // ---- split the brief at the exclusions block
  const starts = brief.split(EXCLUSIONS_START).length - 1;
  const ends = brief.split(EXCLUSIONS_END).length - 1;
  let outside = brief;
  let block = '';
  if (starts !== ends || starts > 1) {
    errors.push(`${BRIEF_PATH}: needs exactly one ${EXCLUSIONS_START} ... ${EXCLUSIONS_END} block, or none (found ${String(starts)} start and ${String(ends)} end)`);
  } else if (starts === 1) {
    const a = brief.indexOf(EXCLUSIONS_START);
    const b = brief.indexOf(EXCLUSIONS_END);
    if (b < a) errors.push(`${BRIEF_PATH}: the exclusions block ends before it starts`);
    else {
      block = brief.slice(a + EXCLUSIONS_START.length, b);
      outside = brief.slice(0, a) + brief.slice(b + EXCLUSIONS_END.length);
    }
  }

  // ---- what is excluded, each with a reason
  const excluded = new Map();
  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith('- ')) continue;
    const m = /^- `?([^`\s]+)`?(?: — (.*))?$/.exec(line.trim());
    if (m === null) {
      errors.push(`${BRIEF_PATH}: an exclusions line is not "- file — reason": ${line.trim()}`);
      continue;
    }
    const reason = (m[2] ?? '').trim();
    if (reason === '') errors.push(`${BRIEF_PATH}: ${m[1]} is excluded with no reason`);
    excluded.set(m[1], reason);
  }

  // ---- every design document is accounted for
  const documents = files(root, DESIGN_DIR).map((f) => f.slice(DESIGN_DIR.length + 1));
  let namedCount = 0;
  for (const doc of documents) {
    const isNamed = named(doc, outside);
    const isExcluded = excluded.has(doc);
    if (isNamed && isExcluded) {
      errors.push(`${BRIEF_PATH}: ${doc} is both named as part of the specification and listed as excluded`);
    } else if (!isNamed && !isExcluded) {
      errors.push(`${DESIGN_DIR}/${doc} is neither named in ${BRIEF_PATH} nor listed in its exclusions: the reviewer does not know it exists`);
    }
    if (isNamed) namedCount += 1;
  }

  // ---- stale references, which warn: a rename should not leave the brief pointing at nothing
  const present = new Set(documents);
  for (const name of excluded.keys()) {
    if (!present.has(name)) warnings.push(`${BRIEF_PATH}: excludes ${name}, which is not in ${DESIGN_DIR}/`);
  }
  for (const m of outside.matchAll(/docs\/design\/([A-Za-z0-9_.-]+\.[A-Za-z0-9]+)/g)) {
    if (!present.has(m[1])) warnings.push(`${BRIEF_PATH}: names ${DESIGN_DIR}/${m[1]}, which does not exist`);
  }

  return { errors, warnings, counts: { documents: documents.length, named: namedCount, excluded: excluded.size } };
}
