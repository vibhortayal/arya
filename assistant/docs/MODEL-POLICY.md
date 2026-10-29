# Model policy — cost efficiency (owner directive, 2026-10-27)

Rule: every job runs on the cheapest model that holds its golden-set score.
Escalation is by evidence (a scored eval), never by default.

## Prices (per 1M tokens, Meta Model API, verified 2026-10-27)
- muse-spark-1.3 Standard:    $1.25 in / $0.15 cached / $4.25 out
- muse-spark-1.3 Contributor: $0.10 in / $0.002 cached / $0.20 out (may train on inputs)
- muse-wonder-1.0:            $4.00 in / $0.20 cached / $20.00 out — the expensive
  frontier model, NOT a budget tier. Banned from volume paths.
- muse-image-1.0: $0.01/image. muse-voice-transcribe-1.0: $0.18/audio-hour.
- sam-3.1: $2.50 per 1,000 images; $0.20 per 1,000 video frames.

## Assignments
1. The cheapest model is no model. Patterns, cadence, run-out dates, ledger
   math, reconciliation, and list generation are deterministic code: $0.
2. Volume intelligence (receipt decode, photo decode, command
   parsing): muse-spark-1.3 Standard, reasoning_effort=low, stable prefixes
   cached (dictionary + system prompt ride at the cached-input rate).
3. Eval loops (golden sets, prompt variants): Contributor mode — synthetic
   data and public fixtures only. Owner personal data is Standard-only,
   always; no exceptions, no eval convenience.
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

## Hackathon amendment (2026-10-27, per WONDER-EVAL.md)
Through Nov 4, judge-facing PHOTO DECODE runs muse-wonder-1.0, with a
timeout and a Spark fallback. Evidence (Gate 0 public set, 9 photos,
98 lines, hand-adjudicated): Wonder 98.98% identity+price vs Spark
93.88%; price errors 0 vs 4; silent (unflagged) errors 0 vs 4 — Wonder
read the pub-05 price rotation correctly, the error class arithmetic
cannot catch. Latency is the cost: 34s mean / 60s p95 vs Spark's
8.6s / 11.9s — accepted because decode lands in the review queue, not
an interactive path. Cost $0.118/receipt vs $0.013 — immaterial against
the hackathon credit. The staple judge and Ask Arya STAY on Spark
Standard (judge spot check 20/20 vs 20/20, no Wonder advantage; chat
cannot carry Wonder's latency). This amendment expires Nov 4; the
production policy above is unchanged.

**Demo budget.** Each demo visit may spend `ARYA_DEMO_SESSION_BUDGET_USD`
(default $0.40) on live reads, held in that visitor's in-memory sandbox;
all demo visits together stay under `ARYA_DEMO_DAILY_BUDGET_USD`
(default $2). For the judging window set the daily cap higher in the VM
env file (for example 15) and restart the api container.

**Switch at expiry.** The photo reader is an env setting:
`ARYA_PHOTO_READER=spark` on the VM (then restart the api container)
puts photo decode on Spark Standard with no deploy; unset or `wonder`
is the amendment path. Receipts record `decoded_by`, so the switch is
visible in the data. Spark-only photo decode scored 93.88% in the Gate 0
eval, with the review queue as the mitigation.
