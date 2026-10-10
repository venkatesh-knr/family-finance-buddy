import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAgentAuthority } from './lib/agent-authority.mjs';
import { checkInvariants, parseDoc, parseWaivers, readTsTitles } from './lib/invariants.mjs';
import { readPgTap } from './lib/sql-tap.mjs';

/**
 * The two doc checks, and the pgTAP reader they lean on, tested on fixture repositories.
 *
 * A check that cannot fail is decoration, so most of these are the check failing: the invariant with no
 * test, the test whose invariant was renumbered away, the waiver with no reason. Fixture IDs use a
 * prefix no real document declares.
 */

const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** A throwaway repository: { 'relative/path': 'contents' }. */
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'ffb-checks-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const NOW = new Date('2026-10-10T00:00:00Z');
const DOC = '<!-- invariant-prefix: ZZ -->\n\n**ZZ-I1 — the first rule.**\n\n**ZZ-I2 — the second rule.**\n';
const TS_BOTH = "import { it } from 'vitest';\nit('ZZ-I1 — first', () => {});\nit('ZZ-I2 — second', () => {});\n";

describe('an invariant and its test', () => {
  it('pass when every declared ID is named in a test title', () => {
    const r = checkInvariants(repo({ 'docs/design/a.md': DOC, 'src/a.test.ts': TS_BOTH }), NOW);
    expect(r.errors).toEqual([]);
    expect(r.counts).toMatchObject({ declared: 2, tested: 2, waivedOnly: 0 });
  });

  it('fail, naming the line, when an invariant has no test and no waiver', () => {
    const r = checkInvariants(repo({ 'docs/design/a.md': DOC, 'src/a.test.ts': "import { it } from 'vitest';\nit('ZZ-I1 — first', () => {});\n" }), NOW);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('docs/design/a.md:5');
    expect(r.errors[0]).toContain('ZZ-I2 has no test and no waiver');
  });

  it('fail the other way too: a test that names an ID no document declares, which is what a renumbering leaves behind', () => {
    const doc = '<!-- invariant-prefix: ZZ -->\n\n**ZZ-I1 — the first rule.**\n';
    const tests = "import { it } from 'vitest';\nit('ZZ-I1 — first', () => {});\nit('ZZ-I2 — was the second, is gone', () => {});\n";
    const r = checkInvariants(repo({ 'docs/design/a.md': doc, 'src/a.test.ts': tests }), NOW);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('names ZZ-I2, which no document declares');
  });

  it('fail on a test naming an ID whose whole document was never given a prefix', () => {
    const r = checkInvariants(repo({ 'docs/design/a.md': DOC, 'src/a.test.ts': TS_BOTH + "it('QQ-R9 — from a document that does not exist', () => {});\n" }), NOW);
    expect(r.errors.some((e) => e.includes('QQ-R9'))).toBe(true);
  });

  it('do not count an ID in a comment, because a comment is not in the output of a run', () => {
    const tests = "import { it } from 'vitest';\n// ZZ-I1 is covered below\nit('first', () => {});\nit('ZZ-I2 — second', () => {});\n";
    const r = checkInvariants(repo({ 'docs/design/a.md': DOC, 'src/a.test.ts': tests }), NOW);
    expect(r.errors.join('\n')).toContain('ZZ-I1 has no test');
  });

  it('read titles from it.each, template literals, nested suites and Playwright, whichever way they are written', () => {
    const titles = readTsTitles(
      [
        "import { describe, it, test } from 'vitest';",
        "describe('ZZ-S1 — a suite', () => {",
        "  it.each([1, 2])('ZZ-E1 — each %s', () => {});",
        '  test(`ZZ-T1 — ${String(1)} template`, () => {});',
        "  test.describe('ZZ-P1 — a playwright group', () => {});",
        '});',
      ].join('\n'),
      'x.test.ts',
    );
    expect(titles.join('|')).toContain('ZZ-S1');
    expect(titles.join('|')).toContain('ZZ-E1');
    expect(titles.join('|')).toContain('ZZ-T1');
    expect(titles.join('|')).toContain('ZZ-P1');
  });
});

describe('a document that declares invariants', () => {
  it('fails with no prefix declared', () => {
    const r = checkInvariants(repo({ 'docs/design/a.md': '**ZZ-I1 — a rule.**\n' }), NOW);
    expect(r.errors.join('\n')).toContain('no valid <!-- invariant-prefix: ZZ -->');
  });

  it('fails when a line uses another prefix than the document declares', () => {
    const r = checkInvariants(repo({ 'docs/design/a.md': '<!-- invariant-prefix: ZZ -->\n**YY-I1 — a rule.**\n' }), NOW);
    expect(r.errors.join('\n')).toContain("this document's prefix is ZZ");
  });

  it('fails when two documents declare the same prefix', () => {
    const r = checkInvariants(repo({ 'docs/design/a.md': DOC, 'docs/design/b.md': '<!-- invariant-prefix: ZZ -->\n**ZZ-I9 — another.**\n', 'src/a.test.ts': TS_BOTH }), NOW);
    expect(r.errors.join('\n')).toContain('prefix ZZ is already declared');
  });

  it('fails when an ID is declared twice in one document', () => {
    const r = checkInvariants(repo({ 'docs/design/a.md': '<!-- invariant-prefix: ZZ -->\n**ZZ-I1 — one.**\n**ZZ-I1 — again.**\n' }), NOW);
    expect(r.errors.join('\n')).toContain('ZZ-I1 is declared twice');
  });

  it('ignores the format shown as an example in a fenced code block, as the design doc itself does', () => {
    const doc = [
      '<!-- invariant-prefix: ZZ -->',
      '**ZZ-I1 — a real rule.**',
      '',
      '```',
      '<!-- invariant-prefix: YY -->',
      '**YY-I5 — an example, not a rule.**',
      '**ZZ-I9 — nor is this.**',
      '```',
      '',
    ].join('\n');
    const r = checkInvariants(repo({ 'docs/design/a.md': doc, 'src/a.test.ts': "it('ZZ-I1 — x', () => {});\n" }), NOW);
    expect(r.errors).toEqual([]);
    expect(r.counts.declared).toBe(1);
  });

  it('keeps the file’s own line numbers when it skips a fenced block', () => {
    const doc = '<!-- invariant-prefix: ZZ -->\n```\nexample\nexample\n```\n**ZZ-I1 — after the fence.**\n';
    const r = checkInvariants(repo({ 'docs/design/a.md': doc }), NOW);
    expect(r.errors[0]).toContain('docs/design/a.md:6');
  });

  it('is not tripped by a test-list line that merely mentions an ID in bold', () => {
    const doc = '<!-- invariant-prefix: ZZ -->\n**ZZ-I1 — a rule.**\n\n- **ZZ-I1**: how it is tested\n';
    const r = checkInvariants(repo({ 'docs/design/a.md': doc, 'src/a.test.ts': "it('ZZ-I1 — x', () => {});\n" }), NOW);
    expect(r.errors).toEqual([]);
  });

  it('may not be the findings log: numbering fixed bugs as rules would make them look standing', () => {
    const r = checkInvariants(repo({ 'docs/design/ui-review.md': '<!-- invariant-prefix: UI -->\n**UI-F1 — a finding.**\n' }), NOW);
    expect(r.errors.join('\n')).toContain('findings log');
  });

  it('is left alone when it declares no prefix and no invariants', () => {
    const r = checkInvariants(repo({ 'docs/design/notes.md': '# Notes\n\nNothing here.\n' }), NOW);
    expect(r.errors).toEqual([]);
  });
});

describe('a waiver', () => {
  const base = { 'docs/design/a.md': DOC, 'src/a.test.ts': "it('ZZ-I1 — first', () => {});\n" };

  it('counts as covered', () => {
    const r = checkInvariants(repo({ ...base, 'docs/design/waivers.md': '- ZZ-I2 — nothing to assert it against until it ships — 2026-10-10\n' }), NOW);
    expect(r.errors).toEqual([]);
    expect(r.counts).toMatchObject({ tested: 1, waivedOnly: 1 });
  });

  it('fails with no reason', () => {
    const r = checkInvariants(repo({ ...base, 'docs/design/waivers.md': '- ZZ-I2 —  — 2026-10-10\n' }), NOW);
    expect(r.errors.join('\n')).toContain('gives no reason');
  });

  it('fails with no date, because then it can never age', () => {
    const r = checkInvariants(repo({ ...base, 'docs/design/waivers.md': '- ZZ-I2 — a reason\n' }), NOW);
    expect(r.errors.join('\n')).toContain('has no date');
  });

  it('fails when it names an ID that does not exist', () => {
    const r = checkInvariants(repo({ ...base, 'docs/design/waivers.md': '- ZZ-I2 — fine — 2026-10-10\n- ZZ-I77 — a typo — 2026-10-10\n' }), NOW);
    expect(r.errors.join('\n')).toContain('waives ZZ-I77, which no document declares');
  });

  it('warns, and does not fail, once it is over ninety days old', () => {
    const r = checkInvariants(repo({ ...base, 'docs/design/waivers.md': '- ZZ-I2 — a reason — 2026-06-01\n' }), NOW);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toContain('days old');
  });

  it('does not warn on one under ninety', () => {
    const r = checkInvariants(repo({ ...base, 'docs/design/waivers.md': '- ZZ-I2 — a reason — 2026-09-01\n' }), NOW);
    expect(r.warnings).toEqual([]);
  });

  it('warns that it can go once the invariant has a test', () => {
    const r = checkInvariants(repo({ ...base, 'docs/design/waivers.md': '- ZZ-I1 — stale — 2026-10-10\n- ZZ-I2 — fine — 2026-10-10\n' }), NOW);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toContain('the waiver can go');
  });

  it('is only a line that opens with an ID: a bullet of prose in the file is not one', () => {
    const { waivers, problems } = parseWaivers('# Waivers\n\n- One line each, as below.\n- ZZ-I2 — a reason — 2026-10-10\n');
    expect(problems).toEqual([]);
    expect(waivers).toHaveLength(1);
  });
});

describe('the pgTAP reader', () => {
  const wrap = (body, plan) => `begin;\nselect plan(${String(plan)});\n${body}\nselect * from finish();\nrollback;\n`;

  it('reads a description, decoding doubled quotes', () => {
    const r = readPgTap(wrap("select is(1, 1, 'ZZ-I1 — a member''s total');", 1));
    expect(r.reliable).toBe(true);
    expect(r.titles).toEqual(["ZZ-I1 — a member's total"]);
  });

  it('reads the description of a four-argument throws_ok and a CTE-wrapped assertion', () => {
    const r = readPgTap(
      wrap(
        "select throws_ok($q$ select 1 $q$, '42501'::char(5), null::text, 'ZZ-I1 — refused');\nwith attempted as (update t set a = 1 returning 1) select is((select count(*) from attempted), 0::bigint, 'ZZ-I2 — nothing changed');",
        2,
      ),
    );
    expect(r.reliable).toBe(true);
    expect(r.titles).toEqual(['ZZ-I1 — refused', 'ZZ-I2 — nothing changed']);
  });

  it('does not take an ID out of a comment, a fixture string or a dollar-quoted body', () => {
    const r = readPgTap(
      wrap("-- ZZ-I1 is covered here\ninsert into t values ('ZZ-I1 in a fixture');\nselect is_empty($q$ select 'ZZ-I1 inside a body' $q$, 'a plain description');", 1),
    );
    expect(r.reliable).toBe(true);
    expect(r.titles).toEqual(['a plain description']);
  });

  it('takes no description from a three-argument throws_ok, which pgTAP itself reads by type', () => {
    const r = readPgTap(wrap("select throws_ok($q$ select 1 $q$, '42501'::char(5), 'ZZ-I1 — maybe a message, maybe a title');", 1));
    expect(r.titles).toEqual([]);
  });

  it('declares itself unreliable when its count disagrees with plan(N), and the checker then counts nothing in that file', () => {
    const sql = wrap("select is(1, 1, 'ZZ-I1 — one');\nselect is(1, 1, 'ZZ-I2 — two');", 3);
    const r = readPgTap(sql);
    expect(r.reliable).toBe(false);
    expect(r.why).toContain('plan(3)');
    const found = checkInvariants(repo({ 'docs/design/a.md': DOC, 'supabase/tests/a.test.sql': sql }), NOW);
    const text = found.errors.join('\n');
    expect(text).toContain('cannot be read reliably');
    expect(text).toContain('ZZ-I1 has no test');
  });

  it('counts a reliable SQL test as coverage', () => {
    const sql = wrap("select is(1, 1, 'ZZ-I1 — one');\nselect is(1, 1, 'ZZ-I2 — two');", 2);
    const found = checkInvariants(repo({ 'docs/design/a.md': DOC, 'supabase/tests/a.test.sql': sql }), NOW);
    expect(found.errors).toEqual([]);
  });

  it('refuses a file with no plan or with no_plan(), since neither can be reconciled', () => {
    expect(readPgTap("select is(1, 1, 'x');").reliable).toBe(false);
    expect(readPgTap("select * from no_plan();\nselect is(1, 1, 'x');").reliable).toBe(false);
  });

  it('parses a document it did not write: ID lines and prefix come out as declared', () => {
    const doc = parseDoc('docs/design/a.md', DOC);
    expect(doc.prefix).toBe('ZZ');
    expect(doc.invariants.map((i) => i.id)).toEqual(['ZZ-I1', 'ZZ-I2']);
  });
});

describe('the reviewer brief', () => {
  const brief = (body) => `---\nname: design-conformance\n---\n${body}\n`;
  const block = (lines) => `<!-- authority-exclusions:start -->\n${lines}\n<!-- authority-exclusions:end -->`;

  it('passes when every design document is named or excluded with a reason', () => {
    const root = repo({
      '.claude/agents/design-conformance.md': brief(`Read docs/design/icons.md first.\n${block('- `copy.html` — a rendered copy, not a second source')}`),
      'docs/design/icons.md': '# x',
      'docs/design/copy.html': '<p>x</p>',
    });
    const r = checkAgentAuthority(root);
    expect(r.errors).toEqual([]);
    expect(r.counts).toMatchObject({ documents: 2, named: 1, excluded: 1 });
  });

  it('fails for a design document the brief has never heard of', () => {
    const root = repo({
      '.claude/agents/design-conformance.md': brief('Read icons.md.'),
      'docs/design/icons.md': '# x',
      'docs/design/protection-and-flow.md': '# new',
    });
    const r = checkAgentAuthority(root);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('protection-and-flow.md is neither named');
  });

  it('fails when an exclusion gives no reason', () => {
    const root = repo({ '.claude/agents/design-conformance.md': brief(block('- `copy.html`')), 'docs/design/copy.html': '<p>x</p>' });
    expect(checkAgentAuthority(root).errors.join('\n')).toContain('excluded with no reason');
  });

  it('fails when a document is both named as specification and excluded', () => {
    const root = repo({
      '.claude/agents/design-conformance.md': brief(`Read copy.html.\n${block('- `copy.html` — a copy')}`),
      'docs/design/copy.html': '<p>x</p>',
    });
    expect(checkAgentAuthority(root).errors.join('\n')).toContain('both named');
  });

  it('does not take a name that is only the tail of a longer one', () => {
    const root = repo({ '.claude/agents/design-conformance.md': brief('Read my-icons.md and icons.md.bak.'), 'docs/design/icons.md': '# x' });
    expect(checkAgentAuthority(root).errors.join('\n')).toContain('icons.md is neither named');
  });

  it('fails on a block that is opened and not closed, and warns about an exclusion that names nothing', () => {
    const open = repo({ '.claude/agents/design-conformance.md': brief('x\n<!-- authority-exclusions:start -->\n- `a.md` — r'), 'docs/design/a.md': '#' });
    expect(checkAgentAuthority(open).errors.join('\n')).toContain('needs exactly one');
    const stale = repo({ '.claude/agents/design-conformance.md': brief(`Read a.md.\n${block('- `gone.md` — was removed')}`), 'docs/design/a.md': '#' });
    const r = checkAgentAuthority(stale);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toContain('gone.md');
  });

  it('fails when there is no brief at all', () => {
    expect(checkAgentAuthority(repo({ 'docs/design/a.md': '#' })).errors.join('\n')).toContain('does not exist');
  });
});
