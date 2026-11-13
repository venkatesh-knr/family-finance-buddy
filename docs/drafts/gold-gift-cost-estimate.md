# DRAFT: a rough cost for a gold gift whose cost is not known

Not applied and not built. For the owner's review (13 November 2026, answer to question 27).

## The problem

A gold gift is a lot of kind `gift`. The tax engine cannot tell a cost of nothing from a cost nobody knows, so a gift with no cost recorded books the whole sale price as a gain. For gold the family often knows the year it was given or bought, and a gram weight, but not the price paid.

## The proposal

Where a gold gift's cost is unknown, offer an **estimate**, never silently:

- **Cost = grams x the year's average price per gram, at the purity held** (24K price x purity / 24, as `src/domain/gold.ts` already works purity).
- The year is the year the **previous owner bought it** where the family knows it, and otherwise the year of the gift. Under the Income-tax Act a gifted asset takes the previous owner's cost and holding period, so the earlier year is the right one.
- The lot is **marked as an estimate** on its own screen and in the Tax screen's working, with the year and the price used, and the owner or partner can replace it with a real figure at any time. A sale made from an estimated lot says its gain rests on an estimate.
- Before 1 April 2001 the Act lets the owner use the fair market value on 1 April 2001 as the cost. The table has no 2001 row for that date; the 2001 average is the nearest.

## Rough yearly prices, 24K gold, rupees per 10 grams

Collected on 13 November 2026 from secondary sources (BankBazaar, Stablemoney, Upstox quoting Forbes, Choice India, OdishaTV). **They disagree with each other by a few per cent in several years, and some years are missing.** The RBI's Handbook of Statistics publishes an annual Mumbai average and would be the series to adopt, since it is one consistent source. Treat every figure below as indicative.

| Year | Per 10 g | Year | Per 10 g | Year | Per 10 g |
|---|---|---|---|---|---|
| 2000 | 4,400 | 2009 | not found | 2018 | 31,438 |
| 2001 | 4,300 | 2010 | 18,500 | 2019 | 35,220 (one source: about 39,000) |
| 2002 | 4,990 | 2011 | not found | 2020 | 48,651 (one source: 50,151) |
| 2003 | 5,600 | 2012 | 30,859 | 2021 | 48,720 |
| 2004 | 5,850 | 2013 | not found | 2022 | 52,670 |
| 2005 | 7,000 (one source: 7,638) | 2014 | not found | 2023 | 65,330 |
| 2006 | not found | 2015 | about 26,343 | 2024 | 77,913 |
| 2007 | 10,598 | 2016 | 28,624 | 2025 | sources conflict: 1,03,870 to about 1,23,000 |
| 2008 | not found | 2017 | 29,668 | | |

For a missing year the estimate would take the average of the years either side and say so. 2025 should not be used until one source is chosen: the higher figures look like late-2025 prices and not a full-year average.

## Worked example

A necklace of 40 g at 22K, given in 2012. 2012 average 30,859 per 10 g (24K) gives 3,085.9 per g; at 22/24 purity that is 2,828.6 per g; times 40 g is about **₹1,13,000**. Sold in 2026 for ₹4,00,000, the gain would be about ₹2,87,000, taxed under the rules for the year of sale, instead of ₹4,00,000 with no cost. It is a rough figure, and the screen would say so.

## What it needs, if the owner wants it

1. A place for the estimate: a lot of kind `gift` with an `estimated` flag and the year used, or a household table of typed gold prices by year (the existing `gold_rate` is by date, so a yearly row could reuse it).
2. The price series as data (rows with an authority and a date checked, like `tax_rule`), not constants in code.
3. The tax engine to treat an estimated gift lot as costed and flag the gain as resting on an estimate.
4. Whoever finalises the return checks the estimate against what the rules for the year of sale allow for a gifted asset whose cost is not known.

None of it is built.
