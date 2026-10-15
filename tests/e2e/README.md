# End-to-end tests

What the other suites cannot reach: whether a person can use the app.

| Suite | Proves | Does not prove |
|---|---|---|
| `npm run test:unit` | the arithmetic | that it reaches a screen |
| `npm run test:policies` | the policies deny | that the UI honours them |
| `npm run check:design` | the mechanical conformance | that anything works |
| **`npm run test:e2e`** | **the flows a person actually uses** | correctness of the figures |

## Setup

```
npm i -D @playwright/test otpauth dotenv
npx playwright install chromium
cp .env.e2e.example .env.e2e      # then fill it in
npm run test:e2e
```

Add to `package.json`:

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

## The household these tests run in

**Their own, marked demo, with the test account as its owner.** These specs write
expenses, deposits, bonds, a policy and readings, and almost none of that can be
deleted from the app: deletes are soft, readings and terms are append-only, a
policy has no delete grant and the audit trail is permanent. Run in the household
anybody uses, the rows showed up on Expenses, Insurance and Profile and moved the
budget figures. So the suite does not delete what it creates. It runs in a
household that is reset instead.

Once, as the project owner, run `supabase/bootstrap/e2e_household.sql` in the
SQL editor and put `E2E_HOUSEHOLD=E2E test household` in `.env.e2e`. Then:

- **setup** switches to that household and resets it to the seed
  (`reset_demo_household`, which only an owner with a second factor in the
  session can run, and only on a demo household);
- every spec names what it creates through `testName()` in `created.ts` (or the
  `E2E policy` constant), so one pattern finds it;
- **the teardown** resets the household again and then reads Expenses, Holdings
  and Insurance in every household the account belongs to. A test-created row
  still visible anywhere fails the run, which is the check that a reset, a
  spec or a new table did not leave something behind.

Without `E2E_HOUSEHOLD` the suite still runs, in whatever household the account
opens in, and warns that it cannot clean up.

The audit trail keeps the test household's history by design (it is append-only,
and a reset records each deletion). That is why the history belongs to a household
nobody looks at.

The setup step also asserts the DEMO badge is present and fails the whole run if
it is not, because test rows in a real household become part of the family's
arithmetic and the soft-delete rules mean they do not simply go away.

Three values in `.env.e2e`, which is gitignored and must stay that way:

- `E2E_EMAIL`, `E2E_PASSWORD` — the demo account's credentials
- `E2E_TOTP_SECRET` — the base32 secret from that account's authenticator
  enrolment. Capture it at enrolment time: the app shows it under "Or enter this
  by hand" on the sign-in screen's TOTP step, and it is not recoverable
  afterwards without re-enrolling.

MFA is mandatory for every member by design, so there is no password-only path
and the tests sign in the way a person does. The shortcut — minting a session
with the Supabase secret key — is ruled out by `CLAUDE.md`: that key must never
appear in the repo, the bundle, a log or a build output, and a test fixture is
all four eventually. The cost is one dependency and a few seconds; the benefit
is that every run proves the authentication path still works, which nothing else
in this project does.

## Why two viewports

`desktop` and `mobile` (375 × 812). Several defects found in the September
design review existed only at the narrow width — the privacy control wrapping
onto its own line was one of them. A phone width is a target here, not an
afterthought.

## Writing more of these

Reach for an end-to-end test when the thing you want to prove spans the
database, the repository layer and a screen, and a unit test would have to mock
two of the three. Do not reach for one to check a calculation — that belongs in
`src/domain` with fixtures, where it runs in milliseconds and tells you which
line is wrong.

Two conventions worth keeping:

**Assert on the markup, not on appearance, when the claim is about absence.**
The privacy spec checks `outerHTML` rather than visibility, because the promise
in `docs/tokens.md` §8 is that the figure is gone — a blurred or clipped figure
is still in the screenshot's source.

**Give every row a unique name, through `testName()`.** The household is reset
once per run and not between specs, so a fixed string collides with itself within
a run. The `e2e-` prefix is also what the teardown looks for.
