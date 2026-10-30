# 2026-10-30 — Honest store coverage (Map my store)

Owner report: after three photos, Map my store said "Arya knows 100% of Whole Foods Market · 3 of 3 sections". Owner: find the root cause, not a one-user fix.

## Root cause
`storemap._coverage()` divided mapped sections by the sections that exist in the store's map. Sections are created by the capture itself (`/teach`, `/scan` call `add_segment`), so the denominator only grew with the numerator: every shopper-mapped store sat near 100%. The Trader Joe's walk used to seed baseline sections that acted as a denominator; #188 removed it and nothing replaced it. Every store, every user.

## Change
- `storemap.aisles_counted(doc)`: highest aisle number read, from `aisle_signs` (new, set by `note_sign` from the scan's sign read) and from "Aisle N" section zones.
- Expected sections = aisles + `PERIMETER_SECTIONS` (6). Seen = distinct mapped zones (both sides of an aisle are one). pct = seen / expected, capped at 100.
- No aisle number read: `expected` and `coverage_pct` are None, `goal` None. The view also returns `seen`, `aisles`, `expected`.
- Map my store: "Arya has seen 6 of about 20 sections · 14 aisles counted from signs", or "Arya has seen 3 sections of X" plus a line to pan across the aisle signs. "Knows this whole store" only at 100%.
- Capture reward card hides the % bar while the size is unknown. Album chapters: "N sections seen so far" until sized.
- Quest's own coverage (10-section template, appSource.ts) is unchanged.

## Tests
New `TestHonestCoverage` (5) + scan sign test; 8 tests that pinned the old 100% updated. Full suite: same 8 failures as main, none new. Vitest 388 pass, tsc clean.

## Next
Background scan jobs + full-screen scan (separate PR, mockup FUb4AYjHUUVUWMVKdYTQcZ approved).
