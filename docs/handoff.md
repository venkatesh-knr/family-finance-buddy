# Handoff — working from the local machine or from the cloud

The work happens in **one place at a time**: either the maintainer's Windows machine or a
cloud session. Never both at once, and nothing is shared except what is in git. This file is
what the next session reads first, so whichever side it is, it starts from the same facts.

`CLAUDE.md` is the rules. `docs/blueprint.md`, `docs/tokens.md` and `docs/build-plan.md` are the
specification and the order of work. This file is the part that is neither: how to pick the work up,
and where it was put down.

---

## The rule: git is the only thing that moves

- **Everything that matters is committed and pushed before you stop.** An uncommitted edit, an
  unpushed commit and a branch that exists only on one machine are all invisible to the other
  side, and all of them are lost if that machine is not the one you return to.
- **Nothing is edited in both places.** If you are starting here, the other side has stopped.
  If you are not sure it has, it has not: ask the maintainer.
- **Main moves only by merged pull requests.** Work on a branch, open a PR, let CI go green, merge.
  Nobody commits to `main` from either side.
- **The memory a session builds up is not shared.** Claude Code's own memory lives on the machine
  it ran on. Anything a later session needs is in this file or in `CLAUDE.md`, not there.

### Starting a session (either side)

```bash
node scripts/handoff-check.mjs --arriving
```

It fetches, then lists any branch carrying work that `main` does not have, newest first, and tells
you if this checkout is behind. Then:

1. `git checkout main && git pull --ff-only`, unless the last session left a branch: check it out
   and `git pull --ff-only` it instead.
2. Read **"Where the last session stopped"** below, on that branch if there is one.
3. `npm ci` if `package-lock.json` changed.

### Ending a session (either side)

```bash
node scripts/handoff-check.mjs --leaving
```

It exits non-zero while anything exists only on this machine. It never pushes or discards: it tells
you what to push. Then:

1. Commit everything. A work-in-progress commit is fine; a stranded edit is not.
2. `git push -u origin <branch>`.
3. **Rewrite "Where the last session stopped"** on that branch and push it. One short paragraph:
   the branch, what is done, what is next, anything half-built or deliberately left broken.
4. If the work is complete, open the PR and merge on green. Then this section can say "nothing in
   flight".

The note travels on the branch and arrives in `main` with the PR, so a finished piece of work does
not leave a stale note behind.

---

## The two environments

|  | Local (Windows) | Cloud (Linux) |
|---|---|---|
| **Shell** | Git Bash and PowerShell. PowerShell blocks `npm.ps1`: use `npm.cmd` and `npx.cmd`. Quoting an apostrophe inside `bash -c` breaks; write the file with an editor tool instead. | A normal Linux shell: `npm` and `npx`. |
| **Line endings** | `core.autocrlf=true`, so working files are CRLF and the repository stores LF. Git prints "LF will be replaced by CRLF" warnings; they are harmless. | LF throughout. Do not add a `.gitattributes` without asking: it would renormalise every file. |
| **Docker and the policy suite** | **Blocked** by the antivirus. `supabase test db` cannot run here, so SQL policy tests run **only in CI**. Push, open the PR, read the CI log. | May be available. If `docker info` works, `supabase start` then `npm run test:policies` runs the suite before pushing. If it does not, CI is the check, as here. |
| **A browser on the running app** | The built-in preview works, and the maintainer signs in. | Probably unavailable. UI changes then rest on unit tests, `tsc`, the build and the class-survival check, and say so in the PR. Do not claim a screen was checked live when it was not. |
| **Credentials** | The maintainer's GitHub login and Supabase CLI login. | Needs its own `gh auth` for pull requests. Never paste a token into a file or a commit. |

### The environment file

`.env` is ignored and is never committed. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
are **public by design** (they ship in the bundle) and are stored as GitHub repository variables,
so a cloud session can read them: `gh variable list`, or `gh api repos/venkatesh-knr/family-finance-buddy/actions/variables/VITE_SUPABASE_URL`.
Copy `.env.example` and fill both in. **An `sb_secret_…` key must never appear anywhere**, in either
environment, in any file, log or message.

### What neither environment can do

Only the maintainer, and never a session on either side:

- **Apply a migration to the live project.** `supabase db push`, from the maintainer's linked CLI.
  A session writes the migration and its tests; the maintainer applies it. Apply it **before** the
  app that reads its columns is deployed.
- **Enter a password or an authenticator code.** Sign-in is the maintainer's.
- **Change repository settings** (branch protection, Pages, variables) unasked.
- **Remove anything from the live database**, including the second demo household.

---

## Working agreements

These are the maintainer's, recorded here so a cloud session that has never spoken to them follows
the same ones. If one looks wrong, ask; do not assume the list is current.

- **Merge on green.** When asked to open a PR and watch CI, merge it once the check
  `Typecheck, tests, policy suite, build` passes, with no approving review (the maintainer is the
  only committer, and GitHub will not let them approve their own PR). Then watch the Pages deploy on
  `main`. If CI is red, stop and say so; never merge it. Stated by the maintainer on 2026-09-25.
- **`main` is protected.** The CI check above is required and force pushes and deletion are blocked.
  Administrators can bypass; a session does not.
- **One concern per commit**, and the commit message says why. End every commit with the
  `Co-Authored-By:` trailer the tool gives you, and every PR body with its "Generated with" line.
- **Numeric work is tested first**, with hand-worked answers. **A policy comes with a test that it
  denies.** Both are in `CLAUDE.md`.
- **Say what was not verified.** A policy test that could not run locally, a screen not seen in a
  browser: the PR says so, and CI is the check.
- **`docs/design/conformance.md` moves with the code**, in the same commit. `npm run check:design`
  gates the deploy.
- **Show migrations and policies for review before building UI on them.**

---

## Facts a session cannot get from the code

- **The live demo household contains invented figures**, entered by hand while building: a
  Motilal holding of 100 units, a test purchase and sale on the SBI Bond, backdated readings on three
  funds, a gold bond and a USD ETF. Do not quote them as real, do not build expected answers from them.
- **A second demo household exists on live**, created by accident from the local-only fixture. Its
  login is banned and the fixture's password is public (it is in this repository). Filter any query
  over demo households by the owner, never by `kind = 'demo'` alone. Removing it is the
  maintainer's decision.
- **The local fixture** (`supabase/seed/`) belongs to the throwaway local stack. Never run
  `supabase db reset --linked`: it would apply the seeds to the live project.
- **Rates are never fetched.** Tax rules are dated rows added by a reviewed migration. A migration
  that changes the *structure* of the slabs must also end-date the rows it replaces;
  `supabase/tests/tax_rule_in_force.test.sql` fails if it does not.
- **Not yet decided by the maintainer:** what to do about the second demo household; whether to
  shorten Quick add on a phone; a scheduled Budget-day reminder (planned, deferred).

---

## Where the last session stopped

> Rewrite this at the end of every session, on the branch you were working on.

- **Environment:** local (Windows).
- **Branch:** `accrual`. Plan item 6 (property and the rest of the balance sheet), first piece: the fixed-deposit
  and bond accrual module, `src/domain/accrual.ts`, pure and tested first with hand-worked answers. No schema, no
  screen yet.
- **What the maintainer holds, which decides the shape of the rest of item 6:** property, fixed deposits, bonds,
  PPF, EPF, NPS and other. **Their deposits compound yearly**, not quarterly as the blueprint's example does, so
  compounding is a property of each deposit and never a default.
- **Convention the module states, to be checked against a real FD advice:** interest is credited at the end of
  each compounding period and rounded to the paisa then; a part-period at the end accrues simply on the balance,
  actual/365; a bond coupon accrues as face x coupon x days / 365 from the last coupon date. A bank's own maturity
  figure is the one that counts and may differ by a few rupees.
- **Next, in this order:** (1) show the maintainer the schema for deposits, bonds and property before building a
  screen on it: `instrument` already has `bond` and `deposit` kinds but no terms (rate, start, maturity,
  compounding, coupon frequency); `property` and `property_improvement` are specified in the blueprint's data model
  and not built. (2) A pure cost-basis function for property (purchase + stamp duty +
  registration + capital improvements, not repairs), tested first. (3) PPF, EPF and NPS: EPF is typed from the
  passbook, NPS is units x NAV, PPF is computed from the notified rate on the lowest balance of the month and needs
  its own fixtures. (4) The screens.
- **Merged and deployed this session:** the handoff (#46) and the app half of item 10 (#47). The maintainer has
  applied `20260925120000` and `20260926120000` to the live project.
- **Bank and card import** waits for redacted sample statements the maintainer is collecting, outside the
  repository: HDFC (delimited), ICICI credit card (PDF), ICICI savings (XLS or PDF).
