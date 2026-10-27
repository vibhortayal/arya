# Arya Quest — hackathon doc pack

Canonical home since 2026-10-27: **vibhortayal/arya · docs/quest/** (moved from vibhortayal/arya-quest, now archived — one product, one repo).

# Arya Quest — Pokémon GO for your grocery list

**Team Nightshift · Meta Global AI Developer Hackathon · Indie track**
**Submission deadline: Nov 4, 2026, 9:00 PM ET**

Grocery shopping is a chore. Kids cry in the aisles. You forget the one thing you came for.

Arya Quest turns a grocery list into a treasure hunt inside a 3D model of your actual store. Dump your list in any form — a photo of a handwritten note, a whiteboard, a paste. Pick your store. Walk the hunt: the model shows the trail, each item glows on its real shelf, you collect it and move to the next. At checkout you snap the receipt — it scores your haul and quietly teaches Arya your household, so next week's hunt loads itself.

If your store is not mapped yet, you map it: one walkthrough video of the aisles, filmed on your phone, becomes a shared 3D model for every player who shops there. Every shopper a mapper. Every hunt makes the platform smarter.

## The loop

**List → Store → Play → Receipt.**

1. **List in, any form.** Photo of a note or whiteboard, paste, typing, voice. Muse Spark reads it into a structured list.
2. **Store.** Mapped stores carry a 3D model built from walkthrough video by Meta's VGGT, with products placed by SAM 3.1 and Muse Spark. Unmapped stores get mapped by their own shoppers.
3. **Play — or don't.** Quest mode: treasure hunt — items glow on real shelves, route in order, tap to collect, timer and streaks; a kid holding the phone follows the list exactly because the game asks for it. Express mode: same model, game off — the fastest route out. The mood chooses the mode.
4. **Receipt.** The hunt ends with the receipt photo. It verifies the haul (the scorecard) and feeds the household brain: patterns, spend, returns — the list that writes itself.

## Why it works

- **The hunt is personal.** The treasures are your items in your store, not random spawns.
- **The utility floor is real.** Novelty fades; dinner does not. The list is real every week.
- **Fun is the data strategy.** The two contributions the platform needs — store videos and receipts — are the two things the game makes people want to do.
- **The brain is already built.** Under the game sits Arya: receipt parsing with arithmetic verification, returns netting, a learned-pattern engine, and an LLM staple judge — live today at arya-pilot.duckdns.org (repo: vibhortayal/arya).

## Documents

- [PITCH.md](PITCH.md) — problem, audience, flywheel, rollout
- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, data split, pipelines
- [META-PRODUCTS.md](META-PRODUCTS.md) — every Meta product used, and its job
- [GAME-DESIGN.md](GAME-DESIGN.md) — modes, roles, mechanics
- [BUILD-PLAN.md](BUILD-PLAN.md) — the road to Nov 4
- [SUBMISSION.md](SUBMISSION.md) — judging map and submission checklist
- [UX.md](UX.md) — session model, list-panel rules, screen inventory
- [DISCUSSION.md](DISCUSSION.md) — the owner's steering, in order, and what each turn changed

## Status

- Engine (Arya): live, tested (60 tests), real household data.
- UX: 10-screen clickable wireframe browser (sessions, list panel, Quest/Express, receipt finish, Community) — **approved by the owner 2026-10-27**; it is the build reference.
- 3D spike: in progress — a Trader Joe's walkthrough (Chino Hills, CA) cut to a 90-second aisle stretch, 90 frames, VGGT-Ω reconstruction running. Verdict gates the full-3D plan; fallback is a 2.5D store map with the same game.
