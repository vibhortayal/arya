# 2026-11-01 — Quest first-visit skeleton (re-audit N4)

Owner approved the mockup (artifact GeeciBSTmTGTxhoeLrpd2u) on 2026-11-01.
No model calls, $0.

## What changed
- The first visit to the Quest tab draws the home's shape at once
  (`QuestSkeleton` in `screens/quest/QuestMode.tsx`, styles `.qm-skel` /
  `.qms-*` in `styles.css`, since game.css is not loaded yet): title, the
  Play/Build bar, the picture, the main card with its button and two
  rows, at the real home's sizes and 680 px column. No shimmer. It
  replaces the "Opening Quest…" text in both loading spots; the status
  role and label stay for screen readers.
- A return visit already draws from the kept game profile (#337).

## Checks
`tsc -b`, `vitest run` (439) green; `vite build` ok. Browser at 390 and
1250 px with the profile read slowed: skeleton, then the home in place.
