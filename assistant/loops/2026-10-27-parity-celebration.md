# 2026-10-27 — Wireframe parity pass + collect celebration

Two sub-stages, separate commits, local on main (parent reviews,
pushes, deploys). Suite before: 203 green.

## Stage 1 — Wireframe parity pass

Sweep of the live PWA against the approved "Arya Quest —
Wireframes" set (Quest screens, Brain B1–B6, Stores S1–S3),
structure and design language only: no behavior or copy-meaning
changes. Per screen — what was off, what changed:

- **Today (hub).** Off: quest.js carried a second, never-called
  renderer for #quest-sessions (renderQuestHub) writing a different
  row style than the live one (app.js paintTodayGames). Dead code
  removed; the delegated #quest-sessions click handler (the live
  path for game rows) stays. No visual change to the live screen.
- **Quest profile (wireframe screen 12).** Off: view-qprofile was
  orphaned — no data-qnav target and no questGo caller ever named
  it; B6 Profile (view-profile) already carries the same public
  card, badges, and mapped stores. Whole dead surface removed:
  the section, renderQProfile, the questGo branch, the qp-receipts
  listener. openReceipt stays (Receipts archive opens it).
- **Finish (screen 7).** Off: the screen's one primary action,
  snapping the receipt, rendered as a bare file input inside the
  card. Changed to the Add tab's established pattern — hidden input
  + `btn primary wide` label ("Snap the receipt"). Same input, same
  change handler.
- **Mode (screen 4).** Off: the two mode cards sat inside a
  `.group.pad` card — card-in-card chrome. Unwrapped; the mode
  cards are the screen content, on the page background.
- **Receipts (B4) + receipt detail (screen 14).** Off: both are
  Brain surfaces, but their back links ran through the quest stack
  (`.qback` → questBack), landing on Today with the Profile tab
  still highlighted. Receipts now records which Brain view opened
  it (Today eye row or Profile) and its back link returns through
  that tab's own entry; the detail's back returns to Receipts (its
  only opener). New ids rc-back / rcd-back, class backlink —
  presentation identical to qback (plain accent link; neither class
  carries a CSS rule).
- **Verified, no change:** List (B1, store lens + why-lines), Add
  (B2 one surface + Eyes confirmations), Ask (B3 action chips,
  drawn-SVG mic/speaker), Analysis (B5 live + coming-next tiles),
  Profile (B6 unified), New hunt, Store pick, Stores S1–S3,
  Optimizer (one primary, blocking Ask), Hunt/Express (full-screen
  frame, Discussions 35/36), Score, Community, Shop-Off, Friends,
  Login, Connect. Emoji scan of index.html/app.js/quest.js/scene.js:
  zero stock emoji in chrome (drawn SVG throughout); back links
  share one unstyled accent treatment on every sub-screen. The
  Shelf Scan overlay's dark camera surface stays — it is a
  viewfinder, not app chrome (light-mode rule).

Pins: tests/test_parity.py (9 tests) — dead surfaces stay gone,
finish/mode/one-primary structure, back-link wiring, emoji ban.
Suite after Stage 1: 212 green.

## Stage 2 — Collect celebration (Discussion 32)

(filled in with the Stage 2 commit)
