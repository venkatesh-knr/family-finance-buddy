# Where household data lives — options considered

**Status: recorded for reference. No change to the design.** Decided 15 October
2026: the app keeps one central database with row-level security. Every
alternative below either breaks existing behaviour or adds complexity the
project does not need yet. This file exists so the next time the question
comes up, the work does not have to be redone.

This is a reference, not a specification. It carries no invariant IDs and
should sit in the subagent brief's exclusions block, not its authority list.

## The question

People are wary of a central database holding their finances. Could the data
stay on their own device, or in a database they own, while the app stays
centrally controlled?

## What "encrypted" means today

Data is encrypted in transit (TLS) and at rest (by the database provider). That
protects against a stolen disk or a snooped connection. It does **not** protect
against the provider, a leaked service key, or a wrongly written access policy.
The concern is therefore real, not only a perception, and privacy copy must
never say "encrypted" without saying against what.

What already limits exposure: statements are parsed on the device and never
uploaded; policy numbers keep their last four characters only; nominees are not
stored; no bank or broker credentials, ever; no analytics; data in the Mumbai
region; a policy test suite that gates every deploy.

## Options

### 1. Device only

All data in a database on the phone or laptop; nothing leaves it.

- **Gives:** the strongest possible claim — nobody else holds anything.
- **Breaks:** family members on their own phones; one person on two devices;
  recovery from a lost device (the household's own backup file is the only
  copy). Server jobs become device jobs: the monthly snapshot runs when the app
  opens, renewal reminders become device notifications.
- **Cannot be the web build.** Browsers evict site storage (Safari after seven
  days of non-use for a site not added to the home screen; "clear site data"
  anywhere). Only the native shells could hold the system of record, and they do
  not exist yet.
- **Multi-member view:** none, beyond a manually shared, read-only, stale
  snapshot file.
- **Verdict:** contradicts the app's premise — a household, not one person.
  Same verdict as blueprint §19.

### 2. End-to-end encrypted sync

Data syncs through the server, but is encrypted on the device first; the server
stores only ciphertext.

- **Gives:** "we cannot read your data" becomes literally true, while family
  members and multiple devices keep working.
- **Breaks:** anything the server computes on readable data. Private entries
  (`personal_holding_totals` sums rows the caller cannot see) would become totals
  each member's device publishes, encrypted for the household — stale until that
  member opens the app. Roles become separate keys per visibility tier. Read
  auditing sees downloads, not what was looked at. RLS and pgTAP shrink to "who
  may fetch which ciphertext".
- **The real cost is key recovery.** Lose the key and the data is unrecoverable
  by design. The recovery path must be designed and tested before anything else.
- **Web delivery caveat.** A web app is re-downloaded on every visit, so
  in-browser encryption is only as trustworthy as the deploy pipeline. Signed
  native builds are stronger.
- **A correction to blueprint §19.** It rejected this mainly because the
  scheduled snapshot, and with it the year's peak value for foreign-asset
  disclosure, needs readable data. That argument has weakened: units over time
  come from the lots, and historical NAV, share-price and exchange-rate series are
  public, so the device can rebuild a daily value series when it next opens — a
  better peak than one monthly sample. (A holding imported from a partial
  statement cannot be rebuilt either way.) Key recovery remains the binding
  cost.
- **Verdict:** possible, large, not now.

### 3. A Supabase project per household, in the household's own account

Supabase lets an approved app create projects in a user's organisation through
its OAuth integration.

- **Fails "no technical setup":** every household needs its own Supabase
  account.
- **Fails "free and reliable":** free projects pause after one week of
  inactivity and must be restored from the Supabase dashboard — a family back
  from a holiday finds the app down, with a fix only a developer understands.
- **Unmaintainable:** running migrations needs full database access, which the
  OAuth route does not give; each household would have to hand over its database
  password, and every release would migrate many databases nobody on the project
  controls.
- **Verdict:** rejected.

### 4. A database per household, in the owner's account

Separate projects or databases (Supabase, Turso, Neon) under the app owner.

- **Gives:** isolation between households.
- **Does not give:** the trust being sought — the owner still holds and can
  read everything. Adds cost per household.
- **Verdict:** rejected; it solves a problem the project does not have.

### 5. The household's own Google Drive

The app keeps a SQLite database on the device and syncs it, as files, to the
household's Drive.

- **Meets all three conditions:** no setup ("Continue with Google"), no cost
  (the household's own free storage; the data is a few MB), and the owner cannot
  see it — the access token stays on the device, and there is no server of the
  owner's for it to pass through. The two narrow scopes needed (`drive.appdata`,
  `drive.file`) are classed by Google as non-sensitive and need only basic app
  verification, not the paid security assessment that full Drive access requires.
- **Breaks:** Postgres, RLS and pgTAP no longer protect household data. Roles
  become screen-level only — whoever a file is shared with can read all of it —
  unless each tier has its own key. Private entries need a file per member plus
  encryption, which brings back key recovery. Concurrent edits by two members
  conflict; a per-member change log merged on the device is the hardest part.
- **Survives:** price fetch, tax engine, statement parsing, FIRE, privacy mode.
  The repository-layer rule ("no provider types past the repository") is what
  would make the storage swap feasible.
- **Verdict:** the only option that meets the brief, but a re-architecture.
  If ever pursued, prototype for single-member households first — no sharing,
  no conflicts, no roles — to prove the storage swap and the support model before
  touching multi-member sync.

## Supporting a household whose data the owner cannot see

Recorded in case option 2 or 5 is ever built.

- **A diagnostic report the user chooses to send**, built on the device and
  shown in full before sending: versions, error messages, record counts. No
  amounts, no names — asserted by a test. User-initiated, so it does not break
  the no-analytics invariant.
- **Reproduce on synthetic data** from a "shape export": how many holdings of
  each kind, which statement format, which screen failed.
- **Time-limited access with consent**, last resort: the user exports an
  encrypted copy and sends the key separately; the owner deletes it afterwards.
- **Migrations ship inside the app**: run on first open after an update, keep a
  pre-migration copy, roll back on failure, refuse to open a database newer than
  the app.
- **The central control plane holds only** account, household id, subscription
  status and app version — never amounts or holding names. Entitlement is checked
  at launch with an offline grace period.

## What would reopen this

- Opening the app to households beyond the family.
- Real demand from single-person households for device-only.
- The native shells existing, which removes the browser-storage objection.

## Sources, as checked on 15 October 2026

Free tiers and API terms change; re-check before relying on these.

- Supabase free tier — 2 free projects per organisation, pause after one week
  of inactivity: https://automationatlas.io/answers/supabase-free-tier-limits-2026/
- Supabase OAuth integration — creates projects on a user's behalf; full database
  access needs the user's database password:
  https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration
- Google Drive scopes — `drive.appdata` and `drive.file` non-sensitive; `drive`
  restricted, with a security assessment for server-side storage:
  https://developers.google.com/workspace/drive/api/guides/api-specific-auth
