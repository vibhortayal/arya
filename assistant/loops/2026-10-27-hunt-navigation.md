# 2026-10-27 — Navigation-first hunt (Discussion 35 + 36)

The hunt screen is the store. One commit carries both the
navigation-first behaviors (35) and the full-screen layout (36) —
the layout instruction arrived before the card layout was built,
so there was nothing to fold in twice.

## What changed

- **Full-screen portrait frame.** view-hunt and view-express become
  fixed full-viewport layers while open (body.hunting hides the tab
  bar, locks scroll; the toast rides above at z-70). The scene mount
  fills the frame: the cloud wrap goes full-height, the strip band
  centers vertically, the aisle SVG fills with
  preserveAspectRatio="xMidYMid slice". A photo-style driver inherits
  the same contract (mount = viewport; render cover) — its
  blurred-fill treatment lands with that driver, which is part of
  the separate 3D decision, not this stage.
- **Top overlay — Up next.** The next 3 unchecked stops in route
  order (item + shelf label from the item–shelf matcher), current
  first and largest (23px), over a semi-transparent blurred card
  that leaves the scene's center clear. The store/mode line heads
  it; the old hunt-mapnote folds in as its footer line.
- **Auto-follow.** qWalkStart glides the scene to the current stop
  and starts a walk timer (Quest 3200 ms, Express 2000 ms); on
  expiry the stop has "arrived" and its pop rises. Pause (corner)
  freezes the walk; resume restarts an unfinished walk. Any manual
  navigation — a touch on the scene, a view switch — calls
  qFollowHold: the walk holds, the current stop presents at once,
  and following resumes only at the next collect. In the demo this
  timer IS the simulated walk (Discussion 35: judges are seated);
  in the store the same arrival is what the localization stack
  will anchor.
- **Arrival pop = the collect surface.** Item name (26px), shelf
  label, a character slot (data-char-slot, filled by sub-stage 2),
  the reported-missing warning when flagged, and ONE big GRAB —
  full-width, 60px — bound to the current stop only (collectCurrent
  / qNextIndex, unchanged semantics; marker taps still collect
  through the same path as the seated fallback). "Not here" sits
  under the GRAB inside the pop. Before the start the pop is the
  Ready card with Start; after the last item it is the done card.
- **Bottom overlay — route progress only.** The route strip (dots
  in route order: done = check, current = ringed accent, ahead =
  dim) plus the collected count ("4 of 8"). Exit/pause/list live in
  a small corner stack (44px round buttons, drawn SVG icons; pause
  swaps to a play glyph when paused). The session rail and the
  scene-driver switch moved into the trip panel (the old list
  panel), which is also where the checklist lives.
- **Express wears the same frame**, minus the game: strip driver
  as its store view, faster walk, GRAB checks the current stop,
  the route dots double as any-order checks, the full checklist in
  its run panel. No celebration in Express.
- The hunt clock display is gone (Discussion 36: progress, not
  time, is the glanceable). startHuntTimer is no longer called
  from renderHunt; session timing still derives from timestamps
  at scoring.

## Celebration hook

Sub-stage 2 (characters + facts) is not in the tree yet, so the
celebration cannot fire — but its wiring is done: GRAB and marker
taps collect through collectCurrent, which calls qOnCollected(name)
exactly once per collect. When the celebration lands it fills the
pop's character slot and hooks that one call; nothing else moves.

## Verification

- Suite: **187 green** (6 new in tests/test_hunt_nav.py).
- The node harness runs the real quest.js against DOM stubs and a
  recording post() stub — 18/18 checks: route strip order/labels,
  up-next order + first-row emphasis + shelf label, the pop-state
  matrix (ready / traveling-hidden / arrived-stop / done), GRAB
  collects exactly the current stop twice in a row, walk arrival
  after the interval, manual hold arriving at once and staying,
  leaving the frame stops the walk, Express GRAB + any-order dot.
- Not verified here: the full-screen frame in a real browser at
  phone size (headless DOM stubs absorb layout). The owner's phone
  pass is the gate, as with the restyle.

## Next

- Sub-stage 2 celebration fills data-char-slot + qOnCollected.
- Motion navigation (Discussion 33) restores from the stash on top
  of this frame: gyro/step controls re-home into the trip panel.
