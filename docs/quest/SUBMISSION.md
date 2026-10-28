# Submission map

**Event:** Meta Global AI Developer Hackathon · Team Nightshift · Indie track (≤4, representative: Vibhor Tayal)
**Deadline:** Nov 4, 2026, 9:00 PM ET, via the Cerebral Valley portal.
**Rule held:** nothing is submitted without the owner's explicit go-ahead on the complete package.

## Judging weights → where we win them

| Criterion | Weight | Our evidence |
|---|---|---|
| Impact | 30% | The weekly shop, made play: parents and kids first; a contribution flywheel that maps the world's stores from shoppers' phones |
| Use of Meta AI Tooling | 25% | SAM 3.1 places the products and scans live shelves (Shelf Scan), Muse Wonder reads the receipt photos and authored the localizer, Muse Spark reads the lists and labels, Muse Image paints the celebration characters, Muse Voice Transcribe takes dictation, Spark 1.3 judges, and VGGT (Meta AI research, not on the event's model list) builds the point cloud — every intelligent step is a Meta model (see META-PRODUCTS.md) |
| Demo | 25% | A playable hunt in a real store's 3D model, filmed end to end: note photo → hunt → receipt finish |
| Technical Depth | 20% | Crowdsourced 3D store models + shelf graphs; verified receipt pipeline (arithmetic-checked, returns netted); a pattern engine with an LLM judge (precision 0.79 against a purchase-cadence proxy on the owner's 114 receipts — eval method and disagreement lists in the research repo); per-account vs platform data planes |

## Demo video beats

1. A handwritten fridge note. Photo → the list appears, structured.
2. Pick the store: Trader Joe's, Chino Hills — mapped from a shopper's walkthrough video.
3. The store opens in the photo view — real photos of the real aisles, the 3D model one tap away. The hunt starts: first treasure glows on its real shelf.
4. Quest mode collects three items along the route. Timer running.
5. Checkout: receipt photo → verified total → haul scored → badges land live on the score screen.
6. **The Shop-Off:** two players race the same list in the same store; the photo finish is two receipt timestamps. The household board updates. (The virality beat — community is the clincher.)
7. Close: next week's hunt pre-loads itself from the household's patterns. "Mapped by" credit on the store.

## Package checklist

- [ ] Working demo (PWA, demo household — the full loop plays in a per-visitor sandbox, no account)
- [ ] Demo video (beats above)
- [ ] This repository (vibhortayal/arya — one repo, Discussion 25): pitch, architecture, Meta products, game design, build plan, and the live engine, tests green
- [ ] Portal form fields completed from the drafts here
- [ ] Owner review of the complete package → explicit go-ahead → submit

## IP note

Per the event terms, the team keeps ownership and grants the organizers a perpetual, royalty-free license to the submission; anything shared at the event is non-confidential.
