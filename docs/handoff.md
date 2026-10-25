# Handoff — working from the MSI or from the cloud

The work happens in **one place at a time**: the maintainer's Windows machine (the MSI), whether
at the keyboard or steered from the phone by Remote Control, or a cloud session. Never both at once,
and nothing is shared between the MSI and the cloud except what is in git. This file is what the next
session reads first, so whichever side it is, it starts from the same facts.

`docs/decisions.md` is the *why*: what was decided, by whom, and what it changed.
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

### Ending a session (either side, and a Remote Control session on the MSI is one)

```bash
npm run handoff -- --leaving      # the same as: node scripts/handoff-check.mjs --leaving
```

It exits non-zero while anything exists only on this machine. It never pushes or discards: it tells
you what to push. Then:

1. Commit everything. A work-in-progress commit is fine; a stranded edit is not.
2. `git push -u origin <branch>` for **every** branch with work on it, not only the one you are on.
3. **Rewrite "Where the last session stopped"** on that branch and push it. One short paragraph:
   the branch, what is done, what is next, anything half-built or deliberately left broken. Do this
   even if nothing else is planned: the MSI can become unreachable without warning, and nobody will be
   there to push what was left.
4. If the work is complete, open the PR and merge on green. Then this section can say "nothing in
   flight".

The note travels on the branch and arrives in `main` with the PR, so a finished piece of work does
not leave a stale note behind.

---

## Working remotely

When the maintainer is away from the MSI they keep working from the Claude mobile app, in one of two
ways, in this order:

- **MSI on and online → Remote Control.** The maintainer steers a session running on the MSI from the
  phone. It is the same machine, the same files, the same checkout and the same Supabase CLI login.
  There is **no hand-over**, and every local rule in this file and in `CLAUDE.md` applies as normal,
  including ending the session with `--leaving`.
- **MSI off, asleep for good, or out of reach → a cloud session**, under the remote rules below.
- **Never both at once.** If a Remote Control session is live on the MSI, no cloud session works on the
  same thing.

### The remote rules (for a cloud session)

A cloud session runs on a fresh clone of what is on GitHub and nothing else. The MSI may hold commits,
branches and edits that are not pushed, which the cloud session cannot see.

- **Good to take on:** self-contained work on a **new branch from `main`**: documentation, tests,
  domain logic (pure functions with their fixtures), review fixes, and small UI changes.
- **Wait for the MSI:**
  - anything that needs a migration applied to the live project before it can be used (only the
    maintainer applies migrations, and only from the MSI's linked CLI);
  - anything that can only be judged on the running app: a layout, a contrast, a flow. A cloud session
    probably has no signed-in browser. Say what was not seen in the PR, and leave it for the MSI.
- **Never:** continue a branch the MSI may have unpushed changes on. Start a new branch from `main`
  instead, name it for what it does, and let the MSI merge or rebase it later.
- **Before stopping:** end with a **"Done remotely — check on the MSI"** list, in the final message and in
  the PR body, so the maintainer can look at exactly what needs eyes or a command on the MSI:

  ```
  ### Done remotely — check on the MSI
  - Branch and PR: <name>, <link>, CI <green or red>
  - Not seen on the running app: <screens, or "none">
  - Needs a migration applied before it can be used: <filenames, or "none">
  - Left for the MSI: <anything started and not finished, or "nothing">
  ```

  Then run `npm run handoff -- --leaving`, push, and rewrite "Where the last session stopped".

---

## Before stepping away

On the MSI, before leaving it where a Remote Control or cloud session might be needed:

- [ ] The **Claude desktop app is left open**. Remote Control needs it running.
- [ ] In **Settings › Claude Code**: the **three Remote Control switches are on**, and **Finance_Buddy is
      pinned with Worktree off**, so a remote session works in the real checkout and not in a copy.
- [ ] The **MSI is plugged in** and will not sleep on its own.
- [ ] **Everything is pushed**: `npm run handoff -- --leaving` exits 0, and "Where the last session
      stopped" below is current and pushed.

---

## The two environments

|  | Local (the MSI, Windows; also a Remote Control session) | Cloud (Linux) |
|---|---|---|
| **Shell** | Git Bash and PowerShell. PowerShell blocks `npm.ps1`: use `npm.cmd` and `npx.cmd`. Quoting an apostrophe inside `bash -c` breaks; write the file with an editor tool instead. | A normal Linux shell: `npm` and `npx`. |
| **Line endings** | `core.autocrlf=true`, so working files are CRLF and the repository stores LF. Git prints "LF will be replaced by CRLF" warnings; they are harmless. | LF throughout. Do not add a `.gitattributes` without asking: it would renormalise every file. |
| **Docker and the policy suite** | **Blocked** by the antivirus. `supabase test db` cannot run here, so SQL policy tests run **only in CI**. Push, open the PR, read the CI log. | May be available. If `docker info` works, `supabase start` then `npm run test:policies` runs the suite before pushing. If it does not, CI is the check, as here. |
| **A browser on the running app** | The built-in preview works, and the maintainer signs in. Port 5173 on the MSI belongs to another project: run this one on 5199 (`npx vite --port 5199 --strictPort`) and set `E2E_BASE_URL=http://localhost:5199` for Playwright. | Probably unavailable. UI changes then rest on unit tests, `tsc`, the build and the class-survival check, and say so in the PR. Do not claim a screen was checked live when it was not. |
| **Credentials** | The maintainer's GitHub login and Supabase CLI login. | Needs its own `gh auth` for pull requests. Never paste a token into a file or a commit. |

### The environment file

`.env` is ignored and is never committed. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
are **public by design** (they ship in the bundle) and are stored as GitHub repository variables,
so a cloud session can read them: `gh variable list`, or `gh api repos/venkatesh-knr/family-finance-buddy/actions/variables/VITE_SUPABASE_URL`.
Copy `.env.example` and fill both in. **An `sb_secret_…` key must never appear anywhere**, in either
environment, in any file, log or message.

---

## Cloud environment

What a cloud session needs, set in the cloud environment's own settings (name, variables, network
access, setup script) and never in a file in this repository.

### Variables (names only; no value is written anywhere in the repo)

| Name | What it is | Needed for |
|---|---|---|
| `VITE_SUPABASE_URL` | The project's base URL. Public by design. | Running or building the app. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The `sb_publishable_…` key. Public by design. | Running or building the app. |
| `E2E_EMAIL` | The test account's email. | The Playwright suite. |
| `E2E_PASSWORD` | Its password. **A credential.** | The Playwright suite. |
| `E2E_TOTP_SECRET` | The base32 secret of its authenticator. **A credential.** | The Playwright suite. |
| `E2E_HOUSEHOLD` | The name of the household the suite runs in and resets. | The Playwright suite. |

Vite reads `VITE_*` from the process environment, and Playwright's config loads `.env.e2e` without
overriding what is already set, so no `.env` file needs to exist in the cloud.

The four `E2E_*` values are the **test account's** (it owns only the throwaway E2E household, which the
suite resets). They are optional: leave them out and a cloud session still runs `npm run test:unit`,
`npm run typecheck`, `npm run build` and the `check:*` scripts, and says the end-to-end suite was not run.
Never put the maintainer's own login, a Supabase `sb_secret_…` key or a GitHub token in any variable.

### Network access (Custom allowlist)

Allow exactly these hosts. The first two groups are the ones the work needs; the rest are what the setup
script itself reaches.

- **Supabase project host:** `<project-ref>.supabase.co`, where `<project-ref>` is the first label of the
  host in `VITE_SUPABASE_URL` (`gh variable get VITE_SUPABASE_URL`). REST, Auth and Realtime are all on
  this one host.
- **Playwright's Chromium downloads** (the hosts the pinned Playwright, 1.63, reads from its own source):
  `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`. Re-read them if `@playwright/test`
  is upgraded: `grep -o 'https://[a-z.]*\(playwright\|prss\)[a-z./]*' node_modules/playwright-core/lib/coreBundle.js | sort -u`.
- **The npm registry:** `registry.npmjs.org`, for `npm ci`.
- **Only if `--with-deps` is used and the image lacks Chromium's system libraries:** the Ubuntu package
  mirrors (`archive.ubuntu.com`, `security.ubuntu.com`).
- **GitHub** (`github.com`, `api.github.com`) is for `git` and `gh`; the environment's own GitHub
  connection normally covers it. Add them only if `gh` fails.

### Setup script

Paste into the environment's setup script field. It installs the locked dependencies and Chromium only,
creates no files, is safe to run twice, and prints how long it took. It has not been timed here: on the
first run, read the last line it prints, and if it is over five minutes, drop `--with-deps` or move the
install into the cached environment snapshot.

```bash
#!/bin/bash
set -euo pipefail
SECONDS=0

# From the repository root. A script that runs elsewhere would install into the wrong place.
[ -f package.json ] || { echo "setup: run from the repository root"; exit 1; }

# Locked versions, no audit or funding round trips.
npm ci --no-audit --no-fund

# Chromium only: the suite runs in Chromium at both widths. Bounded so a stalled download fails the setup
# instead of eating the session.
timeout 240 npx playwright install --with-deps chromium

echo "setup took ${SECONDS}s"
```

---

## What neither environment can do

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
  gates the deploy. A difference between a screen and its artboard is a `proposed` Departure, never a
  `decided` one: the call is the maintainer's.
- **Show migrations and policies for review before building UI on them.**
- **`tests/e2e/theme.spec.ts` is not edited and no threshold is relaxed.** If a check looks wrong, say
  so and stop. If a value the maintainer gave fails a measurement, use the value that passes and report
  both numbers.
- **A full test run is saved to a file and read from there**, never filtered as it streams. Write it
  outside `test-results/`: Playwright empties that folder when a run starts.
- **The end-to-end suite runs in its own household** (`E2E_HOUSEHOLD`), which it resets before and after.
  Without that variable it warns and writes to whatever household the account opens in.

---

## Facts a session cannot get from the code

- **The live demo household was reset to the seed** (mid-October 2026), so the invented figures that used to
  be in it (a Motilal holding, a test purchase and sale on the SBI Bond) are gone. It holds the seed in
  `app.seed_demo_household` and whatever has been entered since.
- **The E2E household exists on live**, owned by the test account, marked demo. The suite resets it
  through `reset_demo_household` and a teardown fails the run if a test-created row is still visible in
  any household the account belongs to. `supabase/bootstrap/e2e_household.sql` created it.
- **A second demo household exists on live**, created by accident from the local-only fixture. Its
  login is banned and the fixture's password is public (it is in this repository). Filter any query
  over demo households by the owner, never by `kind = 'demo'` alone. Removing it is the
  maintainer's decision.
- **The local fixture** (`supabase/seed/`) belongs to the throwaway local stack. Never run
  `supabase db reset --linked`: it would apply the seeds to the live project.
- **Rates are never fetched.** Tax rules are dated rows added by a reviewed migration. A migration
  that changes the *structure* of the slabs must also end-date the rows it replaces;
  `supabase/tests/tax_rule_in_force.test.sql` fails if it does not.
- **The canvas** (`docs/design/vibrant-canvas.html`) governs layout and hierarchy; `tokens.md` and
  `icons.md` govern values. Its index lists the artboards, and every screen row in
  `docs/design/conformance.md` names its artboard. A dated side-by-side of the first 37 differences is
  in `docs/reviews/2026-10-15-mock-vs-build/` (open `index.html`).
- **Not yet decided by the maintainer:** what to do about the second demo household; a scheduled
  Budget-day reminder (planned, deferred); the four marked "Your call" in the mock-vs-build review (see
  below); the six older `proposed` Departures.

---

## Where the last session stopped

> Rewrite this at the end of every session, on the branch you were working on.

- **Environment:** local (the MSI, Windows).
- **Merged and deployed:** everything through #101. Since #64: Close month for deposits (#65, #66); the
  palette, asset tiles, the vibrant-canvas UI pass and the FIRE read-out (#67–#73); the protection-and-flow
  design, the document-honesty checks (invariant IDs, reviewer authority, a pgTAP reader) and steps 2a
  earmarks and schemes and 2b protection (#74–#77); Departures carry a Status (#78); the Overview's four
  reversals (#79); the Holdings redesign (#80); the owner's answers on surrender value, the cover figure
  and step 6 (#81); the canvas rule, the Artboard column, the end-to-end suite in its own household and the
  seed that leaves a usable household (#82, #83); spec fixes (#84, #85); goals design and the departures
  mistake and its reversal (#86, #87); and the four screens rebuilt to their artboards: **Expenses
  (#88), More with the bar on the screens behind it (#89), Settings (#90), Profile (#92, #93), Tax (#94), Insurance (#96), Overview (#98), FIRE (#99), the holding screens (#100), the Holdings list (#101)**.
- **In flight:** nothing. The Holdings list was merged and deployed as #101, and the holding screens as #100 (each
  reviewed by the design-conformance agent). Every artboard is now built to, apart from Goals (step 9). The Quoted panel and Fetch price on a fund are not covered by any test, because no fund in the test
  household is linked to a price feed: try them once on a real linked fund.
  CI has failed transiently on `ghcr.io` answering `toomanyrequests` while the policy-suite job pulled Supabase's
  images (CI downloads them on every run and caches nothing), and once on `supabase/setup-cli` failing to resolve
  `latest` ("rate limit exceeded"). Both clear on a re-run. If they recur, consider pinning the CLI version and a
  retry around `supabase start` in `.github/workflows/deploy.yml` (shown to the maintainer first).
- **Migrations written but not yet applied to live: none.** Every file in `supabase/migrations/` is applied
  as far as this note knows: through `20261015120000_demo_seed_stated_balance.sql`, which the maintainer
  applied after #83. Two older ones are recorded here only by inference (the live FIRE screen reads their
  columns), so confirm once with `supabase migration list --linked` on the MSI:
  `20260929120000_fire_projection_inputs.sql` and `20260930120000_fire_return_defaults_to_nothing.sql`.
  The ones the maintainer confirmed applying: `20261011120000_earmarks_and_schemes.sql`,
  `20261012120000_protection.sql`, `20261013120000_premiums_end.sql`,
  `20261014120000_demo_seed_usable.sql`, `20261015120000_demo_seed_stated_balance.sql`.
- **Decisions the maintainer gave:** the mock-vs-build "Your call" items (23 October): **1** the emergency-fund
  line stays, as a card in the currency cards' style; **2** a ring per currency, each exactly the board's card;
  **7** FIRE's planning sections stay below the board's content as folded cards until Goals; **10** the Holdings
  filter is the board's one scrolling row with the earmark chips after the asset classes, past a hairline; a
  voided or archived private entry still counts as private (so the Profile
  count and its list include them, marked); the screens look like the mocks, with values from `tokens.md` and
  `icons.md`; a ULIP's (any policy's) surrender value is not liquid; the cover figure is said in years
  from two years; an owned home is not in the FIRE corpus; retirement is a kind (EPF, NPS and PPF, which
  means PPF moves out of the deposit schemes with a migration when step 6 builds it). In
  `docs/decisions.md` and `docs/build-plan.md`.
- **Open for the maintainer:** the six older `proposed` Departures (hero
  weight, allocation at large text, the Add picker, Fetch prices, refused returns amber against the grey
  ⓘ, Holdings list chrome); the other `proposed` rows in `docs/design/conformance.md`; bank statements for
  step 7 (below).
- **Queued, in this order:**
  1. The mock-vs-build review is finished: every screen has been rebuilt to its artboard, and what still differs is
     a `proposed` row in `conformance.md` for the maintainer to decide (the three figures called "Target" on FIRE,
     the brass primary button against the board's near-white one, and the states the boards do not draw). Also
     open: the build plan says "a scheme filter on Holdings" is built, and `Filter` has kind, earmark and currency
     and no scheme. Insurance follow-ups: `icons.md` section 4 and IC-R8 say the Stage 5 tiles
     are wired to nothing, and the insurance tile now is (`PROTECTION_TILE`), so those need the maintainer's
     wording; `theme.spec.ts` (the maintainer's file) does not list `insurance`, though axe finds nothing there in
     either theme; `insuranceFacts.healthByMember` is computed and no longer read, since Health is a flat list as
     the board draws it (`protection-and-flow.md` section 5 still says per member). Tax follow-ups: the
     explanatory sentences on Tax still write rule values as literals (₹12 lakh, ₹50 lakh, 4%, ₹1.25 lakh, 12.5%)
     where `tax_rule` is the source — read them from `ratesApplied` and the exemption and rate rows; and the
     Estimated tax figure reads ₹0 before anything is typed, which the maintainer may want worded as empty.
  2. Overview Departures still `proposed`: the Protection card, and Close the month drawn as an action.
  3. Follow-ups found on the way: month and year totals on Expenses add up the 50 most recent entries
     the screen reads (the figure now says so; the fix is period-scoped reads in the repository layer);
     the screens suite photographs More before its Tax line loads; `theme.spec.ts` does not cover More or
     Insurance (the maintainer's file); other screens may share the stale-read race fixed in the members
     list on Settings.
  4. **Step 6**: `property` and `property_improvement` with a pure cost-basis function (fixtures first,
     migration shown for review before any screen), then the retirement kind (PPF, EPF, NPS).
  5. **Step 5**: Reports and export first (the gate is a round trip).
  6. **6a Flow** waits for about eight decisions from the maintainer. **Goals** (step 9) is last of the
     computed steps; `docs/design/goals.md` is committed and its invariants are waived until then.
- **Bank and card import** waits for redacted sample statements the maintainer is collecting, outside the
  repository: HDFC (delimited), ICICI credit card (PDF), ICICI savings (XLS or PDF).
- **Tools:** `npm run test:e2e` (Playwright, needs `.env.e2e` and a saved session, both ignored) and
  `npm run test:screens` (screenshots into the ignored `screenshots/`). The design-conformance agent is in
  `.claude/agents/`; invoke it by naming the slice and the documents, never the conclusion. How often each
  runs is in `CLAUDE.md` (tests in tiers; the review for built or rebuilt screens and layout or figure changes,
  not for copy fixes).
