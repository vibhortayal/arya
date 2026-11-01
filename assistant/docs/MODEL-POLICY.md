# Model policy — cost efficiency (owner directive, 2026-10-27)

Rule: every job runs on the cheapest model that holds its golden-set score.
Escalation is by evidence (a scored eval), never by default.

## Prices (per 1M tokens, Meta Model API, verified 2026-10-27)
- muse-spark-1.3 Standard:    $1.25 in / $0.15 cached / $4.25 out
- muse-spark-1.3 Contributor: $0.10 in / $0.002 cached / $0.20 out (may train on inputs).
  Limit 150 requests/min (Standard 3,000). THE APP'S SPARK TIER since 2026-11-01.
- muse-wonder-1.0:            $4.00 in / $0.20 cached / $20.00 out — the expensive
  frontier model, NOT a budget tier. Banned from volume paths.
- muse-image-1.0: $0.01/image. muse-voice-transcribe-1.0: $0.18/audio-hour.
- sam-3.1: $2.50 per 1,000 images; $0.20 per 1,000 video frames.

## Assignments
1. The cheapest model is no model. Patterns, cadence, run-out dates, ledger
   math, reconciliation, and list generation are deterministic code: $0.
2. Volume intelligence (receipt decode fallback, list and date photos,
   command parsing, Ask Arya, judge): Spark, reasoning_effort=low, stable
   prefixes cached. Spark runs as muse-spark-1.3-contributor (see the
   2026-11-01 amendment below).
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

## Spark on Contributor (owner decision, 2026-11-01)
The owner chose to run the app's Spark calls on `muse-spark-1.3-contributor`
after being advised against it. What Meta's models page says (dev.meta.ai/docs/models):
"In Contributor mode, your content may be used to train future Meta models,
in exchange for a lower price." and "In Standard mode, your content is not
used to train Meta models." The page lists no personal-data restriction for
the contributor variants. The older note "Meta terms bar personal data on
Contributor mode" was not found there and is withdrawn until someone can cite it.

- Code: `meta_client.resolve_mode()` maps the app's "standard" (Spark) mode to
  the tier in `ARYA_SPARK_TIER` (default `contributor`; `standard` reverts,
  then `docker compose up -d`). Wonder is always Standard. An explicit
  `mode="contributor"` with `personal=True` is still refused.
- Rate limit: Contributor allows 150 requests/min per team. `meta_client`
  has a sliding-window gate at 140/min; a call that would wait over 20 s fails
  with "Arya's AI is busy right now" (HTTP 502) instead of hanging; 429s keep
  the existing retry with Retry-After.
- What now trains: the staple judge (item names), Ask Arya chat, list text
  and list photos, receipt PDF and pasted-text decode, order-text decode,
  Costco name expansion, expiry-date photos, fridge (Eyes) photos, shelf-scan crops, Quest list matching and
  Curator suggestions, and the Spark fallback for receipt photos and PDFs.
- What does not: receipt photos while ARYA_PHOTO_READER is wonder (default
  through Nov 4; the Wonder call is Standard). After the Nov 4 switch to
  spark, receipt photos are on Contributor too. SAM, Muse Voice and the
  open-weights client are unchanged.
