# 2026-10-27 — Arya Quest Stage B (playable UI)

Owner approved the wireframes, then decoupled the playable UI from
the 3D spike: the full Quest UI builds now in the PWA, and the Hunt
scene is a swappable viewport. Stage B wires the Stage A engine
(sessions, Optimizer, Shop-Off, friends/profile/badges) into screens.
No model calls anywhere in this stage — all deterministic code, $0
spend. NOT deployed; the owner deploys separately (git pull).

## Commits
- `a746e00` B1 receipt archive read: GET /api/quest/receipts and
  /{id} (social.receipt_archive / receipt_detail) — the one read the
  Profile archive genuinely lacked. Photos are not retained by the
  decode paths today (image_ref is None), so the photo field is
  honestly null until one exists.
- `56cffb1` B2 playable PWA: Today hub Games section (session cards,
  New hunt, Community + Quest profile entries); the new-hunt flow
  (type/paste or start from the Arya list -> pick store -> Optimize
  screen -> mode choose); Hunt (SceneView, Next banner, COLLECT,
  pull-up list panel that auto-dismisses after a check, session
  rail, pause, clock); Express (walking-order checks, live ETA);
  Finish (receipt photo via the existing decode path, or an
  already-filed receipt); Score (verified haul, time, badges from
  /api/quest/profile with New pills). Optimize screen rules kept:
  merges shown, corrections carry Undo and are never silent,
  question chips include Both / Keep as typed, and unanswered
  questions disable the start path.
- `ee85e36` B3 Community (scope chips; the Household Fastest Hands
  board computed from done sessions, duration = hunt start to the
  receipt's own timestamp, min 8 items; wider scopes say plainly
  that no hunts exist there yet), Shop-Off (races derived from
  session shopoff_ids, live progress, winner by receipt time,
  Friends-challenge prefill), Friends (add/accept, top badge + last
  hunt + Challenge; no chat), Quest profile (public card, badge
  shelf, mapped stores, private receipt archive with digitized
  twins; Analysis stays a greyed "Coming next" placeholder).
- `0f623e0` B4 Spotter (owner scope addition, GAME-DESIGN "Store
  drift & the Spotter economy", demo slice): POST
  /api/quest/sessions/{id}/report-missing {item, kind, photo?},
  kind in empty_shelf | replaced | cant_tell; reports live in
  quest.json in state "reported" (lifecycle reported ->
  resolved_stockout | verified_move carried as data; transitions
  are rollout). One open report per stop (idempotent). GET
  /api/quest/stores/{store}/reports — normalized store matching
  with a squashed-form fallback ("Trader Joe's" == "trader joes";
  two test failures taught the tuple-key and apostrophe lessons).
  Eagle Eye joins the badge shelf, earned only at verified_move —
  locked pre-launch, like First Mapper. Profile stats gain
  spots_reported. Hunt screen: "Not here" opens the three-choice
  sheet + optional shelf photo (photo rides as a file-name
  reference in this slice; upload/storage is rollout); open reports
  flag their stops on every driver and in the Next banner.

## SceneView driver ladder (owner requirement, folded into B2)
The session engine is the game; the scene is only a viewport.
Drivers implement one contract (setStops / setNext / glideTo /
onTapStop / destroy): "cloud" (stub interface for the VGGT
point-cloud driver), "aisle" (the stylized SVG scene — Stage B's
original "placeholder", renamed), "strip" (first-class 2D shelf
cards in walking order; the strip scrolling is its walk animation).
Sessions record their starting driver, validated server-side
against the ladder; play, scoring, and the receipt finish never
read it. Strip is the default — an unmapped store plays in full,
and the map invitation rides on the hunt screen as a note ("map
this store to unlock the 3D view"), never as a gate. The in-hunt
toggle drops aisle -> strip mid-hunt with session state untouched
(state lives in the screen, drivers are pure views).
TestDriverLadder plays the same hunt through strip and aisle and
asserts identical completion and badge outcomes.

## Verification
- Suite: 71 -> **78 green** (+2 archive, +2 ladder, +3 Spotter).
- node --check on app.js / scene.js / quest.js.
- Local serve smoke (uvicorn, throwaway data dir): shell + both new
  scripts 200; setup -> optimize (milk x2 merged) -> strip session
  -> play -> report-missing -> store reports read-back (count 1) ->
  profile (spots_reported 1, eagle_eye present and locked). Zero
  errors in the server log. No browser pass — subagent has no live
  browser; DOM behavior is code-reviewed, endpoints are proven.

## Scoped down / notes
- Express ETA is a display estimate from the real remaining count
  (2 min/item + 2), labeled with ≈; it is not stored data.
- Shop-Off opponents remain Stage A's in-account placeholders; the
  race screen says so and routes the opponent's hunt through its
  session card.
- The receipt finish's photo path spends through the existing
  decode route (budget guard applies); the demo household stays
  read-only, so Quest writes there return the API's 403 text.
- Next: owner review + deploy (git pull on the VM). Then the cloud
  driver against the TJ point cloud when the spike verdict lands.
