# 2026-11-03 - Quest-start location check

- Added `judge`/`hereAt` to `web/src/lib/geo.ts` (300 m or GPS accuracy, memory only, never stored).
- Quest: `game/ui/Locate.tsx` shown before a quest at a store with coordinates; every outcome ends in Start Quest.
- Map my store: live walk only when near (or Demo Town); otherwise upload a video or photos.
- Help, Ask knowledge (feature sheet stays under 26,000), privacy page, README, STATUS, SPEC, JUDGES, DECISIONS updated.
- Tests: geo.test.ts; full web suite 560 pass.
- Next: Tester on phone viewports, real-device check indoors.
