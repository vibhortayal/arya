# The 2-minute pitch — Arya (Team Nightshift, Indie track)

Spoken script, timed to the Meta hackathon structure. ~330 words ≈ 2:15 at speaking pace — the extra 15 seconds buy the solution logic (why a game at all) ahead of the demo, per the owner 2026-10-27. Screen beats in brackets; the demo runs on the live app throughout — show, don't tell.

## Hook (0:00–0:15)

"Every week, you walk into a grocery store that knows nothing about you — hunting for things it will not help you find, working from a list that's half in your head. Google Maps ends at the door. Inside the store, you're on your own."

## Problem (0:15–0:30)

"List apps start blank — they know nothing about what you buy, what you returned, or where anything is. And the stores that publish no layout data at all — Trader Joe's, independents, ethnic markets — are invisible to every app on your phone. The trip stays a chore: slow, forgetful, and repeated every single week."

## The solution — why it is built this way (0:30–1:00)

"Everything this needs — a map of the store, what's actually on its shelves — doesn't exist, and you can't buy it. The stores won't hand it over. Paying people to walk aisles with an app has been tried — it shut down.

So the data has to come from the people already in the store: shoppers. And shoppers don't do chores for free. They do it if it's fun — if it's a game.

So we made the whole trip a game. Your list becomes a treasure hunt inside a 3D model of your real store. A kid who drags through the aisles suddenly wants to hold the phone and hunt — the chore becomes the part of the trip they ask for. And every hunt quietly does the work: it maps the store, checks the shelves, and ends with a receipt that proves what really happened.

The game isn't decoration. The game is how the map gets built."

## Live demo (1:00–1:45)

"This is Arya.

[Photo of a handwritten list] I photograph my list. **Muse Spark** reads it; Arya's Optimizer merges duplicates and asks about the one real ambiguity — it never guesses a product into existence. Don't want to type? Dictate it — **Muse Voice Transcribe**.

[Pick Trader Joe's] This store was rebuilt in 3D from a shopper's walkthrough video by **VGGT**, Meta AI's reconstruction model. **SAM 3.1** segmented the shelves; **Spark** labeled them — Cheese, Pasta, Pasta Sauce, in the order you walk.

[Hunt] My items are treasures on their real shelves. My kid holds the phone and hunts; I run the list. Collect, collect — [Not here] — that tap reports a stockout, and the community's map stays true because of it.

[Receipt photo] Every hunt ends with the receipt. Spark verifies every line against the total — a returned item nets out and is never suggested again. That receipt is the scorecard, and it's also the brain: next week's list is already writing itself."

## Meta fit (1:45–2:00)

"Five Meta models, each doing the job only it can do: Spark reasons, Voice Transcribe listens, SAM sees the shelves, VGGT builds the world. And the world keeps growing the open way — shoppers map stores the way contributors build open source: the platform belongs to the people who play it."

## Future scope (2:00–2:15)

"With three more weeks: whole-store maps with live you-are-here in the aisle, open registration with per-user spend caps, and a second metro mapped end to end by its own shoppers.

We are Team Nightshift. Arya makes the weekly shop a game worth playing — and every game makes the map truer. We're ready for your questions."

---

## How it maps to the four pillars

| Pillar | Where it lands |
|---|---|
| Technical Execution | The demo itself: five Meta models in one live loop, a verified-arithmetic receipt engine, 116 tests, all built and deployed during the event window |
| Impact & Viability | A weekly, universal chore; the wedge is the stores no incumbent can map because they publish nothing — Arya's sensors are its players |
| Innovation | The superpower: a store's interior becomes a playable, community-maintained map, and the receipt — not a scanner, not a robot — is the referee |
| Meta Alignment | Open contribution (maps built by the community), connection (friends race Shop-Offs, households share one list), and Meta's models as the entire perception stack |

## Delivery notes

- Run the demo from the demo account on a phone; the Trader Joe's hunt starts in the cloud driver and can drop to Strip live if the network stumbles — say so if it happens; the ladder is a feature, not an apology.
- Keep one pre-decoded receipt as the fallback for the finish beat (DEMO.md failure mode: live decode is slow).
- Every number spoken is verifiable in the repo: 114 real receipts behind the brain, 373,630 points in the shipped cloud, 55 SAM-labeled shelf regions, full-pipeline shelf-graph cost $0.25.
