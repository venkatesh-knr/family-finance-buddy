# Detail level

Some households want one number. Some want the working behind it. This is how
the app serves both without becoming two apps.

## 1. The decision

**Not a simple/complex mode.** A global mode asks people to classify themselves
before they have used the app, doubles the screen inventory and the capture
suite permanently, and leaves two products for one maintainer to keep in step.
The one that gets less attention rots, and whichever it is, somebody is using it.

**A per-viewer display preference instead.**

```
user_account.detail_level = essential | full      -- default: essential
```

Per person, not per household, because the variable is the person. This is a
family app: two people look at the same data and want different amounts of it.
A household-level setting makes them argue over one switch.

Default `essential`. Discovering more depth is a pleasant surprise; discovering
that things were hidden from you feels like the app was being coy.

### Why the auth identity and not `member`

`member` is doing two jobs in this app, and this setting is the first thing to
trip over it.

- A **member** is an attribution subject — a person the money relates to. A
  parent whose LIC policy sits under their name, a child with an SSY account.
  Most of them never sign in, and nothing requires them to. Every use of
  `member` in `protection-and-flow.md` is this sense: income earner, life
  assured, nominee, sum insured per person.
- A **viewer** is someone who opens the app. `detail_level` is a property of
  reading, so it belongs to the viewer.

A `detail_level` on a member who never signs in does nothing at all, so it must
not be storable there — see I6.

It goes on the auth identity rather than on the household membership because
that choice migrates upward cleanly. Account → membership later is one row per
membership inheriting the account's value, no decisions to make. Membership →
account is collapsing several values into one and picking a winner. If someone
eventually wants full detail in their own household and essential in their
parents', add a nullable override on the membership and resolve:

```
membership.detail_level ?? user_account.detail_level ?? 'essential'
```

One line, whenever it is wanted. Speculative if added now.

## 2. The asymmetry that decides everything

> **Data you did not collect is gone forever. Data you did not display is one
> toggle away.**

If "simple" means collecting less, a household that turns detail up after two
years has two years of holdings with no cost basis, and no XIRR can ever be
computed for them. The gap is permanent and invisible — nothing on screen says
"this number is missing because of a setting you chose in 2026".

So the app always captures everything it knows how to capture. `detail_level`
is a rendering concern and nothing else.

## 3. Invariants

These are the constraints that keep this affordable. Each is testable, and each
exists because it is the specific way this feature decays.

**I1 — Essential may hide a figure. It may never change one.**
Any figure visible in both modes is identical in both. The moment essential mode
rounds, simplifies or approximates, there are two answers to the same question
and no way to tell which one a person is looking at.

**I2 — No capture path consults `detail_level`.**
Not entry forms, not import, not the repository layer. Enforceable as a
dependency rule: the modules that write data must not import the settings
module. Same shape as the existing rule that only the repository layer touches
Supabase.

**I3 — Sections hide; screens do not.**
Navigation is identical in both modes. This keeps the screen inventory, the
conformance check and the capture suite at their current size — the single
biggest reason a mode switch usually costs more than it is worth.

**I4 — Essential may hide precision. It may never hide uncertainty.**
Caveat markers, stale-data warnings, "estimated", "assumes", failed-sync
notices, and anything marking a figure as provisional survive both modes.
Hiding a caveat is not hiding detail; it is presenting an uncertain number as a
certain one. This is the invariant most likely to be violated by accident,
because a caveat looks like clutter to someone simplifying a screen.

**I5 — `detail_level` is not a permission.**
It is a rendering preference on data the viewer is already entitled to. The data
still reaches the client; essential mode merely does not draw it. If hiding
figures from a household member is ever wanted, that is row-level security and a
different conversation — never this setting. Anyone reasoning "set them to
essential so they do not see X" has introduced a security bug.

**I6 — `detail_level` does not exist on `member`.**
Not as a nullable column, not as a default nobody reads. Most members never sign
in; a setting on them is inert, and an inert setting is one somebody will change
and then wonder why nothing happened. The failure should be unrepresentable
rather than documented.

A corollary for later: if the app ever gains "view as \<member\>" — looking at
one person's slice of the household — the detail level follows **the viewer**,
never the member being viewed. The screen is about that member and the setting
would be sitting right there on them, which is precisely why this gets wired to
the wrong subject.

## 4. Import

Import is a capture path, so by I2 it never consults `detail_level`. Every field
the parser can extract is written, whatever anyone's display setting says.

Three specifics, because import is where this rule is easiest to break.

**The preview is not the capture.** An import preview screen may show fewer
columns in essential mode. What gets written is unaffected. These are two
different objects and should not share a column list.

**Keep the unmapped remainder.** An eCAS, a bank statement or a card export
carries fields the schema does not model today. Dropping them means a future
feature cannot backfill and the household must find and re-import files they may
no longer have. Store the source row as a write-once payload alongside the
parsed record.

That retention has a cost and needs four guards, because the payload may carry
folio numbers, account numbers and PANs:

- write-once — never updated, never re-parsed in place;
- never rendered on any screen, in either mode;
- **excluded from every export by default**, asserted by a test rather than by
  care — Reports ships before upload in the Stage 5 order, and an export that
  quietly carries raw statement rows is the worst version of this feature;
- purgeable per import batch from Settings, so a household can decide it does
  not want the remainder kept.

If those guards feel like more than the backfill is worth, the alternative is to
drop the remainder and accept that unmodelled fields are lost. That is a
legitimate choice — but make it deliberately and write it here, rather than
arriving at it by not implementing storage.

**Provenance survives both modes.** Where a figure came from, and when it was
last refreshed, is not detail — it is what makes the figure trustworthy. It
falls under I4.

## 5. What to build first

**Progressive disclosure, before the toggle.** Every screen gets a headline
answer and a way to show the working — the FIRE screen half does this already.
It costs nothing extra, it is better design regardless of whether anyone changes
a setting, and it means nobody has to classify themselves to get what they want.

Build that, live with it, and see whether the toggle is still wanted. It may
not be. If it is, I1–I5 are what make it cheap.

**The capture rule is the urgent half.** Entry forms should show required fields
with the rest behind a "more details" fold, and the columns should exist, from
the next form the app gains onward. Protection and flow add several forms; those
are the ones to get right first, because a form that never offered a field
produces data that cannot be repaired later. The toggle itself can arrive any
time — display-only changes retrofit perfectly.

## 6. Tests

- **I1**: for each screen, render in both modes and assert every figure present
  in both is string-identical. One parameterised test, not one per screen.
- **I2**: a static check that capture modules do not import the settings module.
  Extend the existing component-class checker rather than adding a new script.
- **I3**: the screen inventory is the same length in both modes, and
  `conformance.md` does not grow a second table.
- **I4**: a screen with a caveated figure renders the caveat marker in essential
  mode. Assert on the marker, not on a count of elements.
- **I5**: an API response for an essential-mode viewer contains the same fields
  as for a full-mode viewer. This asserts that nobody has quietly started using
  the preference as a filter — which would be a plausible-looking optimisation
  and a real security regression.
- **I6**: the `member` table has no `detail_level` column. A schema assertion,
  not a code one — it is the only kind that survives someone adding it back.
- **Import**: a fixture with unmapped columns, imported by an essential-mode
  viewer, produces the same stored record as the same file imported by a
  full-mode viewer. Byte-identical, including the retained remainder.
- **Export**: no export format contains the raw payload. Assert on the output,
  for every format offered.

## 7. Not in scope

- Per-screen overrides. One axis. A viewer who wants depth on Holdings and
  brevity on Overview is asking for progressive disclosure, which §5 gives them
  without a setting.
- Feature flags per calculation ("show XIRR", "track tax lots"). These are a
  different and heavier mechanism; if they ever arrive they are independent of
  this one, and `detail_level` must not be repurposed as their container.
- Anything that makes `detail_level` load-bearing for privacy. See I5.
