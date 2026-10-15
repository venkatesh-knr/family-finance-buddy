# Trust and security — enhancements within the current design

A catalogue of what can raise a household's confidence **without changing the
architecture** (one central database, row-level security, no server of our own;
see `data-residency.md` for the alternatives considered and set aside).

This is a backlog, not a specification. Nothing here is scheduled. An item
becomes a specification — with invariant IDs — when it is planned into
`docs/build-plan.md`. It belongs in the subagent brief's exclusions block.

The principle comes from blueprint §20: **reduce how much trust is required,
rather than make more promises.** Every claim is something a person must take on
faith; every structural choice is something they can check.

Status as found in the repository on 15 October 2026: **in place**, **partial**,
or **not yet**.

## Already in place — worth showing, not just having

| What | Where |
|---|---|
| Statements parsed on the device, never uploaded | `src/lib/ecas-pdf.ts` |
| Policy numbers kept as last four characters; nominees not stored | `20261012120000_protection.sql` |
| No bank or broker credentials, ever | `CLAUDE.md`, blueprint §15 |
| No analytics of any kind | invariant, blueprint §19 |
| Row-level security on household data, a pgTAP suite that gates deploy | `supabase/tests`, `deploy.yml` |
| The secret key never in the build output | `scripts/check-no-secret-key.sh`, run on `dist` |
| Two-step sign-in (TOTP) | `src/repo/auth.ts`; policies reference `aal2` |
| Privacy mode removes amounts from the page, not just hides them | `privacy-mode.spec.ts`, which also reads every input since finding 22 |
| `detail_level` is never an access control | `CLAUDE.md` |

## Found while checking — gaps in the current setup

These are not enhancements; they are holes. **The first is a real risk, not a
perception issue.**

1. **No database backups.** Only `deploy.yml` exists; the nightly encrypted
   backup workflow in blueprint §15 was never built, and the free tier includes
   no backups. Today the live database is the only copy of the household's
   history.
2. **No Content-Security-Policy.** Nothing limits which hosts the page may load
   code from or send data to.
3. **Fonts load from Google at runtime.** Every launch makes a request to a third
   party, revealing the visitor's IP address, which quietly contradicts "nothing
   phones home on launch".
4. **No `SECURITY.md`** with a disclosure address.
5. **No dependency update or vulnerability alerts** (no Dependabot
   configuration).

## Enhancements

### Quick wins — hours each, highly visible

- **Self-host the three font families.** No third-party request when the app
  opens.
- **A Content-Security-Policy as a `<meta>` tag.** GitHub Pages cannot send
  headers, but a meta CSP covers `script-src`, `connect-src` and `img-src`:
  `'self'`, the Supabase project, and the price sources — nothing else. Two
  directives are header-only (`frame-ancestors`, reporting), so add a small
  frame-busting guard. Then publish the allow-list in the app: "this app can talk
  to exactly these addresses". A test asserts the CSP's contents.
- **`SECURITY.md`** with a disclosure address.
- **Dependabot, plus GitHub's secret scanning and push protection.** Free on a
  public repository.
- **Show the build.** The commit hash and build date in Settings, linking to that
  exact commit, so anyone can match the running app to its source. Optionally,
  GitHub artifact attestations for the deployed bundle.

### Protecting the account

- **Require two-step sign-in for an owner and a partner**, and offer recovery
  codes (blueprint layer 10). Passkeys where the auth provider supports them.
- **Ask again before sensitive actions**: export, deletion, a role change, an
  invite.
- **List active sessions**, with "sign out everywhere".
- **Tell people about a new sign-in**, by email, with no figures in it.
- **An idle timeout.** In the native shells: a biometric app lock, and app
  content hidden in the task switcher.

### Protecting the data

- **Backups** (gap 1): the nightly encrypted dump to storage the owner controls,
  and a restore rehearsed at least once. Highest priority on this page.
- **Encrypt on the device what is never computed on** (blueprint §20): notes,
  payee names, uploaded documents. A household key wrapped per member. Design
  and test the recovery path first; encryption without recovery destroys more
  data than it protects.
- **Private entries across every table the blueprint lists.** Partial today;
  confirm coverage as income and documents land.
- **Retention**: a purge, per import batch, of whatever unmapped remainder an
  import keeps (`detail-level.md` §4), and a deletion receipt saying what was
  removed.
- **Never a figure in a notification or an email.** "Your premium is due", not
  the amount. A test, once reminders exist.

### Hardening the backend — as tests, not care

- **Schema-wide pgTAP assertions**: every table in `public` has row-level
  security enabled and at least one policy; every `security definer` function
  sets `search_path` and is not executable by `anon`; aggregate functions return
  sums, never rows. A new table without a policy then fails the deploy instead of
  relying on someone remembering.
- **Rotate the service key on a schedule**, and give CI jobs a scoped database
  role, never the full key (`architecture-runtime.md`).
- **Auth configuration**: unused providers off, email confirmation on, rate
  limits set — checked into the repo as configuration, not clicked in a
  dashboard.

### Showing, not telling (blueprint §20)

- **A "Where your data is" screen**: region, what is stored, what never leaves
  the device, what runs on a schedule and when it last ran, the CSP allow-list,
  each linked to the file that makes it true.
- **A visible audit log**, including reads by the owner (Stage 5 step 9). If a
  member can see that her entry was viewed, the conversation is "check for
  yourself", not "trust me".
- **Publish what the tests proved**: the number of access-policy assertions that
  ran and passed, in each release's notes.
- **A plain threat model**: what the design protects against and what it does
  not (the provider can read data at rest; a compromised device can read
  anything shown on it). Saying what is *not* covered is what makes the rest
  credible.
- **An invite screen someone can consent to**: what the inviter will see, what
  the new member can keep private, what their role allows. A role change notifies
  the affected member.
- **Export offered during setup**, before any real figure is entered, and a
  self-hosting guide.

### Before opening beyond the family

- A paid plan with point-in-time recovery; monitoring and alerts; a penetration
  test; an incident-response plan.
- Check obligations under India's Digital Personal Data Protection Act — notice,
  consent and breach notification — before any household outside the family
  signs up.

## Suggested order, if and when scheduled

1. Backups — the only item here that prevents a loss rather than a doubt.
2. Quick wins: fonts, CSP, `SECURITY.md`, Dependabot and scanning, build hash.
3. Schema-wide policy assertions.
4. Asking again before sensitive actions; the sessions list.
5. "Where your data is" and export during setup.
6. Device-side encryption of never-computed fields, recovery first.
7. The visible audit log with reads.
