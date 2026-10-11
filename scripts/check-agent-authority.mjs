/**
 * Family Finance Buddy — does the design-conformance brief know every design document?
 *
 * Every file in docs/design/ is named in .claude/agents/design-conformance.md or listed in its
 * exclusions block with a reason (docs/design/keeping-docs-honest.md §3). See lib/agent-authority.mjs for
 * why: a reviewer measuring against a specification with a part missing produces findings that look
 * reasonable and are wrong, and nothing in its output says so.
 *
 * Run: node scripts/check-agent-authority.mjs [--root <dir>]
 */

import { checkAgentAuthority } from './lib/agent-authority.mjs';

const rootArg = process.argv.indexOf('--root');
const root = rootArg === -1 ? process.cwd() : (process.argv[rootArg + 1] ?? process.cwd());

const { errors, warnings, counts } = checkAgentAuthority(root);

for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);

if (errors.length > 0) {
  console.log('\n  Name the document in the brief, in the order of authority or as something it reads and does not obey, or list it under the exclusions with the reason.');
  process.exit(1);
}

console.log(
  `  ✓ The reviewer's brief accounts for all ${String(counts.documents)} documents in docs/design (${String(counts.named)} named, ${String(counts.excluded)} excluded with a reason).`,
);
