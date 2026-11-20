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
               (a card that closes on its statement date uses its statements: card-cycles.md §2)
```

```
spent = Σ left
      − transfers between the household's own accounts (a card payment is one)
      − money into a holding (SIP, RD instalment, PPF, an FD opened)
```

- **Opening is last month's closing.** The first close asks for both.
- **A card can close on its statement date.** Its cycle ending in the month stands in for the calendar month, and the month waits for that statement (`card-cycles.md`).
- **Money in is the ledger's** (`ledger-income.md` §4): an account's credits, the
  transfers into it and holding take-outs paid into it. Nothing is typed beside
  them at the close; a missing credit is added with *+ Money in*. A refund or money
  back is a credit with that category: it reduces spending and is not income.
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
- **There is no private account** (the owner, 16 November 2026). Every account
  is the household's; what stays private is a private credit, expense or holding
  in every list, and the close adds those as totals through a security-definer
  sum, as `personal_holding_totals` does for holdings.

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
| `account` | 6a's registry: a name, institution, type (`savings`, `current`, `card`), currency, last four (optional, `ledger-income.md` LI-I24), member, visibility. Optional for a household: without any, months are itemised (`ledger-income.md` §4) |
| `account_balance` | account, `as_at` date, `balance_minor` (for a card, the amount due, positive), `source` (`typed`, `statement`), `source_batch_id`. Unique per account, date and source |
| `expense_txn` gains | `account_id`, `captured_via` (`typed`, `shared`, `rule`, `import`), `recurring_rule_id`, `upi_ref_last4`, `upi_ref_hash`, `source_batch_id`, `source_hash` |
| `expense_witness` | expense, batch, line hash. Unique per household and line hash, so the second statement to witness a payment is recognised on re-import too |
| `recurring_rule` | blueprint §04, plus a unique (rule, due date) on what it posts |
| `spend_statement` | §11: a person's stated total for a month that has ended, per currency. Voided and stated again, never edited |
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
   may be parsed."* **Decided 13 November 2026: no rewording, and the share target and
   Paste are not to be built.** The `CLAUDE.md` line stays as it is.
2. **Loan EMIs.** The principal reduces a liability and is not spending; the
   interest is. Proposed: an EMI paid to a recorded liability is excluded from
   *spent* and shown as its own line until the liability carries the split.
   **Decided 13 November 2026: yes.**
3. **The UPI reference:** last four and a hash (proposed) or the full number.
   **Decided 13 November 2026: the last four and a hash.**
4. **A spreadsheet library** for Paytm's Excel file. Step 7 already owes this
   decision for bank XLS; Paytm's PDF works without it. **Decided 13 November
   2026: skip Excel for now.**
5. **Who closes a month:** proposed, owner or partner for the household, and a
   contributor for their own accounts only. **Decided 13 November 2026: accepted.**
6. **Take-home income.** §10 assumes salary is recorded as what reached the
   account, so payroll deductions sit outside *saved*. 6a already owes the "which
   income" decision (gross with TDS for the Tax card, or take-home); if it is
   gross, *saved* must subtract tax and payroll deductions, and §10 changes with it.
   **Decided 13 November 2026: gross, before tax and PF deductions** (the same answer
   as the "which income" decision in the build plan, step 6a). Salary is recorded as
   gross with TDS, the employee's PF and any other deduction, take-home is worked out
   from them, and *saved* is take-home less *spent*. The PF the employee pays is money
   put away through payroll and is shown on its own line, as §10 says for EPF.
   **Superseded the same day by the ledger (`ledger-income.md` §0):** take-home is the
   Salary credit as the bank received it and deductions are not recorded; Tax takes a
   gross salary typed once a year from the payslip; the payroll line is dropped.
7. **A stated spend (§11).** For households that do not close from balances: one typed total per ended month and currency, living costs only, balances win
   when both exist, the source always named, saved from a stated month labelled rough, voided and stated again rather than edited, and a form that also
   takes *just the rest* of an itemised month and saves the total. **Decided 17 November 2026: yes, as proposed.** The open month is not stated (§11.3).

## 10. Where the month's money went

*Saved this month* (protection-and-flow.md §4: came in − spent) is one number. A
household also needs to know **how much of it was actually invested**, and how much
went to the **cash reserve**, the money kept in savings accounts.

```
saved this month   = came in − spent                                 (PF §4)
                   = net invested + paid to loans + change in cash reserve             (closed month, exactly)

net invested       = put into holdings − taken out of holdings
cash reserve       = savings and current account balances − card dues
                     (each card's latest due on or before the day: its month-end due, or its last statement's)
```

**Put into holdings** comes from the holdings' own entries, by date, per class: a
purchase lot (a gold purchase among them), a deposit opened, an RD instalment, a PPF or NPS
contribution paid from an account. **Taken out** is a sale, a redemption or a
maturity paid into an account. Both are shown, and the net.

**Not invested,** however it looks:

- Market movement. A fund that rose ₹10,000 is in *net worth change*, not here.
- Dividends and interest reinvested inside a holding, bonus units and splits.
- Moving a holding between members.
- **Contributions that never pass through an account** (EPF, and employer NPS
  through payroll). They are not in *invested* or *saved*, because they were never in
  the take-home that *came in* records. They are not shown on a line of their own:
  the owner dropped the payroll line on 13 November 2026.

**Exactness.** *Invested* is known as soon as the holdings are recorded and
needs no month close; it is the sum of entries the person can open one by one.
*Change in cash reserve* needs the close, because it comes from balances. For a
closed month the two parts add up to *saved* to the paisa. That follows from §2's
arithmetic rather than being checked against it, so a gap means a bug.

**The cash reserve is in net worth** as the Cash class (blueprint §01, the ninth
class), with card dues netted off. It is not *invested*. **Decided 13 November 2026:
money kept in a savings account is a legitimate cash reserve and not money that
still has to be invested**, so the screen calls it the cash reserve and does not say
*not yet invested* or *left in the bank* beside it (the MonthMoney board is redrawn
with this wording in `ledger-income-boards.html`). Whether any of it
should be invested is a judgement the app does not make.

**On the screen:** the Overview's flow region opens *October's money*. That screen
leads with saved, split four ways (spent · invested · paid to loans · to cash reserve; `ledger-income.md` §4), then
invested by class (in the order and colours Holdings groups by), then the cash
reserve by account. A class with nothing in it this month is folded into one line.

## 11. A stated spend: when a month is not closed from balances

*Added 17 November 2026, at the owner's request. Design only: nothing here is built.*

§1 says knowing the month's total is the right target and itemising is what gets filled in at whatever pace a household manages. The only
source of that total so far is the balances at a close (§2), which needs accounts and a few minutes. A household with no accounts, or one that does
not want to type balances, has only the sum of what it itemised, which reads low and is labelled so (SC-I9). Some of those households know roughly
what they spend in a month, and some have itemised part of it and will not do the rest. This section lets them say it.

### 11.1 What it is

A **stated spend** is one figure a person types for a month that has ended: *we spent ₹82,000 in October*. It is in a currency (one per currency the
household spends in), it is the household's whole spend on **living costs**, and it is a person's word. It is not derived, it is not a balance, and it
is never blended with either.

**What the total includes.** The form says it: *what you spent on living, not what you put into investments, not loan EMIs, and not moves between your
own accounts.* That is exactly what *spent* means in §2 (SC-I4), so the same word means the same thing from every source. A person who states
everything that left will read a saved figure that is low by their SIPs and EMIs; the hint is there to prevent it, and the figure is labelled rough.

**Private spending is inside it.** It is the household's total, as the close's is. Individual private expenses stay private in every list.

### 11.2 Which source a month's spent comes from

A pure function takes, for one month and currency, the close (when balances at both ends exist), the stated spend (when there is one) and the itemised
sum, and returns the figure, **which source it came from**, and what sits beside it. The first available wins, and the three are never added or averaged:

| Source | When it applies | What is shown |
|---|---|---|
| **Balances** | both ends of the month have balances for every account in use (§2) | spent from balances, as today. A stated spend for the month, if there is one, is shown beside it as a cross-check: *you said ₹82,000; the balances say ₹91,000*. It never changes the figure |
| **Stated** | no close, and a stated spend | spent is the stated figure, labelled *stated*. *Not yet itemised* is stated minus itemised. If itemised is more than stated, both are shown and the gap is named, and neither is clamped to the other (SC-I3 applies unchanged) |
| **Itemised** | neither | the sum of the entries, labelled *itemised*, as today (SC-I9) |

Because the stated figure is a total, itemising more afterwards only shrinks *Not yet itemised*; nothing is double counted. That is why it is stored as
a total and not as a remainder (§11.3).

**Saved from a stated month is rough, and says so.** *Saved* is came in minus spent, as always. With no balances, the exact split of saved into
invested, paid to loans and the change in the cash reserve (SC-I12) cannot be proved, so the month does not claim it: it shows came in, spent (stated)
and saved (rough), and the *invested* line from the holdings' own entries (SC-I11), which needs no balance. It does not show a change in the cash
reserve it has no balances to know.

### 11.3 Saying it, and the rest

The form is on the Money month card, for a month that has ended and was not closed from balances, and in the close for a household with no accounts
(where it replaces "itemised only" with a one-field step). It is a few seconds, not a stepper.

For a month in which some spending is itemised, the form shows *you have itemised ₹52,000 so far* and offers two linked fields: **Spent in total** and
**or just the rest**. Typing either fills the other. Typing the rest saves *itemised so far plus the rest* as the stated total. A person who is bored
or lazy says *and ₹30,000 more*, and the app keeps the total.

A stated spend is **made for a month that has ended** (IST), as a close is (§2). The open month stays *itemised so far* (SC-I9); letting a total be
stated mid-month would let it contradict entries still to be made, and is a later option if it is asked for.

**Changing it is voiding it and stating again,** never editing in place, so the audit log and the figures that relied on it agree (the standing rule on
a figure relied upon).

### 11.4 What reads it

- **The Money month card and the close:** the source is named on the figure (*stated*, *from balances*, *itemised*), and the cross-check appears
  where balances and a stated spend are both there.
- **The plan against the month (§5):** *Not yet itemised* at the foot of the plan is stated minus itemised for a stated month. Categories show
  their itemised amounts against their own plans, as before.
- **Months of cover (PF-C9):** a stated month is used as stated, and the caveat counts the months by source: *of the last twelve, 4 from balances,
  3 stated, 5 itemised only*. Itemised-only months read low and make the cover read high; stated months are the person's word and are said to be.
- **Overview's *Saved this month* and anything else that reads a month's spent** takes the same function's answer and its label.
- **Not affected:** the FIRE target and the plan's own annual expense (they are planned figures, not what was spent), income, holdings, tax, and every
  month closed from balances.

### 11.5 Data

| Change | Notes |
|---|---|
| `spend_statement` | household, `month` (the first day of the month, checked), `currency`, `amount_minor` (> 0), `note` (optional), `voided_at` and `voided_by` as a pair, `created_by`, timestamps. At most one live row per household, month and currency (a partial unique index where not voided) |

Money is integer minor units in its own currency; the month is IST. The table gets its audit trigger in the migration that creates it, RLS enabled and
forced, explicit grants (select, insert, update; no delete), the second-factor restrictive policy, a line in `reset_demo_household`, and an entry in the
export list. **Access: an owner or a partner reads and writes it; a contributor and a viewer read nothing**, as for the close (§9, decision 5); a
household total is not a contributor's to read. A trigger refuses any update that changes more than the void pair and the note, so a statement is
voided and stated again and never edited. A statement for a month that has not ended in India is refused by the table, against the time of the write: a trigger cannot be passed a date, so this
is the one place the database reads a clock. The app's own checks, and the pure rule that picks a month's source, still take their date as an argument. Every policy has a pgTAP test that proves it denies.

### 11.6 What it does not do

No stated figure per category (the breakdown stays what was itemised, SC-I2). No stated figure for the open month. No "usual monthly spend" applied
to months with nothing: a person states each month, and a standing figure is a later option if it is asked for. It does not change a month closed from
balances, and it does not make a month closeable: a close still needs balances.

## Invariants

**SC-I1 — A closed month's spent is derived from balances and never stored,** and never computed as the sum of entries. (§2)

**SC-I2 — Not yet itemised is a line of its own,** never spread across categories. (§1, §5)

**SC-I3 — When itemised exceeds what left the accounts, both figures are shown and the gap is named;** neither is clamped to the other. (§2)

**SC-I4 — A transfer between the household's own accounts, a card payment, and money into a holding are not in spent.** Extends PF-C10 to the month close. (§2)

**SC-I5 — One payment is one entry:** a matching statement line adds a witness and fills empty fields; it never creates a second entry and never overwrites a field a person typed. (§4)

**SC-I6 — Only a UPI reference or a line hash merges automatically;** a near match is a suggestion that waits for a person. (§4)

**SC-I7 — Share and Paste never save without a tap,** and the app requests no SMS, notification or accessibility permission. (§3)

**SC-I8 — No payee VPA and no full UPI reference is stored:** the last four and a hash. (§4)

**SC-I9 — A month with no close and no stated spend shows itemised figures labelled as itemised,** and months of cover says how many of its months were itemised only, and how many were stated. (§5, §11.4)

**SC-I10 — A recurring rule posts once per due date:** running the poster twice, or on two devices, posts once. (§3)

**SC-I11 — Invested is derived from the holdings' own entries by date,** never from balances and never including market movement. (§10)

**SC-I12 — For a closed month, came in minus spent equals net invested plus paid to loans plus the change in cash reserve, plus card payments in transit where a card closes on its statement date, to the paisa.** (§10)

**SC-I13 — Invested by class adds up to invested,** and its classes are the classes Holdings groups by (HD-I2). (§10)

**SC-I14 — A stated spend is a person's figure for a month that has ended, one live per household, month and currency, and is changed by voiding it and stating again,** never edited in place. (§11.3, §11.5)

**SC-I15 — A month's spent comes from the first available of balances at the close, the stated spend, and the itemised sum; the source is always named, and the three are never added, averaged or blended.** (§11.2)

**SC-I16 — With a stated spend and no close, Not yet itemised is stated minus itemised;** when itemised is more, both are shown and the gap is named, and neither is clamped to the other. (§11.2)

**SC-I17 — Balances beat a stated spend:** a month closed from balances shows the balances' figure, with the stated one beside it as a cross-check that never changes it. (§11.2)

**SC-I18 — Saved from a stated month is labelled rough, and no split into invested, paid to loans and the change in the cash reserve is claimed for it.** (§11.2)

**SC-I19 — A stated spend is read and written only by an owner or a partner,** and a month for which it is stated is not one that has not ended. (§11.5)

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
- SC-I12: the §2 worked example plus a ₹5,000 gold ETF purchase gives saved ₹1,26,580
  = invested ₹57,500 + cash reserve ₹69,080.
- SC-I13: invested by class sums to invested, and a class absent from Holdings
  never appears.
- SC-I14: pgTAP: a second live statement for the same household, month and currency is refused; an update that changes the amount is refused and a void
  is allowed; stating again after a void is allowed; a statement for a month that has not ended is refused.
- SC-I15: pure domain test: the same month with balances, a stated spend and entries returns the balances' figure and names it; without balances, the stated
  one; with neither, the itemised sum; none of them is ever the sum or the mean of two.
- SC-I16: pure domain test: stated ₹82,000 and itemised ₹52,000 gives not yet itemised ₹30,000; stated ₹50,000 and itemised ₹55,000 gives both and the
  ₹5,000 gap, neither clamped; typing the rest (₹30,000) against itemised ₹52,000 saves ₹82,000.
- SC-I17: pure domain test: a month with balances and a stated ₹82,000 shows the balances' ₹91,000 and the ₹9,000 difference.
- SC-I18: pure domain test: a stated month returns saved with the rough label and no invested-plus-loans-plus-reserve split.
- SC-I19: pgTAP: an owner and a partner read and write one; a contributor, a viewer and another household read none and write none.
