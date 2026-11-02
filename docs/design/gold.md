# Gold, and the jeweller's gold savings scheme

<!-- invariant-prefix: GD -->

Adds gold as a holding kind, starting with the gold savings scheme a household
runs with its jeweller. The picture is the gold scheme board in the Spending
capture row of `docs/design/vibrant-canvas.html`; this file is the authority where
the two differ.

## 1. Why now

The blueprint makes gold a first-class class (§01: one of the nine; §07: "Gold at
5–15% is the Indian convention"), and its contribution table already lists *Gold
Savings — Monthly* beside PPF and RD. Nothing in the app can hold it. An
instalment entered as an expense loses ₹5,000 a month from savings; entered as a
deposit, it is coloured and allocated as debt. Neither is true, and
spending-capture.md §10 needs every rupee put into a holding to land in the
right class.

## 2. The kind

```
instrument.kind      gains  gold                -- hue --c3, the coin-stack tile (icons.md §4)
instrument.gold_form        jeweller_scheme | physical      -- null unless kind = gold
```

- **The kind drives allocation, colour and tile; the form does not**, exactly as
  `scheme` does for deposits (protection-and-flow.md §2). Both forms are in the
  Gold group on Holdings and the gold slice of the allocation.
- **`physical` is here because a scheme ends in it** (§5). Sovereign gold bonds
  and digital gold are later forms, named here and not built.
- **A gold ETF or a gold fund stays `etf` or `mutual_fund`.** A wrapper is taxed
  and priced as what it is (blueprint §09), and the NAV driver already prices it.
- Wiring the kind means it appears in pickers, legends and filters (icons.md §4
  says it must not until then).

## 3. The scheme

A fixed instalment paid to a jeweller each month for a fixed number of months. At
the end the jeweller adds a bonus (commonly one instalment, sometimes a discount
on making charges), and the total is **redeemed as jewellery, not cash**. Two
variants, because they are valued differently:

| Variant | Each instalment | Value now |
|---|---|---|
| `amount` | adds rupees | instalments paid |
| `weight` | buys grams at that day's rate | grams × today's rate for its purity |

**Terms captured** (every one, whatever the detail level, detail-level.md §4):
jeweller, member, variant, instalment amount, number of instalments, start date,
due day, the bonus as stated (an amount, *one instalment*, or a making-charge
discount as text), the purity (weight variant), and the scheme number's **last
four**. Each instalment is an entry with date, amount and, for the weight
variant, the grams on its receipt.

**What the screen states** (the board):

- Paid so far, the instalments left, and the next due date.
- **At maturity, the redeemable total**, labelled *if every instalment is paid*.
  The bonus is not in the value or net worth until it is credited, as PPF interest
  steps at credit (PF-C11).
- A missed instalment, in amber because the person can put it right: *Instalment
  for 10 October not recorded. Record it, or the bonus may not apply.*
- The caveat, always: **held by a jeweller, not a bank, and redeemable only as
  jewellery.**

## 4. Where it counts

- **Net worth:** yes, at the value in §3.
- **Liquid corpus and the emergency goal:** no. Jewellery is not money that can be
  had in an emergency at its face value.
- **Invested** (spending-capture.md §10): each instalment is money into a holding,
  in the Gold class. **Never spent.** A recurring rule posts it as an instalment on
  the holding, not as an expense.
- **FIRE corpus:** as any holding, unless its goal excludes it (goals.md).

## 5. Redemption

Redeeming closes the scheme. The jewellery bill splits in two:

- **The gold value on the bill** becomes a `physical` gold holding with the grams
  and purity from the bill. That is a conversion within the Gold class, neither
  *put in* nor *taken out*.
- **Everything else on the bill** (making charges, GST, stones) is **spent**, in
  the month of the bill. That is the part that was consumed.

Where the scheme's total is more than the gold value, the difference paid for
the non-gold part of the bill and counts as **taken out** of holdings. Where the
bill is larger than the scheme's total, the rest came from an account. Either
way, *saved = net invested + change in cash reserve* still holds
(spending-capture.md §10). The bonus, credited at maturity, is growth, as interest
is, and is never *put in*.

## 6. Data

| Change | Notes |
|---|---|
| `instrument.kind` | gains `gold` |
| `instrument.gold_form` | `jeweller_scheme`, `physical`; check: null unless kind is `gold` |
| `gold_scheme_terms` | holding, variant, jeweller, instalment, count, start date, due day, bonus text, bonus amount (nullable), purity, `scheme_last4` |
| instalments | lots on the holding: `kind = purchase`; quantity is grams for `weight`, rupees otherwise |
| `price` | a dated gold rate per purity. The driver is the blueprint's gold job; until it exists, the existing manual override |

Same rules as every new table: audit trigger, RLS enabled, explicit grants, the
second-factor policy, cleared by `reset_demo_household` and seeded, all in the
same migration. The demo household gets one amount-based scheme, five of eleven
instalments paid.

## 7. Decisions owed to the maintainer

1. **Cost basis of the physical gold after redemption.** Proposed: the gold value
   on the bill, acquired on the redemption date. A tax rule depends on it, so the
   Tax screen refuses a sale of it until this is decided.
2. **Seed values.** The demo's jeweller is fictional, and its bonus is one
   instalment.

## Invariants

**GD-I1 — `gold_form` is meaningful only when `kind` is `gold`,** and a holding of any other kind is refused one. (§2)

**GD-I2 — An amount-based scheme's value is the instalments paid;** the bonus enters value only when it is credited at maturity. (§3)

**GD-I3 — A weight-based scheme and physical gold are valued at grams × the dated rate for their purity** from the price table, never a typed current value. (§3, §6)

**GD-I4 — A gold scheme is in net worth and never in the liquid corpus or the emergency goal.** (§4)

**GD-I5 — An instalment is money into a holding:** it is in invested, in the Gold class, and never in spent. (§4)

**GD-I6 — Redemption converts:** the bill's gold value becomes a physical gold holding and is neither put in nor taken out; only the rest of the bill is spent, and any of the scheme's value that paid for it is taken out. (§5)

**GD-I7 — A scheme number keeps its last four digits only.** (§3)

## Tests

- GD-I1: a gold form on a deposit is refused (a schema constraint, in pgTAP).
- GD-I2: five ₹5,000 instalments of an eleven-month scheme with a one-instalment
  bonus is valued at ₹25,000, and at ₹60,000 only after maturity is recorded.
- GD-I3: a weight scheme of 4.2 g at a dated 22K rate is valued at the product,
  and changes when a new rate is dated, with no entry changed.
- GD-I4: the liquid corpus and the emergency goal exclude the scheme; net worth
  includes it.
- GD-I5: an instalment raises the month's invested and its Gold line, and leaves
  spent unchanged.
- GD-I6: a ₹68,000 bill with ₹58,000 gold value, redeemed from a ₹60,000 scheme
  with ₹8,000 from an account, creates a ₹58,000 physical holding, ₹10,000 spent
  and ₹2,000 taken out, and the month still satisfies SC-I12.
- GD-I7: no column holds more than four digits of a scheme number.
