# Spark vs Wonder on receipt decode — accuracy and latency

**Headline: on the Gate 0 public set, Wonder reads receipts more
accurately than Spark — and its errors are the kind the system catches,
while Spark's worst error is the kind it cannot. Wonder costs ~9× more
per receipt and takes ~4× longer.**

One-sentence result the submission may quote: *"On the 9 public Gate 0
receipt photos (98 hand-labeled lines), Muse Wonder 1.0 scored 97/98
lines correct on identity+price against Spark 1.3 Standard's 92/98,
with zero price errors and zero silent errors; Spark repeated the
set's one known silent failure — a price rotation on Westside Market's
receipt, read at 0.85 confidence with no check flag — while Wonder
read that line correctly at 0.95."*

Quotable form: **"Wonder 98.98% vs Spark 93.88% identity+price
(hand-adjudicated under the Gate 0 definition); price errors 0 vs 4;
silent errors 0 vs 4; arithmetic 7/7 both. Latency: Wonder mean 34.4 s
vs Spark 8.6 s per receipt photo. Cost: $0.118 vs $0.013 per receipt."**

## Method (stated before the numbers)

- **Data.** The Gate 0 public set only: 9 receipt photos
  (`~/workspace/meta-hackathon-2026/spike2/public-set/photos/`), 98
  hand-labeled lines, labels written before any decode ran. No owner
  receipts anywhere in this eval.
- **Identical conditions.** Both models ran the app's own photo
  pipeline: the system prompt from `assistant/prompts/decode_photo_v1.md`
  loaded the way `api/decode/service.py: load_photo_prompt()` loads it,
  the same message shape as `decode_photo()`, temperature 0.1, one
  stateless call per receipt. Spark ran at the app's production
  configuration (`muse-spark-1.3`, `reasoning_effort=low` — the
  `meta_client.chat` default). Wonder ran at its default
  (`muse-wonder-1.0`, no `reasoning_effort` sent). This compares the
  configurations the app would actually ship, and the asymmetry is
  deliberate: effort is part of a model's production configuration.
- **Scoring, two columns.** Gate 0's verdicts were hand-made under a
  written definition (identity = same product as printed, prompt-
  sanctioned abbreviation expansions preserve identity, price exact
  with the savings-fold allowance). This eval first ran an automatic
  scorer (`wonder_score.py`) implementing that definition; the scorer
  was **calibrated until it reproduced every Gate 0 hand verdict on
  the recorded Spark run exactly** (90/98 identity, 80/98 strict, same
  error lines, arithmetic 7/7). The automatic column is that scorer,
  unmodified, on both fresh runs. Because the scorer's expansion table
  covers the abbreviations the *recorded Spark run* used, every
  automatic non-correct line in both fresh runs was then
  **hand-adjudicated under the same written Gate 0 definition** — the
  adjudicated column. Each ruling is listed by name below. Reporting
  only the automatic column would penalize Wonder for doing what the
  prompt instructs (expanding abbreviations); reporting only the
  adjudicated column would hide the judgment calls. Both are printed.
- **Latency** is wall-clock per API call, one run, sequential calls.
  **Cost** is computed from each response's usage block at the
  MODEL-POLICY prices (Spark Standard $1.25/$4.25, cached $0.15;
  Wonder $4/$20 per 1M) via the repo's own `estimate_cost`.
- **Judge spot check.** 20 synthetic grouped items with expected
  verdicts set from the judge prompt's rules, mirroring the production
  judge-eval archetypes (weekly staples, December eggnog, twice-a-year
  spices, gift cards, and the 2-buys-703-days-apart foil case). Run
  through the app's own `api/judge.py` batch path, one call per model.
  Synthetic because the real judge inputs are the owner's purchase
  history; no personal data was sent to either model.

## Results

| Metric (9 receipts, 98 lines) | Spark 1.3 Std (low) | Wonder 1.0 (default) |
|---|---|---|
| Identity+price, automatic scorer | 92/98 = 93.88% | 86/98 = 87.76% |
| Identity+price, hand-adjudicated | 92/98 = 93.88% | **97/98 = 98.98%** |
| Strict-string, automatic | 77/98 = 78.57% | 72/98 = 73.47% |
| Price errors | **4** | **0** |
| Product errors (adjudicated) | 2 | 1 |
| Silent errors (wrong, no check flag) | **4 of 6** | **0 of 1** |
| Arithmetic (of 7 scorable) | 7/7 | 7/7 |
| Latency mean / median / p95 | 8.6 s / 8.8 s / 11.9 s | 34.4 s / 30.0 s / 60.5 s |
| Cost per receipt (total) | $0.0134 ($0.12) | $0.1180 ($1.06) |

Per receipt (identity, adjudicated; latency s; cost $):

| Receipt | Lines | Spark | Wonder | Spark lat | Wonder lat |
|---|---|---|---|---|---|
| pub-01 Walmart | 13 | 13/13 | 13/13 | 9.2 | 30.5 |
| pub-02 Publix (rotated, crumpled) | 10 | 10/10 | 10/10 | 8.7 | 30.0 |
| pub-03 H-E-B | 12 | 12/12 | 12/12 | 7.3 | 26.4 |
| pub-04 Alexander's (faded dot-matrix) | 27 | 25/27 | 26/27 | 11.0 | 47.4 |
| pub-05 Westside Market | 13 | **9/13** | **13/13** | 11.9 | 28.3 |
| pub-06 Kroger | 3 | 3/3 | 3/3 | 6.3 | 15.4 |
| pub-07 Publix | 2 | 2/2 | 2/2 | 4.8 | 11.9 |
| pub-08 Food Lion (partial) | 8 | 8/8 | 8/8 | 8.8 | 59.5 |
| pub-09 Costco (partial) | 10 | 10/10 | 10/10 | 9.6 | 60.5 |

Judge spot check (20 synthetic items, one batch call per model):
**both models 20/20 on class and 20/20 on list admission**, including
the foil archetype (both OCCASIONAL — the production judge's one clear
error from the 2026-10-27 eval was not reproduced by either model on
the clean synthetic version). Spark: 5.9 s, $0.0067 per batch. Wonder:
12.2 s, $0.0595 per batch. The synthetic items are deliberately
clear-cut, so this instrument has a ceiling: it shows Wonder does not
judge *worse*; it cannot show it judges better.

## Where the reads differ, by name

### Lines Spark got wrong that Wonder got right

- **pub-05, the price rotation — all four of Spark's price errors are
  on this one receipt, and Wonder made none, here or anywhere.**
  ORANGE JUICE $8.99 → Spark $3.99 (confidence 0.85, **no check
  flag**); ROYAL GALA $5.99 → $2.99 (0.80, no flag); NAPOLITANER
  $2.99 → $4.05 (0.50, flagged); PIZZA POCKETS $4.05 → $10.99 (0.40,
  flagged). Wonder read all four at their true prices, 0.88–0.95
  confidence. The ORANGE JUICE line is the same line that was Gate
  0's one silent error in the recorded run: a rotation preserves the
  line sum, so the arithmetic check (7/7 for both models) **cannot**
  catch it. This is the most dangerous error class in the product,
  and in this run Spark produced it twice silently (0.85 and 0.80 —
  at the app's ≥0.8 auto threshold, both would auto-post) and Wonder
  produced it zero times.
- **pub-04 idx16, SNK FRT/S CHRY48** (faded dot-matrix): Spark read
  "CHRY 8", dropping the 4 — at 0.82 confidence, unflagged, so it
  would auto-post as the wrong product. Wonder read CHRY48 correctly
  — and still flagged the line for a user check (0.58), the correct
  behavior on a hard line.

### Lines Wonder got wrong that Spark got right

- **None, after adjudication.** Wonder's only surviving error is one
  Spark shares (below). Its 11 other automatic-scorer failures were
  all the same behavior — expanding or completing what Spark leaves
  abbreviated — and every price was exact:
  - Brand expansions: LNF → "Light & Fit" (pub-01), PF →
    "Pepperidge Farm", KB → "Keebler" and CKS → "Cookies", OS →
    "Ocean Spray" (all pub-08), HEB → "H-E-B" (five pub-03 lines —
    the same brand, hyphenated, twice with word order normalized).
  - Two borderline completions, flagged as judgment calls: RED BELL →
    "Red Bell Pepper" (pub-01) and STRKST → "StarKist TUNA …"
    (pub-08). The printed abbreviation denotes exactly that product;
    the added word names its class. A stricter adjudicator could
    score these wrong; scoring both wrong still leaves Wonder at
    95/98, ahead of Spark.
  - pub-03 idx11 carries the promo text in its detail ("Special
    Today- 25.00% Off orig 9.32 Ea.") — Gate 0 hand-scored the
    identical Spark read of this line correct; same ruling here.

### Lines both got wrong

- **pub-04 idx21, M&M 15%FREE 1884 → "18&4"** — the digit-string
  misread both models made at Gate 0 too. Wonder flagged it (0.72);
  Spark did not (0.85).

### The strict-string inversion

Wonder's strict score (72) is *lower* than Spark's (77) precisely
because it expands: "Ranch Dressing" is the right product and the
wrong string. Spark's strict number is itself flattered and dented by
furniture — its pub-02 reads are verbatim but carry the receipt's
"F" tax-flag glyph in every detail, which strict counts as 0/10 on
that receipt. Strict-string measures transcription style, not
correctness; the identity metric is the one the gate was judged on,
and it is the one to quote.

## Recommendation

- **Photo decode (receipt finish → review queue): flip to Wonder.**
  The accuracy gap concentrates exactly where the product is weakest:
  silent price rotations that arithmetic cannot catch (Spark 4 price
  errors, 2 auto-posting silently; Wonder 0 and 0) and faded-print
  digit reads. Decode is asynchronous in the product — the user takes
  a photo and reviews a queue — so Wonder's latency is absorbable
  there; a wrong price that posts silently is not. At $0.118/receipt
  the credit cost is a non-issue through Nov 4 (~$118 per 1,000
  decodes against ~$147 of remaining credit).
- **Staple judge: stay on Spark.** The spot check separates nothing
  (20/20 vs 20/20), and the only measured production number — 0.79
  precision against the cadence proxy — belongs to Spark's run. Paying
  9× and waiting 2× for unmeasured benefit is not justified. Revisit
  only with a harder, labeled judge set.
- **Ask Arya / chat: stay on Spark.** Interactive paths live or die
  on latency; Wonder's profile (12 s for a text batch here, 26–60 s
  with an image) is the wrong shape for chat, and this eval produced
  no chat-accuracy evidence for either model.
- **Shelf labeling (Quest, offline batch): flip to Wonder is
  defensible but unmeasured head-on.** The supporting evidence is
  indirect — Wonder's expansions in this eval were consistently the
  *correct* brand renderings (Keebler, Pepperidge Farm, Ocean Spray,
  Betty Crocker, Finlandia), which is the labeling skill, and
  labeling runs offline where latency does not matter. If it flips,
  say "on decode evidence," not "measured."
- **PDF/text decode: no claim.** The public fixtures are photos; the
  text path shares the prompt family but was not run here.

**The latency caveat, quantified:** Wonder's mean is 4.0× Spark's
(34.4 s vs 8.6 s), its p95 is 60.5 s vs 11.9 s, and its two slowest
calls (59.5 s, 60.5 s) were the two partial receipts. One further
signal: a duplicated dispatch during this eval produced a second,
unscored Wonder run whose latencies averaged ~76 s (max ~104 s) and
which emitted 24 lines for pub-02 (duplicated reads of the rotated
receipt, vs 10 in the scored run). Wonder's tail is heavier and less
stable than the scored run alone shows. Any judge-facing Wonder path
needs a spinner the demo can survive and a timeout with a Spark
fallback behind it.

**Policy note:** the repo's MODEL-POLICY.md bans Wonder from volume
paths, and AGENTS.md reserves policy changes to the owner. The
recommendation above is scoped to the judge-facing demo paths through
Nov 4 (demo household + the owner's own demo use), not a production
policy change. No production code was changed by this eval.

## Caveats

- One run per model per receipt, temperature 0.1. Variance is real:
  fresh Spark (93.88%) vs Gate 0's recorded Spark (91.84%) differ by
  ±3 lines on pub-04/pub-05 in opposite directions — Spark fixed 3 of
  pub-04's 5 recorded digit errors this run and made pub-05's
  rotation worse (4 price errors vs 3). Quote the gap between models
  (same-day, same-prompt runs), not either absolute as a constant.
- 9 receipts, 98 lines, US grocery only — the same small set as
  Gate 0, with its known skew (one long receipt; two partials whose
  totals are out of frame, hence arithmetic scored on 7).
- The adjudicated column rests on 11 rulings, each named above; the
  two borderline completions are marked. The automatic column is
  printed alongside so a reader who rejects the rulings still has a
  consistent number — and on that number Wonder *loses*, which is
  itself the finding: the models differ in transcription style, and
  a scorer built from one model's style misjudges the other's.
- The judge spot check is a ceiling-limited instrument (synthetic,
  clear-cut by design); it is evidence of no regression, not of
  superiority, for either model.

*Spend: $4.47 total — Spark decode $0.12, Wonder decode (scored run)
$1.06, the duplicated unscored Wonder run $3.22, judge spot checks
$0.07. Runner: ~/workspace/arya-eval/wonder_run.py; scorer:
~/workspace/arya-eval/wonder_score.py (calibration: reproduces Gate 0
hand verdicts exactly); spot check: ~/workspace/arya-eval/
judge_spotcheck.py; raw outputs and per-line scores in
~/workspace/arya-eval/wonder-results/.*
