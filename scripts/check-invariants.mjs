/**
 * Family Finance Buddy — is every rule a design document states tested, and is every test of one real?
 *
 * Both directions (docs/design/keeping-docs-honest.md §3):
 *
 *   An invariant with no test and no waiver fails.
 *   A test whose title names an ID that no document declares fails. That is the one that earns its keep:
 *   it fires when an invariant is edited or renumbered and its test is left behind, which is the exact
 *   moment the design changed and the test did not.
 *
 * A waiver (docs/design/waivers.md) counts as covered, must give a reason and a date, must name an ID
 * that exists, and warns once it is over ninety days old.
 *
 * Run: node scripts/check-invariants.mjs [--root <dir>]
 */

import { checkInvariants } from './lib/invariants.mjs';

const rootArg = process.argv.indexOf('--root');
const root = rootArg === -1 ? process.cwd() : (process.argv[rootArg + 1] ?? process.cwd());

const { errors, warnings, counts } = checkInvariants(root, new Date());

for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);

if (errors.length > 0) {
  console.log(`\n  ${String(errors.length)} problem${errors.length === 1 ? '' : 's'}. An invariant needs a test whose title names its ID, or a line in docs/design/waivers.md saying why not.`);
  process.exit(1);
}

console.log(
  `  ✓ ${String(counts.declared)} invariants (${counts.prefixes.join(', ')}): ${String(counts.tested)} tested, ${String(counts.waivedOnly)} waived, none unaccounted for.`,
);
