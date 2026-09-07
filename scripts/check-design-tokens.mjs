/**
 * Family Finance Buddy — the design and the code, kept honest about each other.
 *
 * `docs/tokens.md` is the source of truth for colour, type and spacing. Three
 * other files restate it: the stylesheet the app actually ships, and the two
 * standalone documents in docs/design that were authored away from the code.
 * Four copies of one palette is three chances to drift, and drift here is the
 * quiet kind — nothing breaks, the app simply stops being the thing that was
 * designed, one hex at a time.
 *
 * So this compares them. It is not a style checker and it has no opinion about
 * which value is right: it says only that four files disagree, and about what.
 *
 * What it deliberately does NOT check: layout, hierarchy, spacing rhythm,
 * copy tone, or whether a screen matches its mock. None of that is mechanical,
 * and a check that pretended otherwise would either be useless or start
 * failing for reasons nobody could act on. That comparison is a person reading
 * the prototype beside the app — this only removes the part of it that a
 * person should never have to do by eye.
 *
 * Run: node scripts/check-design-tokens.mjs
 */

import { readFileSync } from 'node:fs';

const SOURCES = [
  { name: 'docs/tokens.md', path: 'docs/tokens.md', authority: true },
  { name: 'src/styles/tokens.css', path: 'src/styles/tokens.css' },
  { name: 'docs/design/prototype.html', path: 'docs/design/prototype.html' },
  { name: 'docs/design/icon-concepts.html', path: 'docs/design/icon-concepts.html' },
];

/**
 * Markdown is prose with code in it, and only the code is a declaration.
 *
 * The first version of this read the whole file, and `tokens.md` line 12
 * happens to mention `[data-theme]` in a sentence — which truncated the source
 * of truth to nothing and made the check pass by comparing zero tokens. Hence
 * the fenced blocks only, and the guard at the bottom of this file.
 */
function codeOnly(path, text) {
  if (!path.endsWith('.md')) return [text];
  return [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}

/**
 * Only the light palette.
 *
 * Every file declares the dark values again under a media query or a
 * `[data-theme]` block, and the same property name legitimately holds a
 * different value in each. Comparing across them would report a disagreement
 * on every single token, which is the kind of noise that gets a check deleted.
 */
function lightBlockOf(text) {
  // Comments first, always. Both files that broke this check broke it the same
  // way: `[data-theme]` written in a sentence explaining the dark theme, above
  // the declarations, cutting the file off before any of them. Prose that
  // talks about CSS is not CSS.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return code.split(/@media|\[data-theme/)[0];
}

/**
 * Values are compared for what they mean, not how they were typed.
 *
 * `'IBM Plex Mono'` and `"IBM Plex Mono"` are the same font, and
 * `rgba(21,27,36,.06)` is the same colour as `rgba(21, 27, 36, 0.06)`. A check
 * that failed on those would train everybody to ignore it within a week.
 */
function normalise(value) {
  return value
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\s*,\s*/g, ',')
    .replace(/(^|[^0-9])0\./g, '$1.')
    .trim();
}

/**
 * Each chunk is trimmed on its own.
 *
 * A document declares colours in one fenced block, the dark overrides in the
 * next, and type in a third. Trimming the concatenation at the first `@media`
 * threw away every block after the dark one — so the type and spacing tokens
 * silently went uncompared while the check reported success. Per chunk, the
 * dark block trims to nothing and the ones after it survive.
 */
function tokensIn(chunks) {
  const found = new Map();
  for (const chunk of chunks) {
    for (const match of lightBlockOf(chunk).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
      // First declaration wins: a later one is an override for a narrower
      // selector, not a competing definition of the token.
      if (!found.has(match[1])) found.set(match[1], normalise(match[2]));
    }
  }
  return found;
}

const read = SOURCES.map((source) => ({
  ...source,
  tokens: tokensIn(codeOnly(source.path, readFileSync(source.path, 'utf8'))),
}));

const authority = read.find((source) => source.authority);

/**
 * A check that can pass by comparing nothing is worse than no check: it is a
 * green tick that means the opposite of what anybody reads it to mean. This
 * one has already done that once.
 */
if (authority.tokens.size < 20) {
  console.log(
    `  ✗ Only ${String(authority.tokens.size)} tokens were read from ${authority.name}. ` +
      'That file defines far more, so the parser is broken rather than the palette.',
  );
  process.exit(1);
}

for (const source of read) {
  if (!source.authority && source.tokens.size === 0) {
    console.log(`  ✗ No tokens found in ${source.name}. Has it moved, or changed shape?`);
    process.exit(1);
  }
}
const disagreements = [];

for (const key of [...authority.tokens.keys()].sort()) {
  const expected = authority.tokens.get(key);
  for (const source of read) {
    if (source.authority) continue;
    const actual = source.tokens.get(key);
    // Absent is not wrong. The prototype has no need for --radius-pill and the
    // icon document declares only the handful of colours it draws with.
    if (actual !== undefined && actual !== expected) {
      disagreements.push({ key, source: source.name, expected, actual });
    }
  }
}

if (disagreements.length === 0) {
  console.log(`  ✓ ${String(authority.tokens.size)} design tokens agree across ${String(read.length)} files.`);
  process.exit(0);
}

console.log('  ✗ Design tokens disagree with docs/tokens.md, which is the source of truth:\n');
for (const { key, source, expected, actual } of disagreements) {
  console.log(`      ${key}`);
  console.log(`          docs/tokens.md  ${expected}`);
  console.log(`          ${source}  ${actual}`);
}
console.log(`
  Decide which is right and change the other. If the design moved, tokens.md
  moves first — the prototype and the stylesheet both restate it, and neither
  gets to be the place a colour is decided.
`);
process.exit(1);
