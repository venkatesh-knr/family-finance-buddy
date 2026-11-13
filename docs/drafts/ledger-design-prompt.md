# Prompt for Claude Cowork: design the money ledger and income capture

Paste this into Claude Cowork with the files listed under "Read first" attached. It is self-contained. It asks for a design (a document and boards), not code.

---

You are the designer for **Family Finance Buddy**, a family finance app for an Indian household (a static web app on a database with row-level security; Indian and US taxes; nine asset classes; FIRE targets). Your job is to **design the money screen as a ledger of credits and debits, and how income is captured**, so that the monthly view, the Tax screen and FIRE each get the income figure they need. This is design only. Do not write app code or migrations.

## Read first (attached)

1. `CLAUDE.md` (the rules, invariants and conventions that every design must respect)
2. `docs/design/simple-layout.md` (the layout rules: soft panels, underline fields, stepped forms, tabs; **use it as the template for the design document you write**)
3. `docs/tokens.md` and `docs/design/icons.md` (colour, type, spacing, icons: values come from here)
4. `docs/design/spending-capture.md` (the month close, how spent is derived, the witness model, section 10 on the month's money)
5. `docs/design/protection-and-flow.md` (slice A, Flow: income, accounts, transfers)
6. `docs/design/vibrant-canvas.html` (the boards: copy their markup style, 390px phone boards, dark, and the Mist light theme)
7. `docs/drafts/income-design.md` (the two options considered; the owner chose Option B)
8. `docs/decisions.md`, the section "The owner's answers to the open questions (13 November 2026)"
9. `docs/blueprint.md` sections 04 (data model), 11 (roles), 17 and 20 (privacy), and `docs/build-plan.md` step 6a

## What the owner has already decided (do not reopen these)

- The money screen is a **ledger of credits and debits**. A **debit** is what is spent. A **credit** is money in, with a category (Salary, interest, rent, refund, dividend, other). A move between the household's own accounts, a card payment and money into a holding are in neither.
- **Take-home is the credit marked Salary**, exactly as the bank received it, after tax, PF and every other deduction. Deductions are not recorded.
- **FIRE reads income as the highest Salary credit among the months entered, times twelve.** It is never grown by inflation; it changes only when a higher credit is entered.
- **The Tax screen gets a gross salary typed by hand, once a year, per member**, from the payslip, and the person may correct it later from Form 16. It is **stored** per member and tax year (the Tax card must stop forgetting what was typed). Other income and tax already deducted (TDS) are optional there. The ledger does not feed it. CTC is not taxable gross: say so beside the field.
- **The "put away through payroll" line (employee PF) is dropped.** The invariant SC-I14 and the matching paragraph of `spending-capture.md` section 10 are withdrawn: your document says what replaces them.
- Income is **private by default** (blueprint section 20), with a sum function so the household total can include another member's private income without detail. A contributor sees their own; a viewer sees none.
- A **realised capital gain is not income**: it is derived from lots, used in the tax view, never stored and never added to income or to "saved". A sale's proceeds are already counted as money taken out of holdings.
- **Money kept in a savings account is a legitimate cash reserve**, not money that still has to be invested. The month's view calls it the cash reserve and never says "not yet invested" or "left in the bank".
- The month's view offers **This month and Last month** as a two-option control, with the current month marked month to date.
- Sections are **soft panels** (filled, no outline, no shadow, 16px corners, 10px of page between them, rows divided by hairlines, nothing filled or outlined inside a panel). Inputs are **underline fields**; adding things is a **stepped form**; required fields carry an **asterisk in the attention colour** announced as required, with one line of key per form and no "required" word beside each field.
- The share target and Paste are **not** to be built. No Excel library for now. A UPI reference is stored as its last four and a hash.
- **Undecided, so propose and ask:** whether the screen's label becomes "Money" (label only, or label and route), and what a recurring rule that posts a salary credit looks like (the recurring rules already built post expenses on a due day).

## What to produce

1. **A design document, `docs/design/ledger-income.md`**, in the style of `simple-layout.md`: why, the screens, the rules, then **invariants with the prefix `LI`** (`LI-I1`, `LI-I2`, and so on, each one sentence, each with the section it comes from), then **a Tests section**, one test idea per invariant. It must cover:
   - the ledger entry (a direction, a category, an amount in integer minor units and a currency, a date in IST, a member, an account, a visibility, a source such as typed, rule or import) and how it relates to the existing expense entries;
   - how the month's income, spent and saved are worked out, and how that fits the month close of `spending-capture.md` (spent is derived from balances and is never stored);
   - the Tax yearly inputs (gross salary, other income, TDS, per member and tax year) and how Form 16 corrects them;
   - how FIRE reads income (the rule above) and what it shows when nothing is recorded;
   - the recurring salary credit;
   - privacy, roles and the sum function, and the obligations every new table carries (audit trigger, row-level security, explicit grants, a denying test per verb, `reset_demo_household`, the export list);
   - what changes in `spending-capture.md` section 10 and the invariants SC-I12 and SC-I14.
2. **Boards in the canvas format** (inline-styled, 390px wide, dark, and a Mist light version of the main one), with these ids: `MoneyLedger` (the month's ledger: This month | Last month, credits and debits, income / spent / saved), `MoneyLedgerLight`, `AddCredit` (a stepped form), `SalaryRule` (the recurring salary credit), `TaxIncomeInputs` (the yearly gross, with the payslip and Form 16 hint and the CTC note), `FireIncome` (the read-only income line with where it came from), and `MonthMoney` redrawn for the cash reserve wording. Follow the tokens exactly; meaning is never in colour alone; nothing fixed-height holds text (it must survive 200% text size).
3. **A conformance list**: every existing screen that changes (Expenses, Tax, FIRE, the Overview's month's money) and each difference between your boards and the built app as a **proposed** Departure with its reason, in the table format of `docs/design/conformance.md`. Do not mark anything decided.
4. **A short list of questions for the owner** at the end, for anything you had to assume. Ask them before you finish; do not invent decisions.

## How to work

- State your assumptions as you go and list them at the end. Where a rule in `CLAUDE.md` or the specification conflicts with this prompt, say so and ask.
- Cover the awkward cases in the document: a reimbursement, a refund, a joint account, cash, a salary that arrives in two parts, a month with no salary credit, a bonus (a credit that is not Salary), the first month of use, and a credit that is really a transfer between the household's own accounts.
- Keep the document and boards consistent with each other. Number the boards' states so a developer can build from them.
- Output the files and nothing else: the document, the boards (one HTML file in the canvas format), the conformance list and the questions.
