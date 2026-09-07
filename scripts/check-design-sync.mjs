/**
 * Family Finance Buddy — does the ledger still describe the app?
 *
 * The design lives in docs/design and the app lives in src, and they are
 * written in different places at different times. docs/design/conformance.md is
 * the record of how they relate: what is built, what is not, and where the app
 * deliberately disagrees with the mock.
 *
 * A record like that is worth exactly as much as its accuracy, and hand-kept
 * records rot. So three things are checked:
 *
 *   1. Every screen the prototype defines has a row in the ledger. Add a screen
 *      to the mock and the build fails until somebody says when it gets built.
 *   2. Every row claiming `built` or `partial` names a path that exists. A
 *      ledger that says "built: src/features/overview" when there is no such
 *      folder is worse than no ledger, because it is believed.
 *   3. Nothing is claimed for a screen the prototype does not have, which
 *      catches a row left behind after a rename.
 *
 * What it does NOT check, and cannot: whether a screen looks like its mock,
 * whether the hierarchy matches, whether the copy reads right. That comparison
 * is a person with the prototype open beside the app. This removes the
 * bookkeeping around it so the person is doing the part only a person can.
 *
 * Run: node scripts/check-design-sync.mjs
 */

import { existsSync, readFileSync } from 'node:fs';

const PROTOTYPE = 'docs/design/prototype.html';
const LEDGER = 'docs/design/conformance.md';

const prototype = readFileSync(PROTOTYPE, 'utf8');
const ledger = readFileSync(LEDGER, 'utf8');

/**
 * Screens, as the prototype itself declares them.
 *
 * Read from the view containers rather than the tab strip, because three of
 * them — profile, settings, privacy — are reached from the account menu and
 * have no tab. Counting tabs would have quietly missed exactly the screens
 * this project built most recently.
 */
const screens = [...prototype.matchAll(/<div class="view[^"]*" id="v-([a-z-]+)"/g)].map((m) => m[1]);

if (screens.length === 0) {
  console.log(`  ✗ No screens found in ${PROTOTYPE}. Has its markup changed shape?`);
  process.exit(1);
}

/** Ledger rows: | item | kind | status | where | */
const rows = [...ledger.matchAll(/^\|\s*([a-z0-9-]+)\s*\|\s*(screen|component)\s*\|\s*(built|partial|not-built)\s*\|([^|]*)\|/gm)].map(
  (m) => ({ item: m[1], kind: m[2], status: m[3], where: m[4].trim() }),
);

if (rows.length === 0) {
  console.log(`  ✗ No rows parsed from ${LEDGER}. Has the table changed shape?`);
  process.exit(1);
}

const problems = [];

const screenRows = new Map(rows.filter((r) => r.kind === 'screen').map((r) => [r.item, r]));

for (const screen of screens) {
  if (!screenRows.has(screen)) {
    problems.push(
      `${PROTOTYPE} designs a "${screen}" screen with no row in the ledger.\n` +
        `        Add one saying whether it is built, and if not, which stage owns it.`,
    );
  }
}

for (const item of screenRows.keys()) {
  if (!screens.includes(item)) {
    problems.push(
      `The ledger has a "${item}" screen the prototype no longer defines.\n` +
        `        Renamed, or removed? The row is describing something that is not there.`,
    );
  }
}

/**
 * A claim of "built" has to point at something real.
 *
 * Paths are written in backticks in the note column. Anything else there is
 * prose and is left alone — the column carries reasons as well as paths, and
 * demanding a rigid format would make the ledger unreadable to keep it
 * checkable, which is the wrong trade for a document people have to read.
 */
for (const row of rows) {
  if (row.status === 'not-built') continue;

  const paths = [...row.where.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1])
    .filter((p) => p.includes('/') && !p.startsWith('§') && !p.includes(' '));

  if (paths.length === 0) {
    problems.push(`"${row.item}" is marked ${row.status} but names no path. What is built, and where?`);
    continue;
  }

  for (const path of paths) {
    if (!existsSync(path)) {
      problems.push(`"${row.item}" is marked ${row.status} and points at ${path}, which does not exist.`);
    }
  }
}

if (problems.length > 0) {
  console.log('  ✗ The design ledger and the code disagree:\n');
  for (const problem of problems) console.log(`      ${problem}`);
  console.log(`
  ${LEDGER} is the record of how the design and the app relate. When one of
  them moves, it moves too — that is the whole job it does.
`);
  process.exit(1);
}

// Counted per kind. A single total mixing screens and components reads as
// "13 of 13 screens built", which was neither true nor a small thing to imply.
const tally = (kind, status) => rows.filter((r) => r.kind === kind && r.status === status).length;

console.log(
  `  ✓ Design ledger matches the prototype.
` +
    `      screens     ${String(tally('screen', 'built'))} built, ` +
    `${String(tally('screen', 'partial'))} partial, ` +
    `${String(tally('screen', 'not-built'))} to come  (of ${String(screens.length)} designed)
` +
    `      components  ${String(tally('component', 'built'))} built, ` +
    `${String(tally('component', 'not-built'))} to come`,
);
