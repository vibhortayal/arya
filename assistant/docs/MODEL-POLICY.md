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
2. Volume intelligence (receipt decode, photo decode, Eyes sightings, command
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
