# Model policy: cost efficiency (my directive, 2026-10-27)

Rule: every job runs on the cheapest model that holds its golden-set score.
Escalation is by evidence (a scored eval), never by default.

## Prices (per 1M tokens, Meta Model API, verified 2026-10-27)
- muse-spark-1.3 Standard:    $1.25 in / $0.15 cached / $4.25 out
- muse-spark-1.3 Contributor: $0.10 in / $0.002 cached / $0.20 out (different data
  terms; not used). Limit 150 requests/min. Not the app's tier; see "Spark tier" below.
- muse-wonder-1.0:            $4.00 in / $0.20 cached / $20.00 out. This is the expensive
  frontier model, not a budget tier. It is banned from volume paths.
- muse-image-1.0: $0.01/image. muse-voice-transcribe-1.0: $0.18/audio-hour.
- sam-3.1: $2.50 per 1,000 images; $0.20 per 1,000 video frames.

## Assignments
1. The cheapest model is no model. Patterns, cadence, run-out dates, ledger
   math, reconciliation, and list generation are deterministic code: $0.
2. Volume intelligence (receipt decode fallback, list and date photos,
   command parsing, Ask Arya, judge): Spark, reasoning_effort=low, stable
   prefixes cached. Spark runs as muse-spark-1.3 Standard (see "Spark tier"
   below).
   Exception (owner, 2026-11-04): the list photo read sends
   reasoning_effort=minimal for speed, and repeats once at low if the
   API refuses the value.
3. Eval loops (golden sets, prompt variants): Contributor mode. Gate
   scores still count on Standard. (Superseded for app traffic by the
   2026-11-01 amendment.)
4. Wonder: zero jobs at baseline (history; the live reader is `auto`, see below). A job earns Wonder only by failing its
   golden set on Spark at two effort levels, with the eval logged.
5. Voice: transcribe on demand only; Ask has no voice out (replies are text).
6. Muse Image: painted the 23 characters once and paints share looks (live); a dinner render is planned, not built. muse-image-1.0 costs $0.01 per image. It is the one place a flat
   per-unit price beats token metering.

## Measured anchors (default reasoning effort, spike runs)
- PDF receipt decode: ~2.9 cents/receipt. Photo: ~1.5 cents short, ~3.1 long.
- JSON import: $0. Patterns on imported history: $0.
- Policy targets: a full trip decode at or under 1 to 2 cents; total hackathon
  API spend well under the $150 credit (plan §8 estimated $57 to $61 at defaults).

## Credits (me, 2026-10-29)
There is no $0 rule. Hackathon credits (Meta Model API, plus Baseten and Modal)
are available, so spending on Meta models (Muse Image, Spark, Wonder, SAM) is
allowed when it improves the product or demo. Stay budget-aware: the cheapest
model that holds its score is still the default, spend goes through the ledger,
and large batches get a capped trial first. The in-code caps (daily and demo
budgets) are unchanged.

## Hackathon amendment (2026-10-27, per WONDER-EVAL.md; changed 2026-11-01)
**My decision 2026-11-01:** receipt photos are read by the **auto
reader** (Ops "Photo reader" = "Spark first, Wonder as backup"): Spark
reads first. Wonder re-reads only when Spark fails or the checks
below flag the read (arithmetic, low confidence on too many lines). Wonder
stays allowed as that second reader through Nov 9. That is meant to cover
judging after submission. The original 2026-10-27 amendment (Wonder first, Spark
fallback) is summarized below.

Original (2026-10-27): through Nov 4, judge-facing photo decode ran Wonder first with a Spark fallback. Wonder scored 97 of 98 lines after hand adjudication (the automatic scorer gives Wonder 86 of 98) against Spark's 92 of 98 on the automatic scorer. The numbers, latency, cost and the staple-judge check are in [WONDER-EVAL.md](../../docs/evals/WONDER-EVAL.md).

**Auto reader (built 2026-11-01; my pick for judging on
2026-11-01; NOT yet measured on photos).** `ARYA_PHOTO_READER=auto` (or the Ops "Photo reader" switch)
reads with Spark first and runs the checks in `api/decode/checks.py`
(lines add up to the subtotal, subtotal plus tax equals the total, the
footer item count, impossible prices, too many unsure lines, a price far
from the same item number's earlier price on the account). Only a
receipt that fails them is re-read by Wonder. A Spark failure goes
straight to Wonder. If Wonder is down, the Spark read is kept and every
line is sent to review. The receipt records `decoded_by` and `second_read`
(the reasons), so it is never silent. Why it exists: Wonder won the eval
on accuracy. Spark is about nine times cheaper per receipt and about
four times faster. Cheap arithmetic can catch most of Spark's mistakes.
Known gap, from the Gate 0 notes: a price rotation (two prices swapped
between lines) keeps the sum, so arithmetic alone misses it. The price
history check covers it only for item numbers seen before. Before the
default changes, run `python3 -m harness.photo_reader_eval --photos DIR`
on the Gate 0 photos and require that every price where Spark and Wonder
differ is on a flagged receipt. After Nov 9 the amendment above ends.
If I extend it, auto keeps Wonder's accuracy only where the checks say it
is needed. Otherwise photo decode is Spark only.

**Demo budget.** Each demo visit may spend `ARYA_DEMO_SESSION_BUDGET_USD`
(code default $0.40; $2 on the live site, owner 2026-11-04) on live
reads, held in that visitor's in-memory sandbox; all demo visits together
stay under `ARYA_DEMO_DAILY_BUDGET_USD` (code default $2; $100 a day on
the live site for the judging window, about 50 full visits a day, and the
top of the Ops range). Ops > Settings > Dollar limits sets both without a
deploy and beats the env file. To go back through the env file, set
`ARYA_DEMO_DAILY_BUDGET_USD=2` and `ARYA_DEMO_SESSION_BUDGET_USD=0.40` in
the VM env file, then run `docker compose up -d` in `assistant/deploy` (a
plain `restart` does not re-read the env file).

**Switch after Nov 9, not before.** The photo reader is an env setting:
`ARYA_PHOTO_READER=spark` in the VM env file, then `docker compose up -d`
in `assistant/deploy` (not `restart`, which keeps the old environment),
puts photo decode on Spark Standard with no deploy. Unset, or `wonder`,
is the amendment path. Receipts record `decoded_by`, so the switch is
visible in the data. Spark-only photo decode scored 93.88% in the Gate 0
eval, with the review queue as the mitigation.

## Spark tier (my decision, 2026-11-01)
Spark and Wonder run in Standard mode. Meta's models page (dev.meta.ai/docs/models):
"In Standard mode, your content is not used to train Meta models." Earlier on
2026-11-01 I had moved the app's Spark calls to
`muse-spark-1.3-contributor` for the lower price; the same day I moved
them back to Standard, so nothing the app sends is used for training.

- Code: `meta_client.resolve_mode()` maps the app's "standard" (Spark) mode to
  the tier set on the Ops screen or in `ARYA_SPARK_TIER`; the Ops screen
  setting wins. Wonder is always Standard. An explicit `mode="contributor"` with
  `personal=True` is still refused.
- Option, not built: a community (Contributor) tier with user opt-in could
  support more users at lower cost. It needs an opt-in screen, a per-user
  routing rule and updated privacy text first, and my word.
- Rate limits: Standard allows 3,000 requests/min per team. The Contributor tier
  allows 150/min, so `meta_client` keeps a sliding-window gate at 140/min for that
  case. A call that would wait over 20 s fails with "Arya's AI is busy right now"
  (HTTP 502) instead of hanging.
- Receipt photos follow the auto reader above. SAM, Muse Voice and the
  open-weights client are unchanged.
