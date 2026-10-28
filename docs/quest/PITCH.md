# Pitch

## Problem

A weekly grocery run is 40 minutes of low-grade friction:

- The list lives on a fridge note, a whiteboard, a partner's text message.
- The store layout lives in nobody's head. Every trip is a search problem.
- Kids experience the store as boredom at cart height. They cry, wander, and grab — they do not follow the list.
- The receipt — the only verified record of what the household actually eats — goes in the trash.

List apps digitized the note. Nobody made the store itself playable, and nobody connected the game to the record.

## Solution

Arya Quest is a collection game played in the player's own store — walked in photos of the actual aisles (the photo-walk), with a 3D model of the store one tap away:

- **Personal spawns.** Your list items are the treasures, on their real shelves.
- **Two moods.** Quest mode hunts — big targets, a guide character, collecting; a kid can hold the phone while the adult runs quantities, substitutions, and checkout. Express mode drops the game and shows the fastest route out. Same model, same list.
- **A finish ritual.** The receipt photo scores the haul and settles the quest — and feeds the household model that pre-loads next week's hunt.

## Audience

1. **Parents first.** The pain is sharpest and most memorable: a child who begs to find the next item is a child following the list.
2. **Households second.** The brain underneath (patterns, spend, returns) serves the person who plans the shopping.
3. **Mappers.** Early adopters who film their store get first-mapper credit on it — status is the wage the game pays for labor.

## The flywheel

Play → contribute → platform learns → play improves.

- Store videos (platform data) grow the map of the world, store by store.
- Receipts (private data) grow each household's brain.
- More mapped stores = more hunts = more mappers.

## Why now

Three Meta capabilities make this buildable in 2026 and not before:

1. **VGGT** (Meta AI + Oxford, CVPR 2025 Best Paper) turns ordinary walkthrough video into 3D geometry and camera paths in one forward pass — no photogrammetry pipeline, no LiDAR, no store cooperation.
2. **SAM 3.1** segments individual products out of shelf frames.
3. **Muse Spark** reads the shelf labels, the handwritten lists, and the receipts — perception good enough to trust a household's record to, with arithmetic verification on every receipt.

## Community — why it spreads

Every metric is receipt-verified, so the social layer needs no trust: leaderboards (fastest hunt, most receipts contributed, most stores mapped), badges the data makes funny (Egg Baron, Banana Republic, Return Regret — the last one only a returns-netting platform can award), team Shop-Offs settled by receipt timestamps, and Clue Hunts where Spark turns the list into riddles. Households compete privately first; store-local and global boards follow. Detail: GAME-DESIGN.md, "Community layer".

## Rollout story

- Shipped for the hackathon: one mapped Trader Joe's stretch (18 stops, 55 labeled regions) with playable hunts across the photo, 3D, Aisle, and Strip views, on a live household brain.
- Mapping is crowdsourced from day one by design: a store is added by the first player who wants to hunt in it.
- Depth path (post-hackathon): continuous camera relocalization — one-shot placement from a single photo ("Where am I?") is shipped; live tracking is the future item — more game skins (escape room), household analytics, mapper events and store leaderboards.

## One line

Pokémon GO for your grocery list — the creatures are your groceries, the gym is your store, and you come home with dinner.
