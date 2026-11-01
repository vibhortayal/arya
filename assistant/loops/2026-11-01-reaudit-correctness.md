# 2026-11-01 — Re-audit fixes: correctness and Quest polish

Owner's Oct 31 re-audit (23 issues), checked against main @ 016da64 (#336).
No model calls, $0.

## What changed
- N1: a 401 "login required" from `/api/` on a signed-in tab ends the
  session (`lib/api.ts` sends `arya-session-ended`; `app/session.tsx`
  signs out locally). The start page shows a toast: demo "Arya was
  updated. Start the demo again."; account "You were signed out. Sign
  in again to keep going." A read still on its way during a normal sign
  out does not trigger it. Checked in a browser: restart the API under
  an open demo, tap a tab, the toast shows on the start page.
- N2: Quest columns (`.qg-home`, `.qg-pick`, `.qg-album`, `.qg-build`)
  cap at 680 px again (the host is `position: fixed`). Checked at 1250 px.
- N3: practice strollers stand still while a Quest sheet or the mission
  card is open (`World3D` `still`), step at 30 fps when only they move,
  and are not added on low-end phones.
- N5: boot.js's early `/api/today` is used only in the first 10 s, and
  any write drops it.
- N7: group live events clear the 30 s keeps (`forgetKept()`).
- N8: an open, visible app checks for a new build every 10 minutes.
- N10: the coach dot points near the left end of a wide button, off the
  "+10" chip.
- N11: `/api/town/hints` is kept 30 s like `/api/group`.
- #19: the Get the app glow animates opacity on a fixed shadow; the map
  reward bar grows with `transform: scaleX`.
- #38 was already fixed: the preview card sits under `aria-hidden="true"`.

## Not changed here
- #19 `.fr-hole` (Tour hole): moving it by transform would scale its
  rounded corners; it is one element moved between steps, cheap as is.
- Ask knowledge: `prompts/arya_features.md` says what the update message
  means. `docs/DEMO.md` notes that a deploy ends open demos.

## Checks
`npx tsc -b`, `npx vitest run` (59 files, 439 tests, 3 new) green; `vite build` ok.
