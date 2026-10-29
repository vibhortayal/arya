# STATUS — where Arya stands (2026-10-28)

Live: https://arya-pilot.duckdns.org. Deadline: Nov 4, 2026, 9:00 PM ET.
The build record per session lives in `assistant/loops/`; decisions
live in `docs/quest/DISCUSSION.md`. This page says only what is true now.

## List first, Quest second (2026-10-29, PR pending)
- Tabs Today · Lists · Ask · Quest; Crew folded into Quest. Today is the
  shopping dashboard (running low, store alerts, use soon, lists,
  patterns). Landing: "Groceries, sorted." See
  assistant/loops/2026-10-29-list-first.md. SW arya-v77.

## List overhaul (2026-10-29, PR #105)
- Lists tab opens on one card per list plus Everything else. A list
  shows only what the household added; due staples are suggestions
  under the list of the store they come from, with a reason and a
  "why" sheet. Swipe → Move / Remove; Select → Move to…. Prepared cart
  and the List footer lines are gone. Demo ships Costco and Trader
  Joe's lists (rerun `python -m harness.make_demo_household data`).
  A pencil on the list name renames it in place. Snap an expiry date
  moved from the List to Today's Use soon section.
  See assistant/loops/2026-10-29-list-overhaul.md. SW arya-v79.

## Start shopping (2026-10-29, PR #111)
- A "Start shopping · N items" bar sits above the tabs on an open
  list and leads to the Quest or Express choice. SW arya-v81. See
  assistant/loops/2026-10-29-start-shopping.md.

## Express mode (2026-10-29, PR #107, merged)
- Express is a plain checklist with Show me (photo only on request),
  Not here?, Find with camera and More help; its finish shows no points,
  badges or album. See assistant/loops/2026-10-29-express-mode.md.
  SW arya-v80.

## Built and deployed (main)
- **Brain:** intake (photo, PDF, JSON, order text, voice, Muse
  connector), ledger with returns netted, patterns, the staple judge,
  the smart list with a store lens, Eyes, Ask Arya, Receipts with the
  original image kept, Analysis (Spend, with an Other purchases split),
  grocery detection (rules and aisle map first, one cached model look for
  unknown names, never blocks).
- **Quest:** sessions, the Optimizer, Quest and Express hunts, receipt
  finish and Score, Shop-Off (single account), friends and badges,
  Spotter "Not here?" reports, the stores directory, item-to-shelf
  matching, Shelf Scan (SAM 3.1 + Spark verify), Where am I? (the
  local localizer), photo-walk view of Trader Joe's.
- **Share a haul (photo only):** Score's Share opens a preview with
  Story/Post size, handle and level toggles, and optional Muse looks
  (badge, cast joins in, storybook). Still PNG through the phone's share
  sheet; no video. Footer says Made with Arya, plus Powered by Meta Muse
  only on a painted card. Not yet tried against live Muse.
- **Demo:** a fictional household in a per-visitor sandbox; demo
  writes never reach disk. Light mode only.
- **Accounts:** registration LOCKED (owner, 2026-10-28) —
  `POST /auth/register` refuses new accounts unless the operator
  sets `ARYA_REGISTRATION_OPEN=1`; login, bootstrap setup, existing
  accounts, and the demo are unchanged. SW arya-v50.
- **Hunt v2** (PR #16, merged): one-column hunt, put back in place,
  nothing auto-finishes, Back is a stack, Finish closes the hunt.

## PR #18 (game shell): merged and deployed 2026-10-28
- Installable PWA (manifest, icons, offline grabs that sync later).
- No clock, no lives: +10 a grab, +25 full haul, +50 receipt; levels;
  milestones, confetti, opt-in sound and buzz.
- How to play on the first hunt; one automatic store view (photos or
  shelf cards) with a 3D peek.
- Find it for me: the camera scans for the next item; tap to grab.
  Verified sightings feed the map. Frames are kept as fresh shelf
  photos only after SAM blurs every person in them.
- Plan a hunt: store first, the list sorted by where each item is
  usually bought, list management in the same screen.
- Wireframes (`docs/quest/wireframes.html`) and the tap-through
  prototype (`docs/quest/game-flow-prototype.html`) match the build.
- Suite: 382 green. Service worker arya-v42.

**Owner steps after merging PR #18:** deploy (`git pull` on the VM);
`python -m harness.make_demo_household data` (the demo gains Costco
trips); `MODEL_API_KEY=… python -m harness.scrub_walk_frames` (blurs
shoppers in the 90 walk photos, about $0.45). Git history still holds
the unblurred originals.

## Game loop upgrade (branch `feat/game-loop`, not yet merged)
One upgrade of the existing hunt. No new game. No lives, no timers, no
streaks, no retake loop. Wireframe: `docs/quest/` and the owner's
game-loop wireframe.
- **Pack:** the plan deals cards. Pack it or skip it. Quantity, brand,
  note, and a private cost estimate stay on the phone. Items left last
  trip come first.
- **Hunt:** a row menu: swap, it moved, save for next trip, drop, edit.
  Done early asks what to do with the rest. Grab takes a quantity.
  A combo count only goes up. A boss item appears only after two real
  reports. Toasts have a close button and stay longer.
- **Haul:** receipt check, then a reveal of stickers and points, then a
  haul card with a trip name. Fixes change the haul view only, never
  points. Posts go to accepted friends and show stock art, never a
  price or a photo. A saved list from a friend's haul waits in the plan.
- **Album:** one sticker for each product grabbed. New means first found
  on that trip. Level-up card lists what is new. Levels never lock
  anything that makes shopping faster.
- Service worker arya-v49 precaches the four new scripts and styles.
- Suite: 764 green, 1 skipped. Phone pass by the owner is still open.

## Measured results
- Gate 0 photo decode: PASS. Public 91.84% (90/98 lines), owner
  32/32, combined 93.85%, arithmetic 7/7. One silent price rotation
  recorded; the review queue is the mitigation.
- Photo decode reads with Muse Wonder 1.0 (90 s bound, Spark
  fallback) under the hackathon amendment, which **expires Nov 4,
  2026**. Proof run 97/98 after adjudication, $1.12.
- Localizer: stop accuracy 42/45, neighborhood 45/45, ~1 s a query.
- Shelf graph build: $0.24 (SAM 36 images + Spark 55 calls).

## Remaining for submission
- Owner phone pass on PR #18, then merge and deploy.
- Demo video and the final submission package (owner go-ahead).
- Public flip of this repo with the submission freeze (Discussion 28),
  after the pre-flip scrub (VM internals out of docs, secrets grep).

## Known gaps
- Store news and the Friends/Store/Global boards read this account only; cross-account data shows labelled samples.
- Split the list (kids or partner) is not built.
- Friend run notifications: designed (Discussion 24), not built.
- Shop-Off and Spotter reports are single-account.
- Deferred: stale-staple curation (M8), /health receipt count (M11),
  deny-by-default route guard (L12).
- Photo opt-in and privacy policy: after the hackathon (owner).

## Owner data (not in this repo)
114 Costco receipts (2023-10-25 → 2026-10-26, 1,226 lines) are staged
in the Hatch workspace `meta-hackathon-2026/imports/costco-json/`.
Raw files stay out of git.

## Open: phone-pass batch PR (fix/phone-pass-batch) — awaiting owner review
- Seven owner phone-pass fixes in one PR: store-picker tap-to-advance
  + receipts fold, skippable Check-the-list, character popups off,
  receipt-sheet button layout, Add folded into List (four tabs),
  New session on top of Today, compact staples line. SW arya-v43.
- Known pre-existing failure on main: test_photo_driver frame budgets
  (the scrub commit pushed the walk frames over the size guide).

## Open: expiry dates (feat/expiry-dates) — awaiting owner review
- Snap the date on a package; Spark reads it; the user confirms; "Use soon"
  on Today and List. Demo has a "Try a sample date" button (no model call).
  SW arya-v69. Not yet tried with a live read on a real package.
