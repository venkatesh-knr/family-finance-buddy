# Keeping the docs honest

A design doc that no test enforces is a wish. This is the mechanism that keeps
the two in step, and the reasoning for why it is shaped the way it is.

## 1. A gate, not a schedule

Anything on a calendar gets skipped the week you are busy, which is the week it
matters. The check runs as part of CI, at the end of every slice, before the PR
merges. Nobody has to remember it.

Running it per slice rather than per project is what makes it affordable: there
is never a backlog for it to light up red against. A check that fails forty
times the first time it runs gets mass-waived, and then it proves nothing.

The pattern already exists here — `scripts/check-design-sync.mjs` fails the
build when the screen inventory goes stale. This extends that pattern to two
more dimensions rather than inventing a new one.

## 2. Invariant IDs

Every rule a doc states that a test could enforce gets an ID.

**Declaration.** Each design doc declares its prefix once, near the top:

```
<!-- invariant-prefix: DL -->
```

Explicit, not derived from the filename — `detail-level.md` and
`design-level.md` would both derive to `DL`, and a silent collision is worse
than a missing one. The checker errors if two docs declare the same prefix.

**In the doc**, an invariant is a bolded line opening with its ID:

```
**DL-I5 — `detail_level` is not a permission.**
```

**In the test**, the ID appears in the test title:

```ts
test('DL-I1 — figures are identical across detail levels', …)
```

```sql
select is(…, 'PF-C2 — a policy contributes nothing to net worth');
```

The title, not a comment. Comments drift out of test output; a title appears in
every run and in every failure.

## 3. The three checks

### `check-invariants.mjs`

Scans `docs/**/*.md` for prefix declarations and invariant lines, scans the test
suites for ID tokens, and reports both directions:

- **An invariant with no test.** The obvious one. Fails the build.
- **A test naming an ID that no doc declares.** The one that earns its keep —
  it fires when somebody edits or renumbers an invariant and leaves the test
  behind, which is exactly the moment the design changed and the test did not.
  Fails the build.

### `check-agent-authority.mjs`

Every file in `docs/design/` is either named in the subagent brief
(`.claude/agents/design-conformance.md`) or listed in an explicit exclusions
block in that brief. Fails otherwise.

This one has a demonstrated failure behind it. The brief named `blueprint.md`,
`tokens.md`, `conformance.md` and `prototype.html`; `icons.md`,
`protection-and-flow.md` and `detail-level.md` were added later and the agent
had no idea they existed. It kept producing findings that looked entirely
reasonable while reviewing against the wrong spec — which is the worst failure
mode a reviewer has, because nothing about the output says it is stale.

### `check-design-sync.mjs`

Exists. Screen inventory. Unchanged.

## 4. Waivers

Without an escape hatch, a red build gets a fake test that names the ID and
asserts nothing. With one, the pressure goes somewhere visible.

`docs/design/waivers.md`, one line each:

```
- DL-I3 — no mechanism to assert nav equality until the toggle ships — 2026-10-10
```

The checker accepts a waived invariant as covered, and **fails** on a waiver
with no reason, or naming an ID that does not exist. A waiver older than 90 days
warns rather than fails — long enough not to nag, short enough that a permanent
waiver has to be re-stated by somebody who notices they are re-stating it.

## 5. The post-development loop

Per slice, before the PR merges:

1. `check-invariants` — fails the build
2. `check-design-sync` — fails the build
3. `check-agent-authority` — fails the build
4. Full suite: unit, e2e, pgTAP. **Unfiltered output, captured to a file.** A
   failure whose message was lost to a `| grep` has already happened once in
   this project and cost a diagnosis.
5. Subagent review of the screens the slice touched — advisory

## 6. What is deliberately not gated

**The subagent.** It is a reviewer, not a check. It is nondeterministic, it
will miss things, and the first time it fails a build for a finding that turns
out to be wrong, somebody disables it — at which point the project has lost the
only reader that looks at the screens.

So it never fails a build, and its output is read by a person who decides. The
cost of that honesty is that step 5 is the one that gets skipped, because
nothing forces it. That is a real weakness and this document is not going to
pretend otherwise; it is a choice between a step that is sometimes skipped and
a step that is eventually switched off.

Three things that are also not gated, and should not be: whether a design
decision was *good*, whether a screen *looks* right, and whether an invariant is
the right invariant. Those need judgement. The checks here only assert that
whatever was decided is written down and whatever is written down is tested.

## 7. Retrofit

IDs go into the existing docs in this order, cheapest first:

| doc | prefix | note |
| --- | --- | --- |
| `detail-level.md` | `DL` | already numbered I1–I6; prefix them |
| `protection-and-flow.md` | `PF` | invariants are prose today; extract and number |
| `icons.md` | `IC` | §5 and §6 are already written as requirements |
| `tokens.md` | `TK` | the contrast and depth rules; the largest job |
| `blueprint.md` | `BP` | last, and possibly never in full |

`ui-review.md` gets no IDs — it is a findings log, not a specification, and
numbering findings as invariants would make a list of fixed bugs look like a
list of standing rules.

Do the prefix rename before the next doc is written. Renaming invariants that
tests already reference is churn nobody does, so the IDs quietly stay
inconsistent and the gate never gets built because by then it is too much work.
