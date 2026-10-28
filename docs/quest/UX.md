# UX — Arya Quest

Design bar: a first-time player finishes a hunt with zero instruction. One primary action per screen. The game is the interface; the list is a tool you summon, not a place you live.

## The session model

- A **session** is one store trip: one store, one list, one mode, one state.
- A day holds many sessions. Each is an independent game — pause Trader Joe's mid-hunt, run Costco Express, come back; nothing bleeds across.
- States: **Not started → Playing ⇄ Paused → Finished → Done**. Done means scored, and scoring needs the receipt. A hunt finished by Skip is Finished and unsettled; it is never Done until its receipt lands.
- Sessions live in two places: as cards on the Today hub, and as a slim rail during play for one-tap switching.

## The hunt layout — Hunt v2 (the core interaction)

Design direction from Discussion 45. The v2 wireframes are the design
of record; they are **not yet owner-approved**, and that approval
gates the quest UI rebuild. The shipped build still uses the earlier
hunt screen until the rebuild lands.

1. The hunt is **one scrolling column**: HUD, view switch, a contained store view, the suggested-next card, the actions, then the list. Nothing floats over the scene.
2. The store view shows **one target** — the suggested stop. The scene drivers (Photo, Cloud, Aisle, Strip) change only the store view; items are never duplicated across overlays.
3. The list lives in **exactly one place**: the column, in route order. Rows never move, re-sort, or lose scroll position.
4. GRAB collects in place. A collected row carries **Put back** in the same button box; putting back re-aims the suggestion. Check state derives from the session items only, so the scene and the list can never disagree.
5. Collecting the last item does not finish the hunt. The hunt ends when the player taps Finish.
6. Navigation is a **stack**: every Back returns to the screen the player came from.

## Screens

| # | Screen | Primary action | Rule it carries |
|---|---|---|---|
| 1 | Today (hub) | Resume / Start a session | The day is a row of games, not one list |
| 2 | New session — add list | "Looks right →" after review | Dump in any form; Arya parses; the human confirms |
| 3 | New session — pick store | Pick a store | Mapped = play in 3D; unmapped = play in Strip, map it to unlock 3D (platform) |
| 15 | Optimize list (step 1) | Answer its questions, then "Looks right →" | Merge duplicates into quantities; correct spelling openly; ASK on real ambiguity — the game never starts on a guess |
| 4 | Mode choose | Tap Quest or Express | The mood chooses the mode — one tap, reversible until start |
| 5 | Hunt (Quest) | Collect / Put back | Hunt v2 column: one target in the store view; the list in flow below; rows never move |
| 6 | Express run | Check items in walking order | Same model, game off; big targets; live time estimate |
| 7 | Finish — receipt | Snap the receipt | The scorecard ritual; skippable, never blocking |
| 8 | Score | Back to Today / next session | Verified haul, time, streak — the session closes |
| 9 | Map a store | Upload walkthrough video | Contribution goes to the platform; mapper credit is the wage |

## Simplicity budget

- No screen carries more than one primary button.
- No settings before the first hunt. Account, appearance, and history live behind the hub's corner, not in the flow.
- Every label is a plain word a tired parent reads once: List, Next, Collect, Done.
- If a feature needs a paragraph to explain, it does not ship in v1.

| 10 | Community | Trophy button on the hub | Every board and badge is receipt-verified — the receipt is the referee |
| 11 | Shop-Off race | Challenge (Community / Friends) | Live race, same store and list; the receipt timestamp is the photo finish |
| 12 | Profile | Avatar button on the hub | The public card: handle, stats, badge shelf, mapper credit — private data never shown |
| 13 | Friends | Friends row in Community | Handles only; friends see boards and badges — no chat, no lists |
| 14 | Receipt detail | A receipt row in Profile | Photo and digitized twin together; verified total; the account's private archive |

Profile also carries a visible "Coming next" tile — Analysis (patterns, spend, dashboard). A placeholder with a name, not a fake screen: the future is declared, not simulated.

List intake is one surface (Discussion 30): the Add tab carries one text field (type or paste), one mic (Voice Transcribe; the transcript lands in the field for edit), one camera with smart routing (a list photo becomes list items; a receipt photo is offered as a receipt), and the pointer to **chat**: "add eggs to my Trader Joe's list" via the user's Muse lands in today's session for that store through the connector. Receipts enter by image only.

## The scene ladder — the game never needs the 3D

The Hunt screen's scene is a viewport, not the game. The game is the session: stops in walking order, COLLECT, the receipt finish, the score. The scene renders that session through one of four drivers, and a hunt completes identically in all of them:

1. **Photo** — the photo-walk: the mapped store's own walkthrough frames along the path, crossfaded by path fraction, the gyro panning within the frame. Real photos of the real store — never called a 3D model or a live view. **The default view for a mapped store** (Discussion 43).
2. **Cloud** — the store's point cloud (VGGT), walked in 3D. A mapped store's alternate 3D view, one tap from Photo.
3. **Aisle** — a stylized 3D aisle scene from the shelf graph. A fallback view for a store with a path but no walk frames.
4. **Strip** — a flat 2D aisle strip: stops as shelf cards in walking order, the strip scrolling as the hunt advances. First-class, not a degraded mode — this is how unmapped stores play, and how any store plays on a weak device.

Rules: an unmapped store is **playable, never gated** — Strip is its default, and mapping is an invitation ("Map this store to unlock its photo walk and 3D view"), not a wall. A player can drop a level mid-hunt (battery, comfort, motion sensitivity) from a small in-hunt toggle, with no state lost. Stops, scoring, Shop-Off timing, and the receipt finish are driver-independent. The localizer's "Where am I?" gates on the store being mapped (Photo or Cloud), not on a rung — position is a path fraction.

## Wireframes

Clickable prototype: the "Arya Quest — Wireframes" artifact (Muse), also committed in this repo at `docs/quest/wireframes.html` — ~25 screens (Quest screens + Brain B1–B6 + panels), demo data (Trader Joe's Quest, 8 items + Costco Express, 5 items), the full demo path clickable end to end. **The pre-v2 set was approved by the owner 2026-10-27.** The Hunt v2 rework (Discussion 45) was **approved by the owner 2026-10-28** and the quest UI is rebuilt to it (Discussion 46). Product builds follow the approved prototype; deviations come back here first.
