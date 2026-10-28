# The pitch — Arya (Team Nightshift, Indie track)

The complete spoken pitch. ~390 words ≈ 2:25 at speaking pace. Screen beats in brackets; the demo runs on the live app throughout — show, don't tell. Every claim in the text is true of the shipped build (accuracy pass applied 2026-10-27: code checks the arithmetic, Spark reads; 40 named shelf regions; no unverified counts).

## Hook (0:00–0:15)

"Every week, you walk into a grocery store that knows nothing about you — hunting for things it will not help you find, working from a list that's half in your head. Google Maps ends at the door. Inside the store, you're on your own."

## Problem (0:15–0:30)

"List apps start blank — they know nothing about what you buy, what you returned, or where anything is. And the stores that publish no layout data at all — Trader Joe's, independents, ethnic markets — are invisible to every app on your phone. The trip stays a chore: slow, forgetful, and repeated every single week."

## The solution — why it is built this way (0:30–1:05)

"Here's the thing: everything this needs — a map of the store, what's actually on its shelves — doesn't exist for the stores that publish nothing, and nobody sells it for them. The stores won't hand it over. Paying people to scan shelves has been tried — those apps shut down.

So the data has to come from the people already in the store: shoppers. And shoppers don't do chores for free — they do it if it's fun. If it's a game.

So we turned the weekly shop into a game — and the chore became the fun part. Your list becomes a treasure hunt in a 3D model of your real store. You race your own best time, chase streaks and badges, race a friend across town. A kid who drags through the aisles suddenly fights to hold the phone and hunt. And every hunt quietly does the work: it checks the shelves, reports what's missing, and ends with a receipt that proves what really happened.

The game isn't decoration. The game is how the map gets built — and why anybody builds it."

## Live demo (1:05–1:50)

"This is Arya — and the list doesn't start blank. It starts written.

[Today] Arya learned this house from its receipts — what it buys, how fast it uses it — and reminds you what's due before you run out: raspberries, mandarins, almonds. That's your starting point. And adding is any way you like: photograph a note, dictate it with **Muse Voice Transcribe**, paste it, type it, or just tell Muse in chat. **Muse Spark** reads it; the Optimizer merges duplicates and asks about the one real ambiguity — it never guesses a product into existence.

[Pick Trader Joe's] This store was rebuilt in 3D from a walkthrough video — that's how any shopper maps a store. **VGGT** built the geometry; **SAM 3.1** segmented the shelves; **Spark** labeled them — Cheese, Pasta, Pasta Sauce, in the order you walk.

[Hunt] Now play it. My items are treasures along the real shelves. My kid holds the phone and hunts; I run the list. Collect — collect — [Not here] — that tap reports a stockout, so the community's map stays true. We're racing our best time, and the badges land at the end.

[Receipt photo] Every hunt ends with the receipt. Spark reads it; Arya checks every line against the total — a return nets out and is never suggested again. The receipt is the scorecard, and it's the brain: next week's list is already writing itself."

## Meta fit (1:50–2:05)

"Meta's models do every job here: Muse Spark reasons and reads, Muse Voice Transcribe listens, SAM 3.1 sees the shelves, VGGT builds the world. And the world grows the open way — shoppers map stores the way contributors build open source: the platform belongs to the people who play it."

## Future scope (2:05–2:20)

"With three more weeks: whole-store maps with live you-are-here in the aisle, open registration with per-user spend caps, and a second metro mapped end to end by its own shoppers.

We are Team Nightshift. Arya makes the weekly shop a game worth playing — and every game makes the map truer. We're ready for your questions."

---

## If it must run 2:05

Drop, in order: (1) "You race your own best time, chase streaks and badges, race a friend across town." (−8s; the kid line still carries fun) — (2) the door enumeration down to "photograph it, dictate it, or just tell Muse in chat" (−5s). Nothing else: every remaining sentence is load-bearing.

## How it maps to the four pillars

| Pillar | Where it lands |
| --- | --- |
| Technical Execution | The demo itself: Meta's models in one live loop, a verified-arithmetic receipt engine, 126 tests, all built and deployed during the event window |
| Impact & Viability | A weekly, universal chore; the wedge is the stores no incumbent can map because they publish nothing — Arya's sensors are its players |
| Innovation | The superpower: a store's interior becomes a playable, community-maintained map, and the receipt — not a scanner, not a robot — is the referee |
| Meta Alignment | Open contribution (maps built by the community), connection (friends race Shop-Offs, households share one list), and Meta's models as the entire perception stack |

## Delivery notes

- Run the demo from the demo account on a phone; the Trader Joe's hunt starts in the cloud driver and can drop to Strip live if the network stumbles — say so if it happens; the ladder is a feature, not an apology.
- The demo hunt list should be drawn from what the mapped stretch actually contains (cheese, oils, pasta, sauce, peanut butter, bread, frozen pizza) so every stop's shelf label agrees with the item.
- Keep one pre-decoded receipt as the fallback for the finish beat (DEMO.md failure mode: live decode is slow).
- Every number spoken is verifiable in the repo: 114 real receipts behind the brain, 373,630 points in the shipped cloud, 40 named shelf regions of 55 SAM regions, full-pipeline shelf-graph cost $0.25.
