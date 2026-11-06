# Gold: physical gold, and gold ETFs and funds

<!-- invariant-prefix: GD -->

How a household records gold. The pictures are the AddGold and GoldPhysical
boards in the Spending capture row of `docs/design/vibrant-canvas.html`; a gold
ETF or fund opens the fund board (HoldingFund). This file is the authority where
they differ.

## 0. What changed, 6 November 2026

The first version of this document centred on the **jeweller's gold savings
scheme**. It was built (#129, #131, #133) and is now **withdrawn by the owner**:
too much to record (terms, bonus, variants, instalment by instalment) for what a
household learns from it. In its place, the two ways most households actually
hold gold:

- **Physical gold**: coins, bars, jewellery. Grams, purity, and what was paid,
  entered either as the price paid or as the rate per gram on the day.
- **A gold ETF or a gold fund**: units, priced like any fund.

Retired with the scheme: GD-I2 (a scheme's value), GD-I4 (as worded for a
scheme), GD-I5 (instalments), GD-I6 (redemption) and GD-I7 (a scheme number).
GD-I1 and GD-I3 stand, with the forms below. A jewellery scheme a household still
runs can be recorded as physical gold on the day it is redeemed, at the bill.

## 1. The kind and its forms

```
instrument.kind       gold                         -- the Gold group, the gold slice, the coin-stack tile
instrument.gold_form  physical | etf | fund        -- null unless kind = gold
```

- **The kind drives allocation, colour and tile; the form drives what is asked
  and how it is valued**, as `scheme` does for deposits (protection-and-flow.md §2).
- **A gold ETF or gold fund is kind `gold`**, not `etf` or `mutual_fund`. Its
  exposure is gold, so the allocation is right only if it sits in the gold slice,
  and it is where a household looks for it. It is still priced as a fund (its
  driver and ISIN) and taxed by its own rule (§5). An ETF or fund already recorded
  with `tax_asset_class = gold` moves to kind `gold`, form `etf` or `fund`, in the
  same migration, with its lots and price untouched.
- **A Sovereign Gold Bond stays as it is** (the demo holds one as `other`). Its
  interest and its exemption at maturity make it a bond in all but exposure, and no
  new tranches are being issued, so it is not a form here.

## 2. Physical gold

**What is asked** (detail-level.md §4: every field stored, whatever the display
setting):

| Field | Notes |
|---|---|
| What it is | short text: *Necklace*, *Coin*, *Bar* |
| Whose | the member |
| Purity | 24K, 22K or 18K |
| Weight | grams, to three decimals, as a bill shows them |
| Bought on | the date |
| Cost | **either** the price paid **or** the rate per gram that day |

**Cost, one figure, either way in.** The form has a two-way switch, *Price paid*
or *Rate per gram*. Whichever is typed, the other is worked out and shown beside
it (₹1,16,400 for 20 g is ₹5,820 a gram). What is stored is the cost of the lot,
in paise, as every lot stores it; a rate typed is multiplied by the grams on the
device and not kept separately.

**Jewellery costs more than its gold.** A price paid includes making charges and
GST, so a necklace's value at the day's rate starts below what was paid. The form
says so under the cost; the detail screen shows *paid* and *value* side by side,
and does not call the gap a loss.

**A gift or an inheritance** is a lot of kind `gift`. Its cost may be left
unknown, and then the Tax screen refuses to compute a gain on its sale and says
why, as it does for any lot without a cost.

**More than one purchase** is more than one lot on the same holding (*Add a
purchase*), each with its own grams, date and cost. **Selling** is a disposal, as
for any holding.

## 3. Valuing physical gold: the rate

**Value = grams × the rate for its purity** on or before the valuation date (GD-I3),
never a typed value.

**The rate is typed, and that is the design, not a stopgap** (the owner, 6
November 2026). An owner or a partner types the day's rate per gram for a purity,
and it is stored as a dated row in a table of the household's own, appended and
never edited. It cannot go in `price`, which is reference data shared by every
household and written only by a driver (`CLAUDE.md`).

**Where the rate comes from: IBJA.** The India Bullion and Jewellers Association
publishes India's benchmark rates every working day, in rupees per gram, for 999
(24K), 916 (22K) and 750 (18K) among others. The RBI prices Sovereign Gold Bonds
from it. It excludes GST and making charges, which is right for valuing gold
already owned. Beside *Update rate* the screen has **Today's rate on IBJA**, a
plain link to `https://ibjarates.com` that opens in a new tab (`rel="noopener
noreferrer"`, nothing of the household's in the URL). The person reads the rate
and types it.

**Nothing fetches a rate**, by decision: not an international metals API (it reads
below the Indian rate, which includes import duty), and not Indian rate websites,
which publish pages, not feeds, and would be screen-scraping (`CLAUDE.md`). If
automation is wanted later, the route is a licensed feed of IBJA's rates.

- The detail screen shows the rate and its date (*22K ₹11,550/g, typed 5 Nov*),
  *Update rate*, and the IBJA link.
- One rate covers every holding of that purity in the household.
- A rate older than thirty days still values the gold, and the date turns amber,
  because the person can put it right.
- No rate at all for a purity: the holding shows its grams and cost and *not
  valued: add today's 22K rate*. It is not counted as zero, and it is not counted at
  cost.

## 4. A gold ETF or fund

Added by name from the AMFI list, as any fund is: the ISIN and the driver come
with it, units and cost per purchase, valued at units × the dated NAV. Everything
the fund screens already do applies. The only differences are the kind (§1) and
the tax class (§5).

## 5. Tax

Three treatments, by form, from `tax_rule` rows (never constants):

| Form | Long term after | Long-term rate | Short term |
|---|---|---|---|
| Physical gold | 24 months | 12.5% | slab |
| Gold ETF (listed units) | **12 months** | 12.5% | slab |
| Gold fund (fund of funds) | 24 months | 12.5% | slab |

The class `gold` already carries 24 months. A **listed gold ETF needs a class of
its own** (12 months, no equity allowance, short term at slab), or the Tax screen
classifies a 14-month ETF sale as short term. These periods are as published
since 23 July 2024; **check them against the Act before the rows are seeded**, and
date the rows as the others are.

## 6. Where it counts

- **Net worth:** every form.
- **Invested** (spending-capture.md §10): a purchase is money into a holding, in
  the Gold class, never spent.
- **Liquid corpus and the emergency goal:** a gold ETF or fund, yes, as any fund.
  Physical gold, no: jewellery is not money that can be had in an emergency at its
  rate.
- **FIRE corpus:** as any holding, unless its goal excludes it (goals.md).

## 7. Taking the scheme out

The scheme is merged and its migration is applied to the live project, so it is
removed by a **new migration**, never by editing `20261102120000_gold.sql`:

1. **Refuse if any household other than a demo one has a `jeweller_scheme`
   holding**, naming how many, so no real record is dropped silently. The owner then
   decides: re-enter it as physical gold, or confirm it can go.
2. Drop `gold_scheme_terms`, its trigger function and its policies.
3. Re-make the `gold_form` check as `physical | etf | fund`, keeping "null unless the
   kind is gold".
4. Move ETFs and funds whose `tax_asset_class` is `gold` to kind `gold` (§1).
5. Add the household gold-rate table (§3), with its audit trigger, RLS, explicit
   grants, the second-factor policy, and a denying test per verb and role.
6. Replace the demo seed and reset: no scheme; one 22K jewellery purchase, one coin
   bought as a gift with no cost, one gold ETF from the AMFI list (its ISIN read
   from the list, not typed from memory), and a typed 22K and 24K rate.
7. The tax rows of §5, once checked.

The app code for the scheme goes with it: its domain module, form, screen,
repository functions, export sheet and tests. A recurring rule that posted scheme
instalments has nothing to post into; the migration archives any such rule.

## 8. Decisions owed to the maintainer

Decided by the owner, 6 November 2026:

1. **The typed household rate** (§3), read from IBJA, with no automatic fetching.
   GD-I3 allows a typed *rate*, never a typed *value*. This closes the open question
   in `docs/decisions.md` (Gold, the first slice).
2. **Gold ETFs and funds as kind `gold`** (§1), and moving the existing ones: the
   owner asked for gold ETFs under gold.
3. **The gold hue, as built** (`--c7`). The `proposed` Departure becomes decided.

Still open:

4. **The listed-gold-ETF tax class** (§5). Claude Code shows the holding periods and
   their sources first, and the rows are seeded once the owner agrees.

## Invariants

**GD-I1 — `gold_form` is set exactly when `kind` is `gold`,** and is one of physical, ETF or fund. (§1)

**GD-I3 — Physical gold is valued at grams × the dated rate for its purity,** never a typed current value; with no rate it is not valued, and says so. (§3)

**GD-I8 — A physical purchase stores one cost:** a rate per gram typed instead of a price is multiplied by the grams, and the stored cost is the same either way. (§2)

**GD-I9 — A gold ETF or fund is valued as a fund,** units × its dated NAV, and is in the Gold group and the gold slice. (§1, §4)

**GD-I10 — Physical gold is in net worth and never in the liquid corpus or the emergency goal;** a gold ETF or fund is in both, as any fund. (§6)

**GD-I11 — Buying gold, in any form, is money into a holding:** in invested, in the Gold class, and never in spent. (§6)

**GD-I12 — A gold rate is a dated row per purity, appended and never edited,** and a value uses the latest on or before its date and shows that date. (§3)

**GD-I13 — A listed gold ETF is taxed by its own rule,** not by physical gold's holding period. (§5)

## Tests

- GD-I1: a gold form on a fund is refused; a gold instrument without one is
  refused; `jeweller_scheme` is refused (pgTAP).
- GD-I3: 20 g at a dated 22K rate of ₹11,550 is valued at ₹2,31,000; with no 22K
  rate it is *not valued*, and net worth leaves it out rather than counting it at
  zero or at cost.
- GD-I8: 20 g with a price of ₹1,16,400, and 20 g with a rate of ₹5,820, store the
  same cost.
- GD-I9: a gold ETF is listed under Gold on Holdings and valued from its NAV.
- GD-I10: the liquid corpus excludes physical gold and includes a gold ETF.
- GD-I11: a gold purchase dated in the month raises invested and its Gold line and
  leaves spent unchanged.
- GD-I12: a second 22K rate on a later date values the same gold higher from that
  date, and the earlier rate is still there.
- GD-I13: a gold ETF sold after 14 months is long term; physical gold sold after 14
  months is short term.
