# Gate 0 — Public Photo-Receipt Fixture Set: Report

Date: 2026-10-27. Model: muse-spark-1.3 (Standard), temperature 0.1, SYSTEM prompt taken verbatim from `spike2/decode_photo.py`. Labels were written by hand from the photos BEFORE any decode ran. Each decode call was stateless.

## Verdict

| Set | Lines correct / labeled | Accuracy | vs 90% gate |
|---|---|---|---|
| Public set (identity metric) | 90 / 98 | 91.84% | PASS |
| Public set (strict-string metric) | 80 / 98 | 81.63% | FAIL |
| Combined: owner subset (32/32) + public (identity) | 122 / 130 | 93.85% | PASS |
| Combined (strict-string) | 112 / 130 | 86.15% | FAIL |

Two metrics are reported because the task rule ("product identity matches the printed identity, allowing spacing/case differences only") and the decode prompt pull in opposite directions: the SYSTEM prompt itself instructs the model to expand brand abbreviations when confident (GG = Green Giant is its own example). The **identity metric** counts a line correct when the decoded product is the same product as printed (abbreviation expansions such as Bh → Boar's Head, BC → Betty Crocker, KS → Kirkland Signature, and word reordering from the brand/product/detail field split are accepted) AND the paid price is exact. The **strict-string metric** accepts only spacing/case differences. All 10 lines that separate the two metrics are abbreviation expansions — no other difference. Recommendation: judge the gate on the identity metric; a strict-string gate would penalize behavior the prompt orders. Note: if the owner subset's 32/32 was scored strict-string, the two subsets are not commensurable and the combined strict figure (86.15%) is the conservative reading.

## Isolation compliance

- All public-set data lives ONLY under `~/workspace/meta-hackathon-2026/spike2/public-set/` (`photos/`, `labels/`, `results/`, plus `decode_public.py`, `score_public.py`, and this report).
- The only owner-side files read were `spike2/decode_photo.py` and `spike2/run_one.py` (to reuse the exact SYSTEM prompt and call pattern) and the owner-subset result line in `spike2/SPIKE2-REPORT.md` (4 receipts, 32/32) for the combined figure.
- Nothing was written to `spike1/`, `spike2/photos/`, or `spike2/results/`. No public item entered any dictionary, ledger, or pattern file. No shared state exists between calls.

## Sourcing shortfall (stated plainly)

Target was 16 public receipts; **9 were obtained** (98 labelable lines). The binding constraint was hand-labelability, not search effort (~25 image searches plus dataset, archive, and blog sweeps). Real receipts that were found but REJECTED because labels could not be trusted:

- Trader Joe's, 26 items, $52.18 — holder's thumb/fold truncates the left edge of nearly every product name; only ~4 lines fully labelable as printed.
- Fred Meyer (Kroger banner), 15 items, $60.69 — photographed at an angle; item text too small to transcribe reliably after rotation/upscale attempts.
- Target, ~7 lines, ~$123.90 — skewed photo, item names not reliably readable.
- Costco (Roseville) and a second Costco photo — thumbs hide the product names.
- CVS/Walgreens photos found were coupon tails only (no item lines); one WIC slip showed quantities without prices and part of a card number (skipped on both grounds).
- Rejected outright: fake/AI sample receipts, rendered samples, non-US receipts (Canada, UK, Serbia, Russia, Australia, Colombia), staged prop receipts, and photos too blurry to label.

Mix targets: long receipts (15+ lines) — target 4, got 1 (Alexander's, 27 lines); the other long candidates above failed on labelability. Chains beyond Safeway — target 3, got 8. Adverse conditions — hand-held (pub-01, 03, 08, 09), crumpled + rotated 90° (pub-02, kept in original orientation), faded (pub-04, 06), dark + thumb-occluded (pub-08, 09): covered.

## Coverage by store

| File | Store | Lines labeled | Lines correct (identity) | Total | Condition |
|---|---|---|---|---|---|
| pub-01 | Walmart (Meridian, ID) | 13 | 13 | 28.48 | hand-held |
| pub-02 | Publix (Atlanta, GA) | 10 | 10 | 66.58 | crumpled, rotated 90° |
| pub-03 | H-E-B | 12 | 12 | 36.92 | hand-held, outdoors |
| pub-04 | Alexander's Supermarket | 27 | 22 | 39.99 | flat scan, faded dot-matrix |
| pub-05 | Westside Market (New York, NY) | 13 | 10 | 55.55 | flat lay, 2013 |
| pub-06 | Kroger | 3 | 3 | 8.07 | faded, wrinkled |
| pub-07 | Publix (Weston, FL) | 2 | 2 | 4.65 | hand-held; lower receipt in frame |
| pub-08 | Food Lion (Rutherfordton, NC) | 8 (+5 unreadable) | 8 | not in frame | dark, thumb-occluded, PARTIAL |
| pub-09 | Costco (Tigard, OR) | 10 (+5 unreadable) | 10 | not in frame | hand-held, thumb-occluded, PARTIAL |

Chains represented: Walmart, Publix (×2), H-E-B, Kroger, Costco, Food Lion, Alexander's, Westside Market (independent) — 8 chains plus 1 independent, all beyond the owner set's Safeway.

## Errors, ranked

1. **Product wrong — 5** (all pub-04, faded vintage print): digit/code misreads inside abbreviated strings — CHRY48→CHRY8, 8PK→SPK, 1884→18&4, T/HOUSE16BN→168N, 96ZPP499→962PP499. Four of five carried `needs_user_check`. All five prices were exact.
2. **Price wrong — 3** (all pub-05): a three-way price rotation — ORANGE JUICE 8.99→3.99, NAPOLITANER 2.99→4.05, PIZZA POCKETS 4.05→7.99. The rotation preserves the line sum, so the arithmetic check alone would NOT catch it. The ORANGE JUICE error was high-confidence (0.9, no check flag) — the one silent error in the set.
3. **Item-number wrong — 3 of 46 checked** (reported separately; not in the pass mark): Walmart RED BELL …4688KF→…4680KF; Westside BOUNTY …81539→…81599 and NAPOLITANER 0765600721→07858000721.
4. **Missed line — 0. Extra line — 0.** The model emitted exactly the label line count on all 9 receipts, including the 10 label-unreadable lines on the two partial receipts, which it returned as partial reads with `needs_user_check` (excluded from scoring, not counted as extra).

Arithmetic match: **7/7** receipts where a total is in frame (decoded line sum vs subtotal within 0.05 AND decoded total equals the printed total). pub-08/pub-09 are not scorable (totals out of frame); on both, the model reported the visible-line sum as its total.

Conventions and notes:

- Savings folds were handled correctly everywhere they occur: pub-02 (0.50, 0.68), pub-03 (25%-off line: list 9.32 / paid 6.99 / discount 2.33), pub-09 (Costco instant savings folded into CRNCHMASTER: paid 5.99, discount 2.00). The pub-09 label records the printed line amount (7.99); the line is scored correct under the established spike-1/spike-2 fold convention, with the 2.00 carried in the discount field.
- `items_sold` matched the label on all 3 receipts that print it (pub-01: 14, pub-03: 12, pub-06: 3). Where not printed, the model inferred a count (pub-02: 10, pub-04: 27, pub-05: 14) instead of returning null — harmless here, worth a prompt note.
- pub-07: the model duplicated the brand token into the product field (a schema artifact); identity was unaffected under token-set comparison.
- Decode cost: 72,344 tokens total for 9 photos (23,379 prompt + 48,965 completion).

## Files

- `photos/pub-01.jpg` … `pub-09.jpg`, `photos/manifest.json` (source + store + notes per file)
- `labels/pub-01.json` … `pub-09.json` (hand labels, written before decoding)
- `results/pub-01.json` … `pub-09.json` (raw decode results), `results/scores.json` (full scoring detail)
- `decode_public.py`, `score_public.py` (reproducible pipeline)
