# Submission map

**Event:** Meta Global AI Developer Hackathon · Team Nightshift · Indie track (≤4, representative: Vibhor Tayal)
**Deadline:** Nov 4, 2026, 9:00 PM ET, via the Cerebral Valley portal.
**Rule held:** nothing is submitted without the owner's explicit go-ahead on the complete package.

## Judging weights → where we win them

| Criterion | Weight | Our evidence |
|---|---|---|
| Impact | 30% | Every household that shops each week: a list that writes itself from verified receipts, with returns netted and patterns learned by store; Quest, the optional game, makes the trip fun and lets shoppers map their stores for each other |
| Use of Meta AI Tooling | 25% | SAM 3.1 finds shelves and signs in the guided store scan, boxes items for Find it for me, and blurs people, Muse Spark reads receipt photos first and Muse Wonder re-reads the ones the checks flag, Muse Spark reads the lists and labels, Muse Image paints the celebration characters, Muse Voice Transcribe takes dictation, Spark 1.3 judges — every intelligent step is a Meta model (see META-PRODUCTS.md) |
| Demo | 25% | A 3-minute video, list first: receipt in → the list writes itself → add by voice and photo → Ask Arya → an optional quest → close. Judges can play the same loop live in the demo household |
| Technical Depth | 20% | Crowdsourced store maps from guided camera scans (people scrubbed first, coverage earned); verified receipt pipeline (arithmetic-checked, returns netted); a pattern engine with an LLM judge (precision 0.79 against a purchase-cadence proxy on the owner's 114 receipts — eval method and disagreement lists in the research repo); per-account vs platform data planes |

## Demo video beats (3 minutes, list first)

The demo household (fictional, no personal data) carries the video; one
real receipt is read on camera. Keep one receipt already read as the
fallback if the live read is slow.

| Time | Beat | Meta model on screen |
|---|---|---|
| 0:00-0:15 | Hook: "Your list app starts blank every week. Arya starts from your receipts." Today. | |
| 0:15-0:50 | Snap a receipt: the lines are read, "Total checks out", a return is netted. | Muse Spark, Muse Wonder 1.0 as backup |
| 0:50-1:20 | The list writes itself: Running low with reasons, one list per store, the "why" sheet. | Muse Spark staple judge, Muse Spark Open second seat |
| 1:20-1:45 | Add any way: say it, or snap a handwritten note. | Muse Voice Transcribe, Muse Spark vision |
| 1:45-2:05 | Ask Arya: "We finished the Greek yogurt", then "What did we spend on coffee?" | Muse Spark |
| 2:05-2:40 | Optional fun: Start shopping opens a quest at the list's store, Got it +10, Find it for me on a shelf, people blurred. | SAM 3.1, Muse Spark, Muse Image |
| 2:40-3:00 | Close: the math is code, the model only reads and speaks; privacy; the live link and "Try it now". | |

## Package checklist

- [ ] Working demo (PWA, demo household — the full loop plays in a per-visitor sandbox, no account)
- [ ] Demo video (beats above)
- [ ] This repository (vibhortayal/arya — one repo, Discussion 25): pitch, architecture, Meta products, game design, build plan, and the live engine, tests green
- [ ] Portal form fields completed from the drafts here
- [ ] Owner review of the complete package → explicit go-ahead → submit

## IP note

Per the event terms, the team keeps ownership and grants the organizers a perpetual, royalty-free license to the submission; anything shared at the event is non-confidential.
