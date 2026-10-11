# Protection, schemes, earmarks and flow

Adds insurance, the Indian small-savings schemes, an emergency-fund marker, and
income to the app. Written before any of it is built, so the arguments are
visible and can be disagreed with.

The request arrived as seven items. They are four shapes, and most of the
design work is in not treating them as seven.

| asked for | actual shape | where it lives |
| --- | --- | --- |
| medical insurance, term insurance | pure protection — a premium and a cover, no value | new `policies` table |
| ULIP, LIC endowment, money-back | hybrid — premium, cover, **and** a surrender value | `policies` + a linked holding |
| RD, SSY, NSC, KVP, SCSS, POMIS, PO TD | deposits with different rules | existing `holdings`, new `scheme` column |
| emergency fund | not an instrument — a label on one | existing `holdings`, new `earmark` column |
| income / expense / savings | a ledger the app does not have | new `income` table, Overview rework |

## 1. Protection is not an asset

A term policy has no value. A health policy has no value. What they have is a
**cover** — a number that is not money you own and must never be added to money
you own.

The failure this guards against is not a ₹0 row looking untidy. It is a person
opening "add holding", seeing a value field, and typing ₹1,00,00,000 because
that is the number printed on the policy. Net worth jumps by a crore, the figure
still looks plausible, and nobody catches it. A household could plan around that
number for a year.

So the rule is structural, not a convention anybody has to remember:

> **`policies` has no value column.** Not a nullable one, not one defaulting to
> zero. Cash value, where it exists, lives on a linked row in `holdings`, and
> net worth is computed from `holdings` only — as it already is.

Cover is stored on the policy, displayed on the Insurance screen, and is never
an input to any net-worth, allocation or FIRE calculation. If a future
calculation wants it, that is a conversation, not a patch.

### A ULIP is two records

An endowment or ULIP policy gets a row in `policies` (cover, premium, renewal)
and, because it has a surrender value, a linked row in `holdings` carrying that
value. One row cannot do both: the fields do not overlap, and the two numbers
behave differently.

The premium is an expense. All of it, including the part that buys units — the
same reasoning that already makes a card repayment not an expense: each rupee is
counted once, where it leaves the household. The surrender value is an asset.
There is no double count, because one is flow and the other is stock.

What this makes visible, and should be shown on the policy, is the gap between
**cumulative premiums paid** and **current surrender value**. For the first five
to seven years of most such policies that gap is large and negative. That is the
cost of the protection plus the cost of the product, and it is the single most
useful thing the app can tell someone who holds one. It is not editorial to show
it; the two numbers are both facts.

## 2. Schemes are not kinds

RD, SSY, NSC, KVP, SCSS, POMIS and post office TD are one asset class. They
differ in lock-in, maturity, compounding and tax section — none of which belongs
in an allocation chart.

```
kind    = deposit                         -- drives allocation, colour, tile
scheme  = fd | rd | ppf | ssy | nsc | kvp | scss | pomis | po_td | other
```

Seven new kinds would put seven slices on the allocation donut that are all the
same thing, and would need seven ramp colours the palette does not have — the
ramp is seven hues total and five are already spoken for.

`scheme` is nullable and only meaningful when `kind = deposit`. A check
constraint should say so, rather than leaving a scheme on an equity row to be
discovered later.

What scheme earns you: a maturity date the Calendar can surface, a lock-in the
FIRE projection must respect, and a tax section the Tax screen can group by.
Those are three real features that seven kinds would not have given.

## 3. Earmarks — the part that was under-asked

The request was a marker for the emergency fund. The same field answers a
question the app currently answers wrongly.

```
earmark = emergency | retirement | child | house | none      -- at most one
```

Today FIRE counts the whole corpus. It should not. The emergency fund is not
retirement money — spending it is the point. SSY is the daughter's and is
legally locked until she is 18 anyway. A house deposit is already committed.
Counting all three toward financial independence overstates the number, and an
overstated FIRE figure is the most consequential wrong number this app can show,
because someone might act on it.

> **Holdings earmarked `emergency`, `child` or `house` are excluded from the
> FIRE corpus.** `retirement` and `none` are included. The FIRE screen states
> the exclusion and its total, so the number is explainable rather than
> mysterious.

This is a correction to existing behaviour, not only a new feature. It will make
the FIRE number go **down**, and the screen should say why the first time it
changes.

### Months of cover

The emergency fund gets a target in months, not rupees — a rupee target set
against 2024 spending quietly becomes four months of cover instead of six.

```
months_of_cover = sum(earmarked 'emergency') / trailing_avg_monthly_expense
```

Two rules about the denominator, both of which exist to stop the app stating a
confident wrong number:

- **Trailing window: 12 months**, or all available data if less.
- **Fewer than 3 complete months of expense data → show nothing.** Not zero, not
  "∞", not a number computed from six weeks. An empty state that says "needs
  three months of spending history" is correct; a figure derived from one
  unusual month is not.

A household with no expense history will hit this, so the empty state is the
common case at first run and deserves to be designed, not defaulted.

## 4. Income, and what "savings" means

Both definitions ship, labelled, because they answer different questions and
disagree in an informative way.

| shown as | computed | answers |
| --- | --- | --- |
| **Saved this month** | income − expense | did we live below our means |
| **Net worth change** | Δ net worth over the period | did our position improve |

The gap between them is market movement, and a month where you saved diligently
and the market fell is exactly the month a household needs to see both. Showing
one labelled as the other is the thing to avoid.

`income` needs: amount, date, category (`salary`, `rent`, `interest`,
`dividend`, `capital_gain`, `business`, `gift`, `other`), earner attribution
(same member model as expenses), and a recurring flag.

### The transfer rule

> **Moving money between the household's own accounts is neither income nor
> expense.** Salary into an RD is not spending. An FD maturing into a savings
> account is not income.

This is the same invariant as "a card repayment is never an expense", and it
will be got wrong in the same way, because bank-statement import sees a debit
and a credit and has no idea they are the same rupees. When bank import lands
(Stage 5), transfer detection is part of it, not a follow-up.

### Interest that accrues but is not credited

PPF, SSY, NSC and KVP accrue annually. Two consistent options: mark the holding
up notionally each month, or step it at credit. Either is defensible; mixing
them is not, because it makes the net-worth trend lie about when growth
happened. **Pick step-at-credit** — it is what the passbook says, and a trend
line with visible steps is honest about a product that genuinely pays once a
year. Record the choice in `tokens.md`'s sibling for data rules, wherever that
ends up living.

## 5. The cover gap, and the line the app must not cross

The Insurance screen answers one question beyond storage: is the household
under-covered? That question is why the screen earns a place in the nav.

```
suggested cover = outstanding liabilities
                + (annual expenses × years of dependency)
                − liquid corpus
gap             = suggested cover − total term cover in force
```

**Every input is a household setting with a visible default, not a built-in
rule.** Years of dependency especially: the app does not know how old the
children are or when the mortgage ends. The screen shows the arithmetic with the
assumptions on the face of it, and the household can change any of them.

The app states a calculation, never a recommendation. The existing FIRE screen
already has this exact posture — *"Assumes contributions continue at today's
rate. Not a forecast."* — and the Insurance screen takes the same tone. We are
not licensed to advise anyone on how much life insurance to buy, and a number
that looks like advice will be read as advice.

Health cover gets no suggested figure at all. The honest version is a list of
what is in force, with renewal dates, and the sum insured per member. Any
"recommended health cover" number would be invented.

## 6. Screens and navigation

**No new dashboard.** Overview *is* the dashboard — income, expense, savings,
net worth and debts is the definition of one. A second summary screen creates
two screens competing to be the top of the app, which is finding 1 in
`ui-review.md` (competing hero figures) reproduced at the navigation level.

What Overview needs is a distinction it does not currently draw:

```
stock  — a moment in time   : net worth, debts, allocation
flow   — a period           : in, out, saved, this month
```

Proposed Overview order, phone width:

1. **Net worth** — the one hero, unchanged. The only lifted surface on the
   screen; `theme.spec.ts` already enforces that there is exactly one.
2. **This month** — a three-up band: in, out, saved. Flat, not lifted. Period
   switcher (month / quarter / FY) belongs here, not at screen level.
3. **Emergency fund** — months of cover, one line, or the empty state.
4. **Allocation** — unchanged.
5. **Protection** — one line: total cover in force, and the gap if there is one.
   Taps through to Insurance.
6. **Needs attention** — unchanged, and the natural home for a renewal due in
   under 30 days.

**One new screen: Insurance.** It has fields nothing else has and answers a
question nothing else answers. It does not go in the bottom bar.

**No new screen for deposits.** Holdings with a scheme filter.

### The bar

Five slots, ordered by how often a person actually opens them:

```
Overview · Money · Holdings · FIRE · More
                                     └─ Tax, Insurance, Calendar, Profile, Settings
```

Two consequences worth naming. **The Expenses screen becomes Money** — once
income is recorded there, the name is wrong, and a screen called Expenses that
contains income is the kind of thing people stop trusting. **Tax moves into
More** — it is a quarterly screen holding a daily slot.

## 7. Build order

Three slices. They are independent enough to land separately and should.

**Slice B — schemes and earmarks.** Two nullable columns, a check constraint, a
Holdings filter, the FIRE exclusion, the months-of-cover line. No new table, no
new RLS surface. It is the cheapest of the three and the only one that *fixes*
something: FIRE is overstating today.

**Slice A — flow.** The `income` table, the transfer rule, the Overview
stock/flow split, the Money rename. New table, real RLS work, the largest UI
change. Highest daily value once it lands.

**Slice C — protection.** `policies`, the Insurance screen, the cover gap, the
renewal reminder into Needs attention. Largest new security surface — a new
table with its own policies and its own pgTAP suite — and the most sensitive
data in the app so far: policy numbers and nominee names.

**Recommended order: B, then A, then C.** B first because a wrong number in
production outranks a missing feature. C last because it deserves to land when
there is time to test the RLS properly, not squeezed behind a UI change.

The argument for moving C earlier is real and worth hearing: the data entry is
one-time, the renewal reminder starts paying immediately, and a lapsed health
policy is a worse outcome than a slightly overstated FIRE figure. If that
argument wins, C and A swap. B stays first either way.

## 8. Tests that must exist before each slice is done

Policy-level, in pgTAP, for slice C:

- A member of household X cannot select, insert, update or delete a policy in
  household Y. Every verb, not just select.
- Policy number and nominee are not readable cross-household — they are the most
  sensitive columns the app has held so far and deserve their own assertion
  rather than relying on the table-level one.

Unit:

- A policy with no linked holding contributes exactly 0 to net worth. Assert the
  total, not the absence of a column.
- Earmarked `emergency` / `child` / `house` holdings are excluded from the FIRE
  corpus; `retirement` and `none` are included.
- A transfer between two household accounts appears in neither income nor
  expense totals.
- `months_of_cover` returns null — not 0, not Infinity — with fewer than three
  complete months of expense data, and with a zero denominator.
- `scheme` is rejected on a holding whose kind is not `deposit`.
- Every `scheme` value resolves to a label; every `earmark` value resolves to a
  label. Iterate the enum, as with icon kinds.

E2E:

- Overview renders stock and flow as distinct regions, each with its own
  accessible name.
- Still exactly one lifted surface per screen after the Overview rework —
  `theme.spec.ts` covers this already and must not be relaxed to accommodate the
  new band.
- Privacy mode hides income and cover amounts, by absence from the DOM, on the
  same terms as every other figure. Cover is a rupee amount and is not exempt.

## 9. Open

- Whether `child` should split into `child_education` and `child_marriage`. SSY
  is sold against both. Probably not worth two values until something treats
  them differently.
- Joint policies covering two members — a cover attributable to more than one
  person. Deferred; single-life first.
- Whether a matured deposit auto-creates an income row for its interest, or
  waits to be entered. Auto is convenient and is also how a ledger quietly
  fills with rows nobody checked.
