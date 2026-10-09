# UI review — 24 September 2026

Ten findings from walking the running app, ranked by how much each one costs the
screen it sits on. Every one of them is fixable inside the tokens the project
already has; none of them needs a design tool.

**How this was taken.** `npm run dev` on `localhost:5173`, demo household,
signed in, dark theme. Overview, Holdings, Tax and Expenses, each at the pane's
own width and again at 375 × 812. Screens not yet built were not looked at.

**Standing.** Observations about the built app, not a change to the
specification. Where a finding contradicts `docs/blueprint.md`, the blueprint
wins and the finding is wrong — say so here rather than acting on it. Where it
contradicts `docs/design/conformance.md`, check whether the departure is still
deliberate; two of these are cases where a recorded decision did not survive
into the code.

**What this review is not asking for.** No Figma. No component library. No new
palette, typeface or token. The design system is not the problem — the
application of it on four screens is. Anything below that would be better solved
by changing a token, say so and change the token instead.

---

## Summary

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | Three hero figures compete; net worth loses | high | `features/overview/OverviewScreen.tsx` |
| 2 | The caveat marker reads as a loss | high | `ui/primitives.tsx` — `Caveat` |
| 3 | `not shown` printed where a figure goes | high | `features/overview`, `features/holdings` |
| 4 | No chart anywhere in the app | high | Overview — outstanding from stage 4 |
| 5 | Everything is a card, and every card is identical | medium | `features/holdings/HoldingsScreen.tsx` |
| 6 | Explanatory prose came back | medium | Overview, Expenses |
| 7 | "Needs attention" is a wall of alarm | medium | `features/overview` |
| 8 | Monospace has spread past numerals | medium | `styles/base.css`, Tax |
| 9 | Privacy control wraps at 375px | low | `features/overview` |
| 10 | `max-w-app` caps every screen at 880px | low | `tailwind.config.js` |
| 11 | Three type rules in `tokens.md` §3 are too broad | high | `docs/tokens.md`, then everywhere |
| 12 | A labelled input is named by its placeholder | medium | `ui/primitives.tsx` — `Field`, `PasswordField`; 30 raw wrappers in screens |
| 13 | The TOTP QR code does not render | high | `repo/auth.ts`, `features/auth/SignInScreen.tsx` |
| 14 | Every MFA failure is reported as an expired code | high | `repo/auth.ts` — `verifyTotpCode` |
| 15 | Three households all named "Demo household" | medium | `repo/*` membership lookups (not live data, as first thought) |
| 16 | A trend chart drawn from a single reading | medium | `features/overview/AssetsOverTime.tsx` |
| 17 | Two headline figures differ by ₹12 lakh, unexplained | medium | `features/overview` |
| 18 | Profile calls the same pause by a different name | low | `features/profile/ProfileScreen.tsx` |
| 19 | FIRE has no projection — the mockup proposes one | note | `features/plan`, not a defect |
| 20 | The activity log mixes friendly names with table names | low | `features/profile`, audit labels |
| 21 | 200% text size is a requirement and nothing verifies it | medium | cross-cutting, `CLAUDE.md` |
| 22 | The privacy spec failed once and the cause is not known | **open** | `tests/e2e/privacy-mode.spec.ts` |

---

## 1. Three hero figures compete, and net worth loses

**What you see.** The Assets card carries ₹5.3 L and $41.8K, both at hero scale.
Net worth — ₹54.85 L — sits in the card *below* them, at the same size. The most
important number in the application is third in reading order and no larger than
its neighbours.

**Why it is wrong.** `docs/tokens.md` gives the hero figure its own step in the
scale, `clamp(32px, 6vw, 48px)`, and nothing else in the scale comes near it.
That step only works if one figure per screen uses it. Three of them means none
of them is the headline, and a person opening the app has to read all three to
find out how they are doing.

`conformance.md` records the reason Assets sits first: the refusal underneath it,
and leading with what is known. That reasoning is sound and should survive. What
should change is the weight, not the order of the arithmetic.

**What to do.** Net worth first, alone, at hero scale. Assets per currency
beneath it as stat tiles at the stat step (17px mono), keeping the per-currency
refusal exactly as it works now. One hero figure per screen, everywhere.

## 2. The caveat marker reads as a loss

**What you see.** A coral ▲ inside a circle, beside ₹5.3 L, beside ₹1,25,000,
beside ₹18,000 on Tax. On Overview's Allocation card it is worse: Mutual funds
carries that red triangle in the same column, at the same size, where Bonds
carries `▲ 7.5%` and ETF carries `▲ 22.9%` in teal. Mutual funds reads as the
one position that is down. It is not — it is the one that is incompletely
valued.

**Why it is wrong.** `docs/tokens.md` §2 assigns coral to loss, overspend and
due, and teal to gain, and says every one of them carries a sign or arrow as
well as a hue. The caveat marker borrows both signals — the hue and the arrow —
for a meaning that is neither. This is the colour-alone rule failing in the
other direction: the shape and the colour agree with each other and both say
something false.

**What to do.** Give `Caveat` a neutral marker: the ⓘ glyph already used at card
level, in `--muted`, never in coral and never a triangle. Coral and teal stay
reserved for direction of money. If a caveat is severe enough to need warning
colour, `--brass` is the token for attention and is not already spoken for.

## 3. `not shown` printed where a figure goes

**What you see.** Unrealised gain renders the literal words `not shown`, in
mono, with a caveat marker beside it — on Overview and again on Holdings.

**Why it is wrong.** It reads as a failed render rather than a decision. The app
is otherwise careful about refusing honestly; this is the one place where the
refusal looks like a defect.

**What to do.** An em-dash at the figure's own size and weight, with the caveat
marker carrying the explanation. The dash says "deliberately absent" in a way a
sentence fragment in a number's slot does not.

## 4. There is no chart anywhere in the app

**What you see.** Four screens, no chart. Allocation carries its class colour on
an 8px dot; the seven-colour ramp in `docs/tokens.md` §6 is otherwise unused.

**Why it matters.** This is the largest single contributor to the app feeling
flat, and it is not a design problem — it is three unbuilt items from stage 4
(the donut, the since-inception chart, member attribution), listed as
outstanding in `docs/build-plan.md` §00.

The departure replacing the donut with a row per class stands: a row shows four
facts where an arc shows one, and on a phone that is the difference between a
picture and an answer. But `conformance.md` says the colours stay the chart
palette in order "so a class keeps its identity when the donut arrives beside
it" — and it has not arrived. The since-inception line is specified in
`tokens.md` §6 down to the 2.2px stroke, the 14% area fill and the endpoint dot.

**What to do.** Build the since-inception chart first — a single well-made line
changes a screen's character more than restyling everything around it. Then the
donut beside the allocation rows, not instead of them. Both read `--c1…--c7` in
order, never literals.

## 5. Everything is a card, and every card is identical

**What you see.** Holdings opens with "Add a holding" and "Import a statement" —
two collapsed cards with the same border, radius, padding and shadow as the
Portfolio card beneath them. At 375px they consume the entire first screen; no
holding is visible until you scroll.

**Why it is wrong.** `docs/tokens.md` §4, verbatim: *"Not everything is a card.
Border, fill, radius and shadow each say 'separate object'. Spend them by role.
One radius and one shadow stamped on every block flattens the hierarchy and
makes nothing important."* Two actions currently outrank the data they act on.

**What to do.** Demote both to a single row of controls above the portfolio — a
button and a link, or one disclosure holding both. The data is what the screen is
for; the actions are how you add to it.

## 6. Explanatory prose came back

**What you see.** The Net worth card is one figure and four lines of prose
explaining what net worth is — six lines at 375px, where the paragraph is
visibly larger than the number it describes. Expenses opens with the quick-add
form and closes with two more paragraphs, one on private entries and one on IST
dates and paise.

**Why it is wrong.** `conformance.md` already decided this: *"Fifteen coloured
paragraphs on one screen are read as decoration, and the one that mattered goes
down with the rest. A sentence that explains what a block IS is said once, on its
heading; a sentence that warns a figure is WRONG rides on that figure."* The
decision is right and the code did not follow it.

**What to do.** The net-worth paragraph is a definition — it belongs on the
heading, or behind the caveat marker, not in the card body. The two on Expenses
are onboarding: say them once to a household with no transactions, then stop.

## 7. "Needs attention" is a wall of alarm

**What you see.** Overview ends with three stacked full-width tinted panels —
coral, brass, coral — each carrying a paragraph. On a demo household with
nothing actually wrong, the screen closes on what looks like an incident report.

**Why it is wrong.** Three panels at equal weight means no triage. Everything is
flagged, so nothing is urgent, and the one that might matter — the two months
with no reading, which cannot be reconstructed later — is buried among peers.

**What to do.** One line per item: the count, the consequence in a clause, and a
disclosure for the rest. Reserve the coral fill for the item that is genuinely
time-critical and let the others sit in `--surface-2` with a brass marker.

## 8. Monospace has spread past numerals

**What you see.** `not shown`, `2 holdings`, `UNREAD`, and on Tax essentially
every label and value on the screen. The Tax working paper reads as terminal
output rather than a document.

**Why it is wrong.** `docs/tokens.md` §3 assigns mono to *every number* plus
uppercase micro-labels, and Public Sans to "everything interactive and everything
read as prose". Mono is the ledger signal precisely because it is reserved; using
it for words spends the signal.

**What to do.** Audit for mono applied to non-numeric strings. On Tax, the
section headings and the qualifying words (`of ₹1,25,000`, `at 12.5%`) are prose
and belong in Public Sans; the figures stay mono and stay tabular.

This finding is the symptom. Finding 11 is the cause, and fixing 11 first makes
most of this fall out — do them together.

## 9. Privacy control wraps at 375px

**What you see.** On the Assets card, the eye button drops to its own line below
the Household / Mine segmented control, left-aligned and alone. First card,
first screen, narrowest width.

**What to do.** Let the control row wrap as a unit, or move the per-card eye out
— the header already carries a privacy switch, and two controls for one state on
the same screen is the problem `conformance.md` flagged for the currency control.

## 10. `max-w-app` caps every screen at 880px

**What you see.** `tailwind.config.js` sets `app: '880px'`, applied to the nav
and both `main` elements. On a laptop or a monitor the app is a single column
with the rest of the screen empty, and Overview is a long scroll whatever the
window size.

**Why it is a low-severity finding and not a bug.** 880px is a sound measure for
reading, and single-column is right for Expenses and for anything with a table.
It is wrong only for the two screens that are grids of independent blocks.

**What to do.** Raise the cap to ~1200px and give Overview and Tax a two-column
grid above 1024px, leaving every other screen single-column at the current
measure. Test at 200% OS text size before calling it done, per `CLAUDE.md`.

## 11. Three type rules in `tokens.md` §3 are too broad

Unlike the ten findings above, this one says the specification is wrong rather
than the code. It came from comparing the app against a shipped Indian personal
finance app (INDmoney), whose type system does four number sizes and three label
sizes and nothing else. The comparison is about scale relationships and casing
only — no palette, no typeface and no layout is being borrowed, and the
merchandising surfaces that app carries are out of scope here by design.

**What the reference does.** Every figure is sans-serif, including the hero; it
gets "this is money" from size, weight and right-alignment rather than from a
typeface. Not one label is uppercase. Units are welded to the figure —
`₹6.3Cr`, `₹12.93K` — with no gap and the unit smaller and muted.

### 11a. Mono for *every* number is too broad

§3 says IBM Plex Mono is for "*every* number, plus uppercase micro-labels", and
calls it "the strongest single signal that the app is a ledger". In a table that
is right: figures stacking in a column must align, and that is what mono is for.
At display size it is wrong. Plex Mono at 48px is wide, evenly spaced and
mechanical, which is why the hero reads as output rather than as a headline —
and it is the direct cause of the gap in `₹5.3  L`, where the unit floats away
from the figure.

**Change §3 to:** mono for figures in tables and anywhere figures stack in a
column; **Public Sans with `font-variant-numeric: tabular-nums`** for hero
figures and single stat values. The alignment guarantee is kept; the terminal
texture is not.

### 11b. Uppercase letterspaced micro-labels everywhere is too much

`INVESTED`, `UNREALISED GAIN`, `TOTAL RETURN`, `CHANGE`, `UNREAD` — five on the
Assets card alone. At that density the treatment stops being a signal and
becomes texture, and it is half of finding 8.

**Change §3 to:** uppercase mono micro-labels for **table column headers only**.
Every other label — stat tiles, figure captions, form fields — becomes 12px
Public Sans in `--muted`, sentence case, no letterspacing.

### 11c. There is no unit style, and there should be

`₹54.85 L`, `₹5.3 L`, `$41.8K` are rendered as one string, so mono spacing pushes
the unit away from the figure it belongs to.

**Add to §3:** a unit span at `0.6em` in `--muted`, no space between figure and
unit. One small component in `ui/primitives.tsx`, used by every money formatter,
fixing the floating unit on every screen at once.

### What is *not* changing

The scale's page-title and card-title steps stay — they are why this app's tab
labels will not truncate to `Mutua...` the way the reference's do. The hero stays
`clamp(32px, 6vw, 48px)` rather than a fixed mobile size. Newsreader stays for
display; it is the one thing that makes this app not look like every other
finance app. And the hero-to-row ratio stays as specified — the problem on
Overview was three heroes competing, not the size of any one of them.

**Order for this finding:** edit `docs/tokens.md` §3 first and show me the diff,
because everything else in this finding is mechanical once the rule is settled.
`scripts/check-design-tokens.mjs` may encode the old rule — check it.

## 12. A labelled input is named by its placeholder

*Found by the end-to-end tests, after the rest of this review.*

**What you see.** Playwright reads the amount field on Quick add as "0.00" and the payee field as "Optional":
the placeholders, not the labels printed above them. The browser pane's accessibility tree does the same.

**Why it is wrong.** `Field` rendered `<label><span class="label">Amount</span><input></label>`: the input
*inside* the label, relying on the implicit association, with no `id` and no `for`. A browser follows that;
a test tool, a screen reader and the pane's own tree do not reliably, and fall back to the placeholder, which
is not a name. Two things made it worse. The hint sat inside the label, so it was part of the field's name.
And in `PasswordField` the reveal button sat inside the label too, so the name was "Password Show password".
A placeholder as the only name also disappears the moment somebody types, which is what a person using a screen
reader hears.

**What was done.** `Field` and `PasswordField` now render a real `<label htmlFor>` as a sibling of the input,
with the input's `id` from `useId()` (colons stripped, an `id` passed in is kept), the same `label` class so
nothing moves, and the hint as `aria-describedby`, which is what a description is. The reveal button is no longer
inside a label. Checked on the sign-in screen: the fields are named "Email" and "Password" and the button is its
own control.

**The other primitives that take a `label`, checked for the same pattern.** None has it. `Stat` is a `dt`/`dd`
pair; `Bar`, `EditButton` and `Table` carry the label as `aria-label`; for `Caveat` and `Absent` it is the
panel's heading.

**What is left, and not fixed here.** Thirty raw `<label>` wrappers in screens use the same shape around a
`<span class="label">` and a control: 26 selects and 4 inputs, in eleven files (Plan 7, Holdings 5, Edit holding 5,
Household 3, Expenses 2, Import 2, Tax 2, and one each in Edit expense, Settings, Summary and the household
switcher). They are valid HTML and a browser names them, so this is the same weakness at a lower severity, and
mechanical to fix with a `SelectField` primitive that does what `Field` now does. Not done in the same change
because it touches eleven screens and is better as its own commit; a test that finds any control with no
accessible name other than its placeholder would stop it coming back.

---

## 13. The TOTP QR code does not render

Found 6 October while building the end-to-end suite, by enrolling a test
account for the first time. Findings 13 to 15 all come from that, and all three
sit on the sign-in path — the first thing anyone invited to this household will
touch.

**What you see.** On "Set up your authenticator", the QR box shows the literal
text `data:image/svg+xml;utf-8,` above a solid black square. No scannable code.
Enrolment is only possible through the hand-entry fallback.

**Why.** `src/repo/auth.ts` passes Supabase's `data.totp.qr_code` straight
through as `qrCodeSvg`. That value is a data URI, not SVG markup, and
`SignInScreen.tsx` injects it with `dangerouslySetInnerHTML` — so the browser
renders the URI prefix as text and whatever follows it as markup.

**What to do.** Strip the prefix and URL-decode in the repository layer, so
`qrCodeSvg` is what its name claims and the component keeps injecting markup.

**Not** `<img src={dataUri}>`. `vite.config.ts` applies its Content-Security-
Policy to the built bundle only, so a `data:` image renders in dev and is
blocked by `img-src` in production — the QR would break on Pages and nowhere
you would notice. Verify the fix by scanning it with a phone, not by looking at
it: a QR that draws but does not decode is identical in a screenshot.

**Status: fixed in code, not yet scanned.** `src/lib/qr.ts` (`svgMarkupFromQr`, 7 tests) strips the prefix in
the repository layer, accepts the raw, percent-encoded, `charset` and base64 spellings, and keeps a literal `%`
in raw markup instead of failing to decode it. As the finding says, the component keeps injecting markup, not an
`<img>`. One addition: because it is injected as markup, anything that is not a plain SVG, or has a script, an
event handler, a `javascript:` URL or a `foreignObject`, comes back null and the screen falls back to typing the
secret. **Still to do, by a person: scan it with a phone**, since a QR that draws but does not decode looks the same
in a screenshot. Unit tests prove the markup; they cannot prove the code.

## 14. Every MFA failure is reported as an expired code

**What you see.** A correct six-digit code rejected four times in a row with
"That code was not accepted. Codes expire every 30 seconds — try the current
one." The code was never the problem; the enrolment screen had been left idle
and the session had gone stale.

**Why it is wrong.** `verifyTotpCode` in `src/repo/auth.ts` discards the error
from `challengeAndVerify` and substitutes one sentence. A stale session, a
discarded factor, a rate limit, a network failure and a genuinely wrong code are
all reported identically — and that one sentence names the only cause that was
not responsible, which sends a person round the loop fetching fresh codes.

**What to do.** Keep the friendly sentence for an actual code mismatch. Report a
stale session as what it is, with the action that resolves it. Do not surface
raw Supabase strings, and do not collapse every cause into one message.

The enrolment remint on reload is deliberate and documented in that file —
an abandoned unverified factor cannot be listed, so reusing a fixed name would
turn one failed attempt into a permanent lockout. Leave it. This finding is only
about the error text.

**Status: fixed in code.** `src/repo/authErrors.ts` (`classifyMfaFailure` and `describeMfaFailure`, 14 tests)
classifies the failure before describing it: a wrong code keeps the friendly sentence, now naming the phone's
clock as the other usual cause; a stale session says the sign-in has timed out and to sign in again, and that
the code was not the problem; a vanished factor says to start the setup again; a rate limit, a network failure and
a late code each say so. A stale session is checked **before** a mismatch, because that ordering is the fault. No raw
server text is shown, and an unknown failure keeps only its status and code as a short reference. The reload remint
is untouched, as the finding asks.

## 15. Three households all named "Demo household"

**What you see.** The household switcher offers three options, every one of
them reading `Demo household (demo)`. Nothing distinguishes them.

**Why it matters.** `docs/build-plan.md` §00 already records a second demo
household from the local-only fixture, "its login banned; removing it is an open
decision". That decision has not been taken and there are now three. Somebody
switching household is choosing blind, and the demo badge — which exists so
there is "never a moment of wondering which numbers you are looking at" — cannot
do its job when every option wears it.

**What to do.** Decide which survive. Remove the rest, or name them so a person
can tell them apart. Worth doing before the count reaches five.

**Status: the diagnosis above was wrong, and this is fixed in code. There were never three households.** The switcher
had grown a raw UUID in the 412px screenshot, which the label code only produces when two ids agree on every
character: the same household, listed more than once. The cause was the lookup, not the data. `membership_select_same_household`
returns every live membership in every household the caller belongs to, on purpose ("who else is in this household, and in
what role"), and `listHouseholds`, `listExpenses`, `listHoldings` and `listPlan` all read it unfiltered on the comment that
"RLS restricts this to the caller's own rows". It does not. So the switcher listed the household once per person in it, and
`limit(1)` took the **oldest membership in the household, usually the owner's, whoever was looking**: the role that decides
which screens are offered, the member id records are filed under and whether Quick add is shown. Invisible for an owner; wrong
for anybody else. The database still refused what it should, so nothing was exposed. Fixed in `repo/account.ts`: the
lookups are filtered to the caller's own account, found from `user_account`, whose policy returns the caller's row alone.
Checked in the regenerated screenshots: the switcher now shows one household. **No action on the data is needed**, and the
two SQL statements below are not needed for this.

*What follows is the earlier status, kept because the label code it describes is still in:* what is code is done: the switcher no longer offers options that read alike. A repeated name
now gets the least that tells its group apart (the role, then the date created, then a short piece of the id), so
three `Demo household` become `Demo household · created 7 Sept 2026` and so on; a name that is not repeated is
untouched (`src/app/householdLabels.ts`, 7 tests). **What is data is the maintainer's:** which of the three survive,
and renaming or removing the rest. A client cannot rename a household (there is no write policy on `household`), and
nothing here deletes one. To see them, in the Supabase SQL editor:

```sql
select h.id, h.name, h.kind, h.created_at,
       (select count(*) from public.membership m where m.household_id = h.id and m.revoked_at is null) as members,
       (select count(*) from public.expense_txn e where e.household_id = h.id) as expenses,
       (select count(*) from public.holding x where x.household_id = h.id) as holdings
  from public.household h
 order by h.created_at;
```

and, to rename one so it is recognisable in the switcher:

```sql
update public.household set name = 'Demo household (old fixture)' where id = '<the id from above>';
```

Never run `supabase db reset --linked`, and never use `reset_demo_household` on one whose contents you want.

## 16. A trend chart drawn from a single reading

Found 9 October, from the screenshots `npm run test:screens` produces. Findings
16 and 17 both come from looking at Overview as an image rather than as code,
which is the point of that command.

**What you see.** "Assets over time" spans Aug 26 to Sep 26 as a perfectly flat
line at ₹50.01 L, with the area beneath it filled, axis ticks to ₹60 L, and an
endpoint dot and label. It looks like a measured trend. It is one data point.

**Why it is wrong.** The flatness is not a finding about the household's assets;
it is an artifact of having nothing to compare. A line between one point and
itself asserts stability that was never observed, and this project is otherwise
careful never to show a figure as more settled than it is — the same instinct
behind refusing a total that cannot be converted honestly.

**What to do.** An empty state until there are two readings: the figure, and a
line of text saying the series starts with the next month-end close. The chart
arrives when it has something to draw. Keep the card — its absence would be
worse than its emptiness, because the card is also what tells you the close is
running.

## 17. Two headline figures differ by ₹12 lakh, unexplained

**What you see.** Net worth reads ₹62.58 L at hero scale, top left. Assets over
time reads ₹50.01 L at its endpoint, top right, at a similar weight. Twelve lakh
apart, side by side, on the screen a person opens first.

**Why it is wrong.** Both figures are correct and the reason they differ is
stated — "Other members' private holdings are not in this line: their detail is
theirs, and a sum without dates cannot be placed on a month." But that sentence
is grey body text below the chart, and the eye reaches the two numbers first.
A reader who notices the gap before the explanation concludes one of them is
wrong, and the private-entry design depends on people trusting that the totals
add up.

**What to do.** Put the qualification where the figure is, not beneath the card
— the caveat marker already exists for exactly this and is used well elsewhere
on the same screen. The chart's endpoint label is the place for it.

## 18. Profile calls the same pause by a different name

**This finding was first written as a defect and was wrong.** It claimed
Profile never finishes loading, on the evidence of a screenshot showing
`Reading…` on two cards. Profile loads fine. The capture step waited for
`Loading…` to disappear, Profile says `Reading…`, so the photograph was taken
mid-load and I read the capture's impatience as a bug in the screen. Recorded
rather than deleted, because a review that quietly removes its mistakes is not
one you can trust the rest of.

**What is actually true.** Six screens render `Loading…` while they query.
`ProfileScreen` renders `Reading…` for the same state, twice. A person meets
two words for one pause, and anything that keys on the placeholder — the
screenshot capture did, and it will not be the last thing to — has to know
about both.

`ImportStatement` also says `Reading…`, and that one is correct and should
stay: it is a button's busy label while the device parses a PDF, which is a
different act from waiting on a query.

**What to do.** Profile says `Loading…` like everything else. One line.

## 19. FIRE has no projection — the mockup proposes one

Not a defect. A correction to the record, so nobody reads the October mockups
as a restyle of what exists.

**What is built.** FIRE is a target figure, a multiple-of-spending control, an
inflation input, and a year-by-year table — 2026, 2031, 2036 — plus the
spending plan and the loans-and-policies forms. No chart.

**What the mockup shows.** A projection curve with a dashed target line, the
crossing year called out, a goal ring with reached/target/shortfall, and a
contribution sensitivity line. All four are new behaviour, not new paint.

`docs/design/conformance.md` already records FIRE as partial — "no goals, and
no projection against real contributions" — and `docs/build-plan.md` puts the
live projection at step 8 of stage 5, after the balance sheet. That ordering
stands. The mockup is what step 8 should look like when it arrives, and should
not be used to argue it arrives sooner.

## 20. The activity log mixes friendly names with table names

**What you see.** On Profile, Recent activity reads:

> Added **a valuation** · Added **an instrument** · Changed **a holding** ·
> Added **fixed_income_terms** · Added **bond_rating_change**

Five of the ten visible rows name the thing in English; the rest print the
table name, underscores included.

**Why it matters more here than it looks.** This is section 20's trust
surface — the screen a member opens to see what the household has recorded
about them, and the one the private-entry design leans on to be believable.
Raw schema names on that screen read as *this was not meant for you*, which is
the opposite of what the screen is for.

It is also the same shape as the `kindLabel` fallback: a map covers some
values and the rest fall through to the stored string. That fallback is right
for a label nobody has written yet — better a kind's raw name than a blank —
but a fallback that fires on half the rows is a map that is missing entries.

**What to do.** Name the entity types the audit trigger actually writes.
Where one is genuinely new and unnamed, the fallback should at least replace
underscores with spaces, the way `kindLabel` already does.

## Order

**13 and 14 jump the queue.** They were found after the rest and they are
not design findings — they are two defects on the enrolment path, which is
the first screen anyone invited to this household ever sees, and between
them they make a first sign-in close to unusable without being told how.
Fix those before resuming the list below. 15 can wait, but not indefinitely.

Findings 11, 2, 3 and 8 are the first pass: 11 settles the type rules, then 2, 3
and 8 apply them and fix the caveat marker and the absent-figure rendering. All
four touch shared primitives, so four screens improve at once. Then 1 and 6,
which are Overview's hierarchy. Then 4, which is the real work and the one that
changes how the app looks. Then 5, 7, 9, 10 as they come.

Update `docs/design/conformance.md` in the same commits where a finding closes a
gap it records — the donut and the since-inception chart both have rows there.
Finding 11 changes `docs/tokens.md`, which is authoritative under `CLAUDE.md`,
so that edit lands in its own commit ahead of any code that depends on it.

## 21. 200% text size is a requirement and nothing verifies it

Not a defect anyone has seen. A gap in the checking, found while deciding what a
palette commit should and should not be asked to prove.

**The requirement.** `CLAUDE.md`: "Respect OS text size to 200%; no fixed-height
container holds text." `docs/tokens.md` §3 repeats it under Text scaling, and the
code has been written to it: the lifted card's header band is in rem so it keeps its
place at 200%, `.pb-nav` was found short at 200% and fixed, and several comments
record the same.

**What checks it.** Nothing. `check:design` compares tokens, `theme.spec.ts`
checks contrast and depth at the default size, and the screenshot capture is taken at
the default size. Every 200% fix so far was found by somebody looking, and the file
says so more than once ("caught by testing at 200%").

**Why it matters.** Parents will use this app, and a fixed height or a clipped label at
double size is invisible at the size a designer works at. The same kind of defect has
recurred, which is what a missing check looks like.

**What to do.** Not in a palette commit. A test that renders each screen at 200% and
asserts no horizontal scroll on the page body and no text clipped by its container (a
child's scroll width above its client width where `overflow` is hidden) would hold the
claim. The capture could take a 200% set too, to read by eye until the assertion exists.

## 22. The privacy spec failed once, and the cause is not known

**Open. Not closed, and not to be recorded as closed.**

`tests/e2e/privacy-mode.spec.ts`, desktop, "an amount is absent from the page, not merely
hidden", failed once in a full `npm run test:e2e` on 9 October 2026, on the palette
branch. In the same session it passed in an earlier full run, in a full re-run straight
after, on its own, and eight times in a row with `--repeat-each=8`.

**The log was lost.** The run's output was filtered as it streamed, to the lines that
begin a failure and the final tally, and the message that said *why* it failed was not
kept. That is the mistake, and it is why this is open and not explained.

**Why it is worth more than its failure rate.** This is the only test that checks a
promise made to the family: that an amount is absent from the DOM when privacy mode is on,
and not merely hidden (`docs/tokens.md` §8). Everything else in the suite guards behaviour.
Eight green repeats make a real leak unlikely, but a flaky test over this assertion is
itself a defect: the next time it goes red nobody will believe it.

**One suspect, unproven.** The test reads `document.documentElement.outerHTML` straight
after clicking the toggle, without first waiting for the toggle to have flipped. If a
re-render were ever late, the markup would still hold the digits. That would be a race in
the test and not a leak, but it is a guess and has not been shown.

**What to do.** If it recurs: keep the full log, and stop. Do not re-run until it passes.
Capture a full-suite run whole (`2>&1 | tee test-results/e2e.log`) and filter the file,
not the stream.
