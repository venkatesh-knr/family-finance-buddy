# Spending capture

<!-- invariant-prefix: SC -->

How the app knows what a month cost when nobody types every payment. The
pictures are the Spending capture row of `docs/design/vibrant-canvas.html`
(the month close, a closed month on Expenses, quick add opened from a shared
payment, and where a month's money went); this file is the authority where the
two differ.

## Why

Money leaves a household by cash, UPI from three different apps, cards and auto
debits. Typing each one is the blueprint's stated failure mode ("a month of card
spending typed by hand is where somebody stops using this"), and statements
arrive weeks late or not at all. Today the Expenses figure is the **sum of what
was typed**, so an incomplete log reads as a frugal month and the plan, the
months-of-cover line and *Saved this month* are all wrong without saying so.

Itemising every rupee is the wrong target. Knowing the month's total is the
right one; itemising is what gets filled in, at whatever pace the household
manages.

## 1. Two questions, two sources

| Question | Source | When it is known |
|---|---|---|
| How much did we spend? | Account balances at the month's ends | At month close, about two minutes on the 1st |
| On what? | Entries: typed, shared, posted by a rule, imported | Whenever they arrive, late included |

The difference is shown as **Not yet itemised**, a line of its own. It is never
spread across categories in proportion, because that would invent a breakdown
nobody recorded.

### What is not possible, and why it does not matter

There is no way for a third-party app to read Google Pay, PhonePe or Paytm
history directly: no public interface, and the regulated route (Account
Aggregator) needs a licensed entity and a server this project does not have
(`docs/design/data-residency.md`). Reading SMS or notifications needs
permissions Google Play restricts and a web app cannot request. None of that is
needed for the total, because **every UPI payment, from whichever app, is
already a debit on a bank account**, and the balance sees it.

## 2. The month-close figure

Per spending account (a savings or current account, or a card; `account` from
build-plan step 6a):

```
bank account   left = opening balance + money in − closing balance
card           left = amount due at end − amount due at start + payments made to it
```

```
spent = Σ left
      − transfers between the household's own accounts (a card payment is one)
      − money into a holding (SIP, RD instalment, PPF, an FD opened)
```

- **Opening is last month's closing.** The first close asks for both.
- **Money in is pre-filled** from the income ledger (6a) and transfers the app
  knows about. Anything else (a refund, a friend repaying) is added at the close
  as *other money in*. It reduces spending and is not income.
- **Cash is spent when it is withdrawn.** The wallet is not an account. Cash
  entries itemise the withdrawal; they do not add to it.
- **The two ways it goes wrong are stated on the screen.** A payment in that is
  missing makes spending read low; an investment the app does not know about
  makes it read high.
- **Spent is derived, never stored.** The close stores balances. The figure is
  a pure function of the balances and what the app knows, so a statement that
  arrives later and identifies an SIP corrects the month by itself.
- **A month can be closed only once it has ended** (IST), and reopened by
  editing a balance. A statement's closing balance supersedes a typed one for
  the same account and date (the rule `holding.stated_quantity` already
  follows).
- **Which accounts it covers is shown** ("3 of 3 accounts"). Money spent from an
  account nobody added is in *itemised* only, and is the usual reason for the
  case in SC-I3.
- **Private accounts stay private.** A member's personal account contributes
  its `left` to the household figure as a sum through a security-definer total,
  as `personal_holding_totals` does for holdings. Its rows and balances stay
  hidden.

## 3. Itemising cheaply

In order of effort for the person, lowest first:

1. **Recurring rules post themselves.** Blueprint §04 `recurring_rule`
   (category, amount, cadence, next due, `auto_post`): EB, DTH, school fee,
   premiums, household help. Posted once per due date. A statement line arriving
   later matches the posted entry (§4) instead of adding a second.
2. **Share to the app.** The installed app registers as a share target
   (`share_target` in `manifest.webmanifest`; Android, Chrome). Sharing a
   payment from a UPI app, or a bank alert from Messages, opens quick add with
   amount, payee, date and UPI reference filled from the shared text, every
   filled field marked as a guess. **Nothing is saved until the person taps Add.**
   iOS has no share target for web apps, so quick add carries a **Paste**
   button that reads the clipboard on that tap only. A shared image is not read
   (no OCR); it becomes the receipt once receipt storage exists.
3. **Quick add**, as built: amount first, payee memory suggests the category.
4. **Statements**, whenever they come: bank and card (step 7), and the UPI apps'
   own statements (Google Pay PDF, Paytm Excel or PDF, PhonePe PDF). A UPI
   statement adds nothing the bank does not already have except a **readable
   payee name** in place of `UPI/RAZORPAY/8817`. That is what it is for.

## 4. One payment, many witnesses

The same ₹642 can arrive as a shared alert, a Google Pay statement line and a
bank statement line. It is **one entry with up to three witnesses**, never three
entries.

Matching, strongest first:

1. **UPI reference.** The 12-digit number appears in the bank narration, the UPI
   app statement and most alerts. An exact match merges automatically.
2. **Line hash** (date, amount, raw description, per source). Recognises a
   re-imported statement, as `lot.source_hash` does for eCAS.
3. **Near match:** same amount, same account, within two days, entry not yet
   witnessed by that source. **A suggestion that waits for a person,** never
   automatic: two ₹500 payments on consecutive days are common.

Merging fills empty fields and adds a witness. It **never overwrites a field a
person typed.** The witness with the clearest payee wins for an empty payee: a
UPI statement beats a bank narration.

Stored for matching: the reference's **last four** for display and a **sha256 of
it** for the match, computed on the device. That follows the last-four rule in
`CLAUDE.md`. The hash is not a secret (a 12-digit space is small); it keeps the
number out of plain view, which is all the rule asks. **A payee VPA
(`name@bank`, often a phone number) is never stored**, only the display name.

## 5. Planned vs actual

- **A closed month:** the hero is *Spent, from balances*, compared with the plan
  total. Categories show their itemised amounts against their own plans.
  *Not yet itemised* sits at the foot of the plan, beside *Uncategorised*, with
  no plan of its own.
- **The open month:** as today, itemised so far, labelled as itemised.
- **Months of cover (PF-C9)** uses the closed figure for closed months. Where
  some of its twelve months were never closed, it says how many came from
  itemised entries only, because those read low and make the cover read high.

## 6. The month close, on the screen

From the 1st, Expenses shows a prompt: *Close October · about 2 minutes.* The
close screen puts the answer first and the working below it, as the rest of the
app does:

1. **The result**, the one lifted surface: spent, itemised, not yet itemised,
   and the plan it is measured against. It updates as balances are typed.
2. **Accounts:** one row each, with the closing balance as the only input (as at
   the last day of the month), and opening, money in and *left* shown beside it.
3. **Not spending:** own transfers and money into holdings, folded to two
   totals; each opens to its lines.
4. **Close October.**

The detail level (`docs/design/detail-level.md`) decides how much of 2 and 3 is
unfolded. It never changes the figure, and the caveat survives essential mode
(DL-I4).

## 7. Data

| Change | Notes |
|---|---|
| `account` | 6a's registry: institution, type (`savings`, `current`, `card`), currency, last four, member, visibility |
| `account_balance` | account, `as_at` date, `balance_minor` (for a card, the amount due, positive), `source` (`typed`, `statement`), `source_batch_id`. Unique per account, date and source |
| `expense_txn` gains | `account_id`, `captured_via` (`typed`, `shared`, `rule`, `import`), `recurring_rule_id`, `upi_ref_last4`, `upi_ref_hash`, `source_batch_id`, `source_hash` |
| `expense_witness` | expense, batch, line hash. Unique per household and line hash, so the second statement to witness a payment is recognised on re-import too |
| `recurring_rule` | blueprint §04, plus a unique (rule, due date) on what it posts |
| `import_batch.kind` gains | `gpay_pdf`, `paytm_xlsx`, `paytm_pdf`, `phonepe_pdf` |

Every new table has its audit trigger, RLS enabled, explicit grants, the
second-factor restrictive policy, and is cleared by `reset_demo_household` and
filled by the seed, in the same migration. The capture rule (detail-level §4)
holds for every path: each writes every field it can extract, whatever anyone's
display setting.

## 8. Where it sits in the plan

| Slice | Needs | Can go |
|---|---|---|
| **S1** Recurring rules and auto-post | nothing new | any time; blueprint Stage 6 already lists it |
| **S2** Share target and Paste | the manifest | any time |
| **S3** Month close | `account` and income (6a) | straight after 6a |
| **S4** UPI app statements and witnesses | bank import (step 7) | with or after step 7 |
| **S5** Where the month's money went | S3 for the cash reserve; *invested* alone needs nothing new | the invested half any time; the rest with S3 |

S1 and S2 cut typing now. S3 is what makes the figure right.

## 9. Decisions owed to the maintainer

1. **`CLAUDE.md` says "no SMS parsing".** Share-to-app parses text the person
   hands over, one message at a time; it never reads the inbox and asks no
   permission. Proposed rewording: *"No SMS reading: the app requests no SMS,
   notification or accessibility permission. Text a person shares into the app
   may be parsed."*
2. **Loan EMIs.** The principal reduces a liability and is not spending; the
   interest is. Proposed: an EMI paid to a recorded liability is excluded from
   *spent* and shown as its own line until the liability carries the split.
3. **The UPI reference:** last four and a hash (proposed) or the full number.
4. **A spreadsheet library** for Paytm's Excel file. Step 7 already owes this
   decision for bank XLS; Paytm's PDF works without it.
5. **Who closes a month:** proposed, owner or partner for the household, and a
   contributor for their own accounts only.
6. **Take-home income.** §10 assumes salary is recorded as what reached the
   account, so payroll deductions sit outside *saved*. 6a already owes the "which
   income" decision (gross with TDS for the Tax card, or take-home); if it is
   gross, *saved* must subtract tax and payroll deductions, and §10 changes with it.

## 10. Where the month's money went

*Saved this month* (protection-and-flow.md §4: income − spent) is one number. A
household also needs to know **how much of it was actually invested**, and how much
is still sitting in the bank. Money in a savings account is a **cash reserve**, not
yet moved into savings, and the screen should say so.

```
saved this month   = income − spent                                  (PF §4)
                   = net invested + change in cash reserve             (closed month, exactly)

net invested       = put into holdings − taken out of holdings
cash reserve       = savings and current account balances − card dues
```

**Put into holdings** comes from the holdings' own entries, by date, per class: a
purchase lot, a deposit opened, an RD or gold-scheme instalment, a PPF or NPS
contribution paid from an account. **Taken out** is a sale, a redemption or a
maturity paid into an account. Both are shown, and the net.

**Not invested,** however it looks:

- Market movement. A fund that rose ₹10,000 is in *net worth change*, not here.
- Dividends and interest reinvested inside a holding, bonus units and splits.
- Moving a holding between members, or converting one holding into another
  (gold.md §5).
- **Contributions that never pass through an account** (EPF, and employer NPS
  through payroll). They are shown on a line of their own, *also put away through
  payroll*, and are not in *invested* or *saved*, because they were never in the
  take-home income that *saved* starts from.

**Exactness.** *Invested* is known as soon as the holdings are recorded and
needs no month close; it is the sum of entries the person can open one by one.
*Change in cash reserve* needs the close, because it comes from balances. For a
closed month the two parts add up to *saved* to the paisa. That follows from §2's
arithmetic rather than being checked against it, so a gap means a bug.

**The cash reserve is in net worth** as the Cash class (blueprint §01, the ninth
class), with card dues netted off. It is not *invested*, and the screen says
*not yet invested* beside it rather than implying it should be. Whether it should
be invested is a judgement the app does not make.

**On the screen:** the Overview's flow region opens *October's money*. That screen
leads with saved, split three ways (spent · invested · left in the bank), then
invested by class (in the order and colours Holdings groups by), then the cash
reserve by account. A class with nothing in it this month is folded into one line.

## Invariants

**SC-I1 — A closed month's spent is derived from balances and never stored,** and never computed as the sum of entries. (§2)

**SC-I2 — Not yet itemised is a line of its own,** never spread across categories. (§1, §5)

**SC-I3 — When itemised exceeds what left the accounts, both figures are shown and the gap is named;** neither is clamped to the other. (§2)

**SC-I4 — A transfer between the household's own accounts, a card payment, and money into a holding are not in spent.** Extends PF-C10 to the month close. (§2)

**SC-I5 — One payment is one entry:** a matching statement line adds a witness and fills empty fields; it never creates a second entry and never overwrites a field a person typed. (§4)

**SC-I6 — Only a UPI reference or a line hash merges automatically;** a near match is a suggestion that waits for a person. (§4)

**SC-I7 — Share and Paste never save without a tap,** and the app requests no SMS, notification or accessibility permission. (§3)

**SC-I8 — No payee VPA and no full UPI reference is stored:** the last four and a hash. (§4)

**SC-I9 — A month with no close shows itemised figures labelled as itemised,** and months of cover says how many of its months were itemised only. (§5)

**SC-I10 — A recurring rule posts once per due date:** running the poster twice, or on two devices, posts once. (§3)

**SC-I11 — Invested is derived from the holdings' own entries by date,** never from balances and never including market movement. (§10)

**SC-I12 — For a closed month, saved equals net invested plus the change in cash reserve, to the paisa.** (§10)

**SC-I13 — Invested by class adds up to invested,** and its classes are the classes Holdings groups by (HD-I2). (§10)

**SC-I14 — A contribution that never passed through a household account is shown apart from invested,** and is in neither invested nor saved. (§10)

## Tests

- SC-I1: no column stores a month's spent; the pure function returns the worked
  example in §2 from balances alone, and changes when an SIP outflow is added
  without any balance changing.
- SC-I2: a closed month with a gap renders a *Not yet itemised* row, and every
  category's figure equals its itemised sum.
- SC-I3: itemised ₹50,000 against ₹45,000 left renders both and the ₹5,000 gap.
- SC-I4: a card payment, an own transfer and an SIP debit each leave spent
  unchanged.
- SC-I5: importing a bank line and then a Google Pay line for the same payment
  leaves one entry with two witnesses, and a typed payee survives both.
- SC-I6: two ₹500 lines a day apart with no reference produce a suggestion and
  no merge.
- SC-I7: a shared text opens quick add filled and writes nothing until Add; the
  manifest and the bundle request no SMS, notification or accessibility
  permission.
- SC-I8: no column holds more than four digits of a reference, and no column
  holds an `@`-address.
- SC-I9: an unclosed month's hero carries "itemised", and months of cover with
  four unclosed months says so.
- SC-I10: running the poster twice for one due date writes one entry (a unique
  constraint, in pgTAP).
- SC-I11: a fund's price rising leaves invested unchanged; an SIP lot dated in the
  month adds its amount to the month's invested and its class.
- SC-I12: the §2 worked example plus a gold-scheme instalment gives saved ₹1,26,580
  = invested ₹57,500 + cash reserve ₹69,080.
- SC-I13: invested by class sums to invested, and a class absent from Holdings
  never appears.
- SC-I14: an EPF contribution recorded for the month appears on the payroll line
  and changes neither invested nor saved.
