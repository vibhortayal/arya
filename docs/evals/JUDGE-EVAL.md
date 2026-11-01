> Staple-judge evaluation, 2026-10-27, on the owner's own 114 Costco receipts
> (shared with the owner's approval). The raw receipts and state files are not in this repo.

# Staple-judge accuracy — one defensible number

**Headline: precision 0.79 (41 of 52).**
One-sentence definition the submission may quote: *"Of the 52 items Arya's
staple judge admitted to the self-writing list, 41 (79%) were independently
corroborated as behavioral staples by purchase cadence alone — bought on at
least 4 separate receipts spanning at least 3 different months, returns
netted — with no human labels involved."*

Quotable form: **"Judge precision 79% against a cadence-derived ground
truth (41/52 admits corroborated); the 11 uncorroborated admits are
dominated by slow-cycle consumables bought 3 times, and only one admit
(Reynolds Foil, 2 buys 703 days apart) is a clear error."**

## Method (stated before the numbers)

- **Data.** The owner's live state, copied read-only from the Oracle VM
  (Docker volume `arya-data`, per-user dir): 114 real Costco receipts,
  2023-10-25 → 2026-10-26; the dictionary (458 entries); and `judged.json`,
  the judge's cached verdicts. No model calls were made; spend $0.
- **Identical pipeline.** The analysis re-ran the app's own code on the
  copies — ledger build (discounts folded, fee SKUs excluded), dictionary
  grouping (Curator merges applied), and the pattern engine's returns
  netting (FIFO, kept quantity only, FOR-OTHERS lines excluded). Item
  identities are therefore exactly the identities the judge saw.
- **Admitted set.** Items whose cached verdict has `list_ok = true`
  (class STAPLE, or SEASONAL). 156 raw verdicts collapse to 155 distinct
  grouped items under the current group map (one Curator merge); 52 of
  them are admitted (43 STAPLE, 9 SEASONAL).
- **Ground-truth proxy (behavioral staples).** An item is a proxy staple
  if, after returns netting, it was bought on **≥ K distinct receipts**
  spanning **≥ M distinct calendar months**. Primary setting **K=4, M=3**.
  Justification: the corpus holds ~3 receipts/month over 36 months, so
  4 separate trips in 3 different months is the weakest pattern that
  excludes one-trip stock-ups, gift/event buys, and two-trip trials, while
  still catching a quarterly Costco rhythm. The judge's own eligibility
  bar is 2 buys, so the proxy is deliberately stricter than the judge —
  it corroborates; it does not re-derive the judge's rule.
- **Metrics.** Precision = admitted ∩ proxy / admitted. Recall =
  admitted ∩ proxy / proxy. Disagreements are listed by name below; the
  names matter more than the decimals.
- **What this number is NOT.** It is not accuracy against a hand-labeled
  gold set — no such set exists for this household. It measures agreement
  between a reasoning judge and an independent cadence proxy. Where they
  disagree, either can be "right"; the disagreement lists say which, case
  by case.

## Results

| Proxy | Proxy staples | Precision (all admits) | Precision (STAPLE only) | Recall |
|---|---|---|---|---|
| K=3, M=2 | 88 | 51/52 = **0.98** | 0.98 | 0.58 |
| **K=4, M=3 (primary)** | 55 | 41/52 = **0.79** | 0.74 (32/43) | 0.75 (41/55) |
| K=6, M=4 | 35 | 33/52 = 0.63 | 0.65 | 0.94 |

At the primary setting: all **9 SEASONAL admits are corroborated (9/9)**.
Every disagreement below is at K=4, M=3.

## Disagreements at the primary setting

### Judge admitted, proxy does not corroborate (11 of 52)

Ten of the eleven miss the bar by exactly one receipt or one month. All
eleven are slow-cycle or short-window items where the judge's stated
reason is plausible on its face:

- **Three buys, three months (7):** Avocados; Hand Wash; Kirkland
  Signature Bodywash; Kirkland Signature Pink Salt; Lubriderm; Organic
  2% Milk; Power Up Mega Omega Trail Mix. Soap, lotion, salt and foil are
  bought rarely *because* they last; a cadence bar built for food
  under-counts them. Avocados (Nov 2023–Jan 2024, then nothing) is the
  weakest of this group in hindsight.
- **Four buys inside two months (3):** Kirkland Signature Butter Quarters,
  Kirkland Signature Organic Whole Milk, Mini Cukes — a genuine
  every-~2-weeks rhythm in Nov–Dec 2023 that does not reappear under the
  same SKUs later in the corpus (bought elsewhere, or re-SKU'd).
- **The one clear error (1):** Reynlds Foil — 2 buys, 703 days apart,
  judged STAPLE ("long-life foil rebought"). It is also the only
  uncorroborated admit under the looser K=3, M=2 proxy.

### Proxy staple, judge kept off (14 of 55)

All fourteen carry the class OCCASIONAL, and every judge reason cites gap
irregularity: Buter Croiss (5 receipts), Cantaloupe (6), KS Lightly
Breaded Chicken Breast Chunks (5), KS Pine Nuts (4), KS Pistachio (5),
KS Towel (5), KS Walnuts (6), Mixed Pepper (4), Nmcholstoff+ (4),
Organic Broc 2Lb (4), Organic Brussels (4), Organic Gre Bean (4),
Pumpkin Seed (5), Red Onions (4). None were left unjudged — the judge
saw all of them and declined. This is the product's stated policy made
visible (precision over recall: a missed item costs the user one tap, an
unnecessary suggestion costs trust). Twice-a-year pantry goods (walnuts,
pistachios, pine nuts, pumpkin seeds) are the arguable cases: a human
might call them staples; the judge calls a 150–250-day median gap
"occasional," and under its own prompt that is a defensible call.

## Second signal: owner behavior

- **Flags:** the owner's state has no `flags.json` — he has recorded no
  list edits (no "never suggest", no dismissals, no manual adds) against
  the judge's output. There is therefore no owner-vs-judge settlement
  signal to report; absence of overrides is noted, not scored.
- **The live list:** the cart prepared from the current smart list holds
  5 items. The 4 pattern-surfaced items — Organic Raspberry, Mandarins,
  Kirkland Signature Almonds, Slice Almond (the list that went 16 → 4 in
  the first judge sweep) — are **all corroborated proxy staples at the
  primary setting (4/4)**. The fifth, Power Up Mega Omega Trail Mix, is
  judge-admitted (STAPLE, 3 buys at a 23-day median gap) and sits in the
  proxy-miss group above by one month of spread — owner behavior (it is
  on his active list, qty 2) sides with the judge.

## Sensitivity and how to read the headline

The precision figure is definition-sensitive by construction: loosen the
proxy to K=3, M=2 and precision rises to 0.98 (with recall falling to
0.58 — the judge is far more selective than a loose cadence bar); tighten
it to K=6, M=4 and precision falls mechanically to 0.63, because a
heavier proxy excludes mid-frequency items the judge reasonably admits.
K=4, M=3 was fixed before the results were seen, as the weakest bar that
still excludes stock-ups and trials; 0.79 is quoted with that definition
attached, never bare.

## Caveats

- One household, one retailer (Costco), 114 receipts. Staples bought at
  other stores are invisible to both the judge and the proxy.
- Verdicts are cached at the buy-count current when judged (re-judging
  triggers at +2 buys); the proxy uses final corpus counts. A verdict can
  therefore predate an item's later purchases — this cuts against the
  judge in the recall direction only.
- Grouping is the Curator's current grouping; a wrong merge would move
  both sets together, so grouping errors mostly cancel in precision.
- SEASONAL admits are month-gated in the live list logic; this eval
  scores the judge's `list_ok`, which is the judge's own decision, not
  the seasonal gate's.

*Analysis: analysis script and state copies are kept out of the repo (owner data).*
