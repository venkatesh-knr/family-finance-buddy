# Commercial launch: sign-up, billing, data protection and support

<!-- invariant-prefix: CL -->

How Family Finance Buddy becomes a product that any family can subscribe to, on the
web first and later on Google Play and the App Store. **Proposed, 6 November 2026;
decided by nobody.** It reverses one line of `CLAUDE.md` ("No public sign-up"), so
nothing here is built until the owner decides §12. There is no artboard yet.

## 0. What does not change

The parts that make the app worth paying for stay exactly as they are:

- No bank or broker credentials, no screen-scraping, no reading of SMS,
  notifications or email.
- Statements are read and exports made on the device.
- Row-level security is the boundary, every household table is audited, and a second
  factor is required on every read and write.
- No superuser account and no developer backdoor (§7 is how support works without one).
- No third-party analytics or tag managers. No advice: calculations with their
  assumptions, never recommendations.

The schema is already multi-household: every table carries `household_id` and every
policy is scoped to the caller's households. Selling to many families is the same
database used by more of them.

## 1. What is sold

**One subscription per household**, not per person, whichever channel it was bought
through. A household's members share it.

| Plan | Includes |
|---|---|
| **Free** | One household, up to two members, manual entry of expenses and holdings, Overview, Goals |
| **Family** (paid, monthly or yearly) | Everything, and: more members, statement and eCAS import, the Tax screen, the handover binder, the monthly money meeting, Reports and upload |
| **Trial** | The Family plan for a fixed number of days at sign-up, no payment details asked |

Prices, the trial length and the member limit are the owner's (§12).

**Where a plan limit is enforced.** In the app, for features that run on the device
(an import, the Tax screen): someone who edits the bundle can get round it, and that
is accepted, because the data is their own and nothing of ours is spent. In a
security-definer function, for anything that costs us or touches other people (adding
a member: the invite function checks the plan). **Never in a row-level policy:**
`CLAUDE.md` keeps policies to access, not business rules.

**A limit never takes data away.** Going from Family to Free, or lapsing, stops new
work; it never hides, locks or deletes what is already there (§4).

## 2. Sign-up

Public sign-up replaces "accounts are created only by accepting an invite" for the
**first** person in a household. Everyone else still joins by invitation.

1. Email and password, the email verified.
2. **The authenticator app is enrolled before anything else.** Nothing of the
   household is readable until it is, so the second-factor policy holds from the
   first minute.
3. A new household is created with that person as owner. It starts empty, with an
   offer to load a **sample household** of its own (the demo seed, marked demo,
   resettable), so a trial has something to look at.
4. The privacy notice and consent (§6) are shown and recorded before step 3.

Abuse: Supabase Auth's rate limits, and a captcha on sign-up only if abuse appears
(it adds a third-party script, which is the owner's call).

## 3. Billing

**Nobody's card, bank account or UPI ID touches this app or its database.** Payment
happens on the provider's hosted page or the store's own sheet.

| Channel | Provider | How a renewal is paid |
|---|---|---|
| Web | Razorpay Subscriptions (hosted checkout) | UPI AutoPay or a card mandate. Under the RBI's rules the customer authenticates once, renewals up to ₹15,000 then go through without an OTP, and a notice comes before each debit |
| Google Play | Play Billing, or user choice billing | The store's subscription |
| App Store | StoreKit | The store's subscription |

**`subscription`**, one row per household: `plan`, `status` (`trialing`, `active`,
`past_due`, `cancelled`, `expired`), `channel` (`web`, `play`, `app_store`), the
provider's subscription id (not a payment detail), `current_period_end`,
`updated_at`. Clients have `select` only, for their own household.

**The only writer is an Edge Function, `billing-webhook`,** which verifies each
notification's signature (Razorpay's webhook secret; Google's and Apple's server
notifications) before it writes. Its secrets live only in the function's settings,
never in the repository, the bundle, the build output or an Actions secret, the
same rule `CLAUDE.md` holds for the `sb_secret_` key; `check-no-secret-key.sh` greps
for the provider's secret prefix as well.

A household pays through one channel at a time. Switching channel is cancelling on one
and subscribing on the other; the app says which channel the current plan came from
and links to where it is managed.

**Invoices with GST** come from the payment provider (Razorpay can issue them) once
the business is GST-registered; store purchases are invoiced by the store.

## 4. Lapse, cancellation and downgrade

| State | What the household can do |
|---|---|
| `active`, `trialing` | Everything in the plan |
| `past_due` (payment failed) | Everything, for a grace period of 7 days, with a banner |
| `cancelled` (until period end), then `expired` | **Read everything, export everything, delete the account.** No new entries, no imports |

Expired data is kept for a retention period (owner's decision; 12 months proposed),
with emails 30 and 7 days before it is deleted. Re-subscribing within it restores
everything as it was.

## 5. Deleting an account or a household

Both stores require that an app with accounts lets people delete them from inside
the app; DPDP gives the same right.

- **A member leaves:** their login is deleted. Their shared entries stay with the
  household (they are the household's record); their **private** entries are
  deleted, after a warning that says how many.
- **The owner deletes the household:** every row in every table with that
  `household_id` is deleted, the audit log included, after a fresh authenticator code
  and typing the household's name. This is a **third hard delete**, beside
  `reset_demo_household` and `reverse_template_batch`, and needs the same decision
  from the maintainer. The screen says how long Supabase's backups keep a copy.
- Export is offered first, every time.

## 6. Data protection (DPDP Act and Rules)

The Rules were notified on 13 November 2025, and the main obligations apply from about
**May 2027**. Built in from the start rather than retrofitted:

- **Notice and consent** at sign-up, in plain language, one purpose per consent:
  running the household's records; billing; service emails. Withdrawing consent is as
  easy as giving it, from Profile. English first; the Act lets a person ask for any
  Eighth Schedule language, so Hindi is the next one.
- **Children.** A household's members include children, and processing a child's
  data needs **verifiable consent from a parent**. A child member can be created only
  by a signed-in adult account in that household, who records the consent at creation
  (who, when, for which child). What counts as "verifiable" under Rule 10 is a check
  for a lawyer before launch.
- **Security safeguards:** what §0 already holds (encryption in transit and at rest
  at Supabase, RLS, the second factor, audit), written down as a security note the
  privacy notice can point to.
- **Breach notification** to the Data Protection Board and to affected households,
  with a written runbook: who decides, who is told, in what order. The deadlines in
  Rule 7 are to be confirmed by the lawyer and copied into the runbook.
- **Rights:** see and export (Reports), correct (every record is editable), erase
  (§5), and a grievance contact named in the app with a response time.
- **Processors** named in the privacy notice: Supabase (Mumbai), the payment provider,
  the email sender. GitHub Pages serves only the app's files and holds no personal data.

## 7. Support without access

There is no standing access to any household's data for anyone outside it, the
maintainer included.

- **Diagnostics, by default.** "Send a report" builds a file on the device (app
  version, browser, the failing screen, counts of rows per table, error messages), shows
  it to the person, and sends it only when they tap Send. **No amounts, names, payees or
  notes** are in it.
- **"Let support see my data", only when the owner turns it on.** A row in
  `support_grant` (household, granted by, expires at, at most 24 hours) lets a
  `support` role read that household through ordinary RLS policies keyed on an
  unexpired grant. Read-only, never write. Every read is audited and listed on the
  household's Profile. The owner can end it early.
- The support login holds no grant of its own and has the second factor like everyone.

## 8. Running it

- **Supabase Pro** (about $25 a month; check current pricing): the free plan pauses a
  project after a week without use, which a paying customer cannot be given. Daily
  backups, and a **restore drill once a month** into a scratch project, recorded in
  `docs/handoff.md`.
- Transactional email (verification, invitations, lapse notices) through Supabase
  Auth's SMTP setting and one provider.
- A public status page and an incident note template.
- Costs, revenue and the break-even number of households in one short table in
  `docs/decisions.md`, revisited each quarter.

## 9. Channels, in order

1. **Web**, installable as today. Pages the payment provider requires: terms,
   privacy, cancellation and refund policy, contact. A **paid beta** with a few
   families first.
2. **Google Play**: the same app in an Android wrapper (a Trusted Web Activity, or the
   Capacitor shell of stage 6). The Data safety form, the financial features
   declaration, and the account-deletion link. Play fees are 15% on subscriptions; the
   Competition Commission's case on Google's billing is still open, so check the terms
   at listing time.
3. **App Store**: Capacitor, StoreKit, the privacy label, an organisation developer
   account. Apple's Small Business Program charges 15%. Apple limits directing iPhone
   users to pay on the web, so the iPhone app sells through StoreKit.

## 10. The advice line

Charging money raises the stakes on the line the app already keeps. Giving investment
advice for a fee needs SEBI registration as an investment adviser; this app is not one.

- Every figure that looks forward (cover gap, FIRE, "needs ₹X a month") stays a stated
  calculation with its assumptions on the screen (PF-C12, GL-I6).
- No screen names a product to buy or sell.
- **The app earns nothing from what a household buys**: no commissions, no affiliate
  links, no advertising. That is the selling point against free apps that earn from
  selling investments, and it keeps the app on the right side of the advice line.

## 11. Before charging anyone

- A business entity (to hold the Razorpay account, the store developer accounts and
  the GST registration).
- Terms of service and a privacy notice reviewed by a lawyer; GST and invoicing
  reviewed by a CA.
- §2 to §7 built and their invariants tested.
- One full restore from backup, done and timed.

## 12. Decisions owed to the owner

1. **Public sign-up for the first person in a household** (§2), and the matching edit
   to `CLAUDE.md`'s "Out of scope".
2. **Plans and prices**: what is free, what is paid, the member limit, the trial length,
   monthly and yearly prices.
3. **The household hard delete** (§5) as a third exception, and what happens to a
   leaving member's private entries.
4. **The retention period** after a subscription expires (§4).
5. **Support access** (§7): the two levels and the 24-hour cap.
6. **The no-commission, no-ads line** (§10) as a standing rule.
7. **The business entity** and when the paid beta starts.

## Invariants

**CL-I1 — Subscription status is written only by the billing function after it verifies the provider's signature;** no client can insert or update it. (§3)

**CL-I2 — A lapsed, cancelled or downgraded household can always read its data, export everything and delete its account;** only new work stops. (§1, §4)

**CL-I3 — No card number, bank account or UPI ID is ever stored or seen by the app;** payment happens on the provider's page or the store's sheet. (§3)

**CL-I4 — Nobody outside a household has standing access to its data:** support reads it only through an unexpired grant from the owner, read-only, and every such read is audited and shown to the household. (§7)

**CL-I5 — A plan limit is never enforced by a row-level policy,** and never hides or deletes existing data. (§1)

**CL-I6 — A child member is created only by a signed-in adult of that household, with the parent's consent recorded at creation.** (§6)

**CL-I7 — Payment and store secrets live only in Edge Function settings,** never in the repository, the bundle, the build output or an Actions secret. (§3)

**CL-I8 — Deleting a household removes every row carrying its `household_id`,** the audit log included, and the screen states how long backups keep a copy. (§5)

**CL-I9 — No household's figures are readable until its first member has enrolled the second factor.** (§2)

**CL-I10 — A diagnostics report contains no amounts, names, payees or notes,** and is sent only after the person has seen it. (§7)

## Tests

- CL-I1: an authenticated client's insert or update on `subscription` is refused for
  every role (pgTAP); the function refuses a notification with a bad signature.
- CL-I2: an `expired` household reads every screen, runs Export everything and deletes
  its account; adding an expense is refused with the reason.
- CL-I3: no column in the schema is named or shaped like a card number, account number
  or UPI address (a schema check).
- CL-I4: the `support` role reads nothing without a grant, reads one household with an
  unexpired grant, nothing after expiry, and cannot write; each read appears in that
  household's audit log (pgTAP).
- CL-I5: no policy definition mentions `subscription` or a plan; downgrading a
  household with five members leaves all five readable.
- CL-I6: inserting a child member without a consent record is refused.
- CL-I7: `check-no-secret-key.sh` fails on the provider's secret prefix in the build
  output.
- CL-I8: after deleting a household, a count across every table with a `household_id`
  returns zero for it.
- CL-I9: a new account without an enrolled factor reads nothing from its own new
  household.
- CL-I10: the diagnostics builder's output for the demo household contains none of its
  amounts, member names or payees.
