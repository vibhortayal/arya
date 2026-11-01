# Model policy — cost efficiency (owner directive, 2026-10-27)

Rule: every job runs on the cheapest model that holds its golden-set score.
Escalation is by evidence (a scored eval), never by default.

## Prices (per 1M tokens, Meta Model API, verified 2026-10-27)
- muse-spark-1.3 Standard:    $1.25 in / $0.15 cached / $4.25 out
- muse-spark-1.3 Contributor: $0.10 in / $0.002 cached / $0.20 out (Meta may train
  on inputs). Limit 150 requests/min. Not the app's tier; see "Spark tier" below.
- muse-wonder-1.0:            $4.00 in / $0.20 cached / $20.00 out — the expensive
  frontier model, NOT a budget tier. Banned from volume paths.
- muse-image-1.0: $0.01/image. muse-voice-transcribe-1.0: $0.18/audio-hour.
- sam-3.1: $2.50 per 1,000 images; $0.20 per 1,000 video frames.

## Assignments
1. The cheapest model is no model. Patterns, cadence, run-out dates, ledger
   math, reconciliation, and list generation are deterministic code: $0.
2. Volume intelligence (receipt decode fallback, list and date photos,
   command parsing, Ask Arya, judge): Spark, reasoning_effort=low, stable
   prefixes cached. Spark runs as muse-spark-1.3 Standard (see "Spark tier"
   below).
3. Eval loops (golden sets, prompt variants): Contributor mode. Gate
   scores still count on Standard. (Superseded for app traffic by the
   2026-11-01 amendment.)
4. Wonder: zero jobs at baseline. A job earns Wonder only by failing its
   golden set on Spark at two effort levels, with the eval logged.
5. Voice: transcribe on demand only; speech out is device TTS (no API cost).
6. Dinner render (optional): muse-image-1.0 at $0.01 — the one place a flat
   per-unit price beats token metering.

## Measured anchors (default reasoning effort, spike runs)
- PDF receipt decode: ~2.9 cents/receipt. Photo: ~1.5 cents short, ~3.1 long.
- JSON import: $0. Patterns on imported history: $0.
- Policy targets: a full trip decode at or under 1–2 cents; total hackathon
  API spend well under the $150 credit (plan §8 estimated $57–61 at defaults).

## Credits (owner, 2026-10-29)
There is no $0 rule. Hackathon credits (Meta Model API, plus Baseten and Modal)
are available, so spending on Meta models (Muse Image, Spark, Wonder, SAM) is
allowed when it improves the product or demo. Stay budget-aware: the cheapest
model that holds its score is still the default, spend goes through the ledger,
and large batches get a capped trial first. The in-code caps (daily and demo
budgets) are unchanged.

## Hackathon amendment (2026-10-27, per WONDER-EVAL.md; changed 2026-11-01)
**Owner decision 2026-11-01:** receipt photos are read by the **auto
reader** (Ops "Photo reader" = "Spark first, Wonder as backup"): Spark
reads first, and Wonder re-reads only when Spark fails or the checks
below flag the read (arithmetic, low confidence on too many lines). Wonder
stays allowed as that second reader through Nov 9, which covers judging
(Nov 5-8). The text below is the original amendment (Wonder first, Spark
fallback), kept for the eval record.

Original (2026-10-27): through Nov 4, judge-facing PHOTO DECODE runs
muse-wonder-1.0, with a timeout and a Spark fallback. Evidence (Gate 0 public set, 9 photos,
98 lines, hand-adjudicated): Wonder 98.98% identity+price vs Spark
93.88%; price errors 0 vs 4; silent (unflagged) errors 0 vs 4 — Wonder
read the pub-05 price rotation correctly, the error class arithmetic
cannot catch. Latency is the cost: 34s mean / 60s p95 vs Spark's
8.6s / 11.9s — accepted because decode lands in the review queue, not
an interactive path. Cost $0.118/receipt vs $0.013 — immaterial against
the hackathon credit. The staple judge, the shelf-life estimate for
"Still good?" (api/shelflife.py, item names only, cached per item) and
Ask Arya STAY on Spark Standard (judge spot check 20/20 vs 20/20, no Wonder advantage; chat
cannot carry Wonder's latency). This amendment expires Nov 9; the
production policy above is unchanged.

**Auto reader (built 2026-11-01; the owner's pick for judging on
2026-11-01; NOT yet measured on photos).** `ARYA_PHOTO_READER=auto` (or the Ops "Photo reader" switch)
reads with Spark first and runs the checks in `api/decode/checks.py`
(lines add up to the subtotal, subtotal plus tax equals the total, the
footer item count, impossible prices, too many unsure lines, a price far
from the same item number's earlier price on the account). Only a
receipt that fails them is re-read by Wonder; a Spark failure goes
straight to Wonder; if Wonder is down the Spark read is kept with every
line sent to review. The receipt records `decoded_by` and `second_read`
(the reasons), so it is never silent. Why it exists: Wonder won the eval
on accuracy, but Spark is about nine times cheaper per receipt and about
four times faster, and cheap arithmetic can catch most of its mistakes.
Known gap, from the Gate 0 notes: a price rotation (two prices swapped
between lines) keeps the sum, so arithmetic alone misses it; the price
history check covers it only for item numbers seen before. Before the
default changes, run `python3 -m harness.photo_reader_eval --photos DIR`
on the Gate 0 photos and require that every price where Spark and Wonder
differ is on a flagged receipt. After Nov 9 the amendment above ends;
auto is the way to keep Wonder's accuracy only where the checks say it
is needed, if the owner extends it, and Spark-only otherwise.

**Demo budget.** Each demo visit may spend `ARYA_DEMO_SESSION_BUDGET_USD`
(default $0.40) on live reads, held in that visitor's in-memory sandbox;
all demo visits together stay under `ARYA_DEMO_DAILY_BUDGET_USD`
(code default $2; the compose default is $20 for the judging window,
about 50 full visits a day). Set `ARYA_DEMO_DAILY_BUDGET_USD=2` in the
VM env file to go back, then run `docker compose up -d` in
`assistant/deploy` (a plain `restart` does not re-read the env file).

**Switch at expiry.** The photo reader is an env setting:
`ARYA_PHOTO_READER=spark` in the VM env file, then `docker compose up -d`
in `assistant/deploy` (NOT `restart`, which keeps the old environment),
puts photo decode on Spark Standard with no deploy; unset or `wonder`
is the amendment path. Receipts record `decoded_by`, so the switch is
visible in the data. Spark-only photo decode scored 93.88% in the Gate 0
eval, with the review queue as the mitigation.

## Spark tier (owner decision, 2026-11-01)
Spark and Wonder run in Standard mode. Meta's models page (dev.meta.ai/docs/models):
"In Standard mode, your content is not used to train Meta models." Earlier on
2026-11-01 the owner had moved the app's Spark calls to
`muse-spark-1.3-contributor` for the lower price; the same day the owner moved
them back to Standard, so nothing the app sends is used for training.

- Code: `meta_client.resolve_mode()` maps the app's "standard" (Spark) mode to
  the tier set on the Ops screen or in `ARYA_SPARK_TIER`; the Ops screen
  setting wins. Wonder is always Standard. An explicit `mode="contributor"` with
  `personal=True` is still refused.
- Option, not built: a community (Contributor) tier, where users opt in to
  letting Meta train in exchange for lower cost, could support more users. It
  needs an opt-in screen, a per-user routing rule and updated privacy text
  first, and the owner's word.
- Rate limits: Standard allows 3,000 requests/min per team. The Contributor tier
  allows 150/min, so `meta_client` keeps a sliding-window gate at 140/min for that
  case; a call that would wait over 20 s fails with "Arya's AI is busy right now"
  (HTTP 502) instead of hanging.
- Receipt photos: with the reader on auto (the default) Spark reads first and
  Wonder re-reads only a flagged receipt. SAM, Muse Voice and the open-weights
  client are unchanged.
