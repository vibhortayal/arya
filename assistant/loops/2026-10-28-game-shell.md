# 2026-10-28 — game shell, part 1: install, mobile, keyboard

Owner brief: make Arya Quest a complete, installable, offline,
mobile-first game inside Arya. Plan (state machine, loop, assets):
Claude Doc "Arya Quest game shell: state machine and asset plan".
The in-place vs. lives vs. separate-game call is with the owner; this
part is common to every option. Branch `feat/game-shell`, on top of
`fix/hunt-v2-rebuild`.

- Manifest: id/scope, standalone, light colors (#EFEFF1, matching the
  theme-color meta), 192/512 PNG icons and a maskable 512 (glyph in
  the 80% safe zone), plus an Apple touch icon and install metas.
  The icon moves from the old green to the app accent #E4572E.
- Hunt gestures: `body.hunting` is `touch-action: pan-y`,
  `overscroll-behavior: none`, `min-height: 100dvh` — no pinch or
  double-tap zoom, no pull-to-refresh mid-hunt; zoom stays available
  everywhere else (no maximum-scale in the viewport meta).
- Keyboard: Space/Enter start or grab, ←/→ aim at the previous/next
  open stop, P pause, F Finish, Esc Back (hunt, Express, Finish; an
  open sheet keeps Esc). Keys press the buttons the screen already
  has, so no rule is bypassed.
- Service worker arya-v37 pre-caches the icons.

Verification: suite 357 OK (1 skipped), new `test_pwa_install.py`;
Playwright keyboard drive on the demo household — all checks passed.

# Part 2: rewards — dopamine, never pressure

Owner ruling (same day): mobile first (keyboard is demo-only), no
lives or game over, no stress; upgrade the existing hunt, no new
game; keep feeding the four data purposes. Wireframes for review:
the "Arya Quest game flow wireframes" canvas (11 screens).

- Server: `social.hunt_points` (+10 per item, +25 full haul, +50
  receipt) and `social.level_for` (L2 at 100, L3 at 300, L4 at 600,
  +100 more each level); `/api/quest/profile` carries points and
  level. Points bank only for receipt-settled hunts (Discussion 41:
  the receipt is the proof); an unsettled hunt shows them waiting.
- Hunt HUD: a points chip replaces the clock on the Quest HUD (time
  still shows on Score); every grab floats +10 and bumps the chip;
  banners at 1/4, 1/2, 3/4; a cosmetic hot streak at 3+ quick grabs;
  all collected = banner, confetti, fanfare, +25. Express stays
  quiet (Discussion 32).
- Score: the haul counts up; banked hunts fill the level bar and a
  new level bursts; unsettled hunts say +50 waits for the receipt.
- Today shows a level chip; Profile gains a Level tile.
- Sound (Web Audio square blips) and buzz (vibrate) are opt-in via
  the HUD speaker, off by default, remembered per device.
- Confetti is one canvas on one rAF loop, ~1.8s, theme colors only;
  reduced motion drops floats, banners' motion and confetti.
- Rewards are wrapped so a missing API never fails a grab.
- Service worker arya-v38.

Verification: suite 365 OK (1 skipped); new `test_points.py`,
`test_rewards.py` (node: milestones in order, one burst, put back
recounts, Express quiet, sound off by default). Playwright drive on
the demo household: every check passed (HUD points, +10 float,
milestones, confetti shows and hides, Score 65 → banked 115 with the
level bar, Today level chip).

# Part 3: offline hunts

- A grab or put back that cannot reach the server (a network
  failure, never a refusal) applies on the phone and waits in an
  outbox in localStorage, in order. It replays on the `online` event,
  when a hunt opens, and before the next online grab; a refused op is
  dropped, the rest still sync. A banner says "Offline — keep
  grabbing" with the count waiting; "Back online — N grabs synced".
- `api()` keeps network failures a TypeError with a readable message.
- The shell and every store asset already viewed come from the
  service worker cache (network-first, cache fallback); Finish and
  receipts still need a connection. Unseen store photos are not
  pre-fetched (17 MB of frames is too much mobile data to take
  unasked).
- Service worker arya-v39.

Verification: suite 367 OK (1 skipped), new `test_offline_hunt.py`
(node: local apply, queue order, replay order, refusals never queued,
a refused queued op dropped). Playwright with the browser set offline
mid-hunt: two grabs counted and paid points offline, the banner
showed 2 waiting, and after reconnecting the server held both grabs.

# Part 4: learn to play — one view, How to play

User feedback via the owner: "don't understand how to play. What is
3D, Aisle, Photos, Strip?" Owner: "even I don't understand what and
why we need those 4 modes." Ruling (decision card): one automatic
view, 3D kept as a demo link.

- The four-chip view switch is gone. A mapped store shows its real
  photos; any other store shows shelf cards; a caption under the view
  says what it is. "See it in 3D ›" swaps to the point-cloud scan
  and "‹ Back to the photos" returns; only the picture changes. The
  Aisle map is retired from the hunt (scene.js keeps the driver).
  Old stored view choices are ignored.
- How to play: a sheet with three steps (find it, grab it, snap the
  receipt), shown once on the first Quest hunt on a device, reopened
  from "?". Skip, the button, the backdrop or Esc close it.
- "?" and the sound toggle moved to the end of the tools row so the
  store name fits the HUD at 390px.
- Service worker arya-v40.

Verification: suite 370 OK (1 skipped); new `test_howto.py`,
`test_photo_driver.py` rewritten for one view. Playwright: guide on
first hunt only, ? reopens, Esc closes; no switch, photo caption,
3D peek mounts the canvas and returns, the hunt still plays.

# Part 5: Find it for me, fresh shelf photos, people scrubbed

Owner: "Can we have a find it for me in the game? it opens the camera…
finds the product… highlights? then user clicks grab?" Then: "we can
scrub faces off… Say we don't store images of people, only products.
scrubbing can use a meta product?" Opt-in and privacy policy are
deferred past the hackathon (owner).

- "Find it for me" under Grab on the next-item card opens the scan
  aimed at that one item (`?item=`): one item's SAM + Spark calls.
  Status says "Found it! X is highlighted — tap it to grab", or that
  it was not spotted (never "not here"). Grabbing the target closes
  the scan after a beat.
- Every verified pop is a sighting (store, item, shelf label, time)
  for the store map.
- A frame that popped an item is kept as a fresh shelf photo only
  after SAM 3.1 finds every "person" / "human face" and they are
  pixelated (`shelfscan.scrub_people`). Fail closed: no scrub, no
  frame. Latest frame per store+item, downscaled to 960px, inside
  `shelf_frames.json` (sandbox capped at 12).
- The next-item card shows that photo with the verified box outlined:
  "Fresh from a shopper, 5 min ago. People are blurred out; we only
  keep products." The scan sheet says "We never keep pictures of
  people, only products".
- The 90 shipped walk-video frames show recognizable shoppers in
  about half. `harness/scrub_walk_frames.py` runs the same scrub over
  them in place (about $0.45; needs MODEL_API_KEY, so the owner runs
  it on the VM). Git history still holds the unscrubbed originals.
- Service worker arya-v41.

Verification: suite 378 OK (1 skipped): target filter, sightings,
scrub pixelates people and leaves shelves sharp, fail-closed paths,
the walk-frame script's in-place/skip/fail-closed behaviour.

# Part 6: Plan a hunt — store first, move items into the quest

Owner: "i pick my store. then i should be able to move things from my
list to my quest… my milk is typically bought from TJ, eggs from
costco." Then: planning is list management: untick keeps an item on
the list, remove takes it off.

- New hunt opens on "Where are you shopping?". Each store shows what
  is usually bought there, counted from receipts (`GET
  /api/quest/plan`, no model call). Stores seen on receipts but not in
  My Stores are offered too; "Costco" matches "Costco Wholesale".
- "Your quest at X" sorts the Arya list: usually bought here (ticked),
  new (ticked), usually from another store (unticked, stays on the
  list), and usuals bought here that are not on the list (unticked).
  ✕ removes an item from the Arya list (Undo on the toast); typed
  extras join the Arya list.
- Check my list shows only when something was merged, corrected or
  needs a choice.
- Demo household: eggs, rice, paper towels and batteries come from a
  same-day Costco run (39 receipts). The VM's demo data must be
  regenerated: `python -m harness.make_demo_household data`.
- Service worker arya-v42.

Verification: suite 382 OK. Playwright: store first with hints;
Costco plan puts milk/bread under "usually from Trader Joe's" and
suggests eggs; TJ plan ticks milk/bread; remove + Undo; typed oat milk
lands on the list; the hunt opens.
