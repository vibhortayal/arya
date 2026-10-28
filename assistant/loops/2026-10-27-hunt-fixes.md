# 2026-10-27 (late) — Hunt fixes from the owner's phone test (Discussion 44)

Two fixes, one batch. Owner's words: collecting must be
non-sequential ("maybe the ordering is not correct, maybe the
items have moved, maybe I'm not following the recommended
path"), and the celebration "pops up in the middle of the
screen which is blocking the view — make them smaller and put
them in an empty space."

## Fix 1 — collect in any order

- New steer: `Q.focusIdx` + `qCurrentIndex(sess)` — the stop the
  hunt presents. Quest mode only; Express keeps
  first-uncollected semantics (its checks are toggles).
- `qRetarget(sess, idx)` after every collect: the next
  uncollected stop after the grabbed one, else the first
  uncollected, else -1 (complete). Sequential play reduces to
  exactly the old behavior.
- `collectStop(idx)` is the one collect path: the arrival pop's
  GRAB (via `collectCurrent()`), the new per-row rail GRABs
  (`data-up-grab`), and marker taps. Shelf Scan pops and list
  panel checks re-target too when they collect the presented
  stop. "Not here" now reports the presented stop.
- Marker taps: `qTapStop(idx)` — tapping the presented stop's
  marker grabs it (as before); tapping any other unchecked
  stop's marker steers the hunt to it and its arrival pop rises
  with the GRAB. The walk, step anchor, step-advance, and the
  localizer anchor all follow the presented stop.
- The Up-next rail lists up to 3 remaining stops in route order
  from the presented stop, wrapping to the route's start.
- Copy: GAME-DESIGN's family case no longer claims the game asks
  the child to follow the list "exactly, in order."

## Fix 2 — celebration placement

- `.celeblayer` is a compact corner card: bottom-left above the
  route bar (`bottom: calc(64px + env(safe-area-inset-bottom))`,
  `left: 12px`), `max-width: 55vw`, character 52px (cap 56),
  fact text 13px. The wireframe reference places the card
  bottom-left; the app matches the corner. The center-screen
  speech-bubble layout and its tail are gone.
- Behavior unchanged: Quest mode only, 3.5s auto-dismiss, tap
  dismisses, single instance, reduced-motion fade.

## Verification

Suite 267 → **270 green**. New: a 17-check node harness
(any-order collects, wrap re-targeting, rail GRABs, marker-tap
present/grab, sequential parity, Express untouched), shell pins
for the new functions, and CSS-token pins for the card's anchor
and size caps. SW cache arya-v31. No model spend.
