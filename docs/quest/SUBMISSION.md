# Submission map

**Event:** Meta Global AI Developer Hackathon · Team Nightshift · Indie track (≤4, representative: Vibhor Tayal)
**Deadline:** Nov 4, 2026, 9:00 PM ET, via the Cerebral Valley portal.
**Rule held:** nothing is submitted without the owner's explicit go-ahead on the complete package.

## Judging weights → where we win them

| Criterion | Weight | Our evidence |
|---|---|---|
| Impact | 30% | The weekly shop, made play: parents and kids first; a contribution flywheel that maps the world's stores from shoppers' phones |
| Use of Meta AI Tooling | 25% | SAM 3.1 finds shelves and signs in the guided store scan, boxes items for Find it for me, and blurs people, Muse Wonder reads the receipt photos, Muse Spark reads the lists and labels, Muse Image paints the celebration characters, Muse Voice Transcribe takes dictation, Spark 1.3 judges — every intelligent step is a Meta model (see META-PRODUCTS.md) |
| Demo | 25% | A quest in a real store, filmed end to end: note photo → list → quest → Find it for me → receipt |
| Technical Depth | 20% | Crowdsourced store maps from guided camera scans (people scrubbed first, coverage earned); verified receipt pipeline (arithmetic-checked, returns netted); a pattern engine with an LLM judge (precision 0.79 against a purchase-cadence proxy on the owner's 114 receipts — eval method and disagreement lists in the research repo); per-account vs platform data planes |

## Demo video beats

1. A handwritten fridge note: photo, and the list appears.
2. Open the Trader Joe's list and tap Start shopping. The list is already
   sorted for the store (milk and bread usually here, eggs usually from
   Costco).
3. The store opens as a labelled layout; a guided scan maps an aisle
   live. Grab, +10, a character and a fun fact. No clock.
4. **Find it for me:** the camera finds the sourdough on the shelf;
   tap to grab. SAM 3.1 boxes it, Spark confirms it, and any shopper in
   the frame is blurred before anything is kept.
5. Checkout: receipt photo, verified total, the haul counts up, the
   level bar fills.
6. Close: next week's list writes itself.

## Package checklist

- [ ] Working demo (PWA, demo household — the full loop plays in a per-visitor sandbox, no account)
- [ ] Demo video (beats above)
- [ ] This repository (vibhortayal/arya — one repo, Discussion 25): pitch, architecture, Meta products, game design, build plan, and the live engine, tests green
- [ ] Portal form fields completed from the drafts here
- [ ] Owner review of the complete package → explicit go-ahead → submit

## IP note

Per the event terms, the team keeps ownership and grants the organizers a perpetual, royalty-free license to the submission; anything shared at the event is non-confidential.
