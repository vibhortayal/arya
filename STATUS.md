# STATUS — where Arya stands (updated 2026-10-27)

**Current stage: Stage 0 — foundations (in progress).**
Deadline: submission Nov 4, 2026, 9:00 PM ET.

| Stage | State |
| --- | --- |
| 0.5 Spikes | Spike 1 PASS (PDF decode 7/7 arithmetic). Spike B closed: owner plan B — uploads/exports. Gate 0 photo decode: owner subset 32/32 lines; public subset running (external). |
| 0 Foundations | Repo + layout ✓ · model policy ✓ · meta_client + cost_ledger ✓ (6 tests green) · eval harness skeleton ✓ · Oracle skeleton — next · owner provisions Oracle API key — owner's hand, at that step |
| 1 Decode API | Not started. Inputs: PDF text, JSON import, photo. Prompt v2: savings fold, line types, allocation. Dictionary v1 from the staged corpus. |
| 2 Patterns/list/cart | Not started. Deterministic code on staged history. |
| 3 PWA-core | Not started (no pwa/ folder before this stage). |
| 4–6 Eyes/store/hardening | Not started. |

## Data staging (owner data — NOT in this repo)
114 Costco receipts (2023-10-25 → 2026-10-26, 1,226 lines, 114/114
arithmetic) staged in the Hatch workspace
`meta-hackathon-2026/imports/costco-json/` with STAGING-REPORT.md; the
report is in the research repo. Raw files stay out of git.

## Blockers / owner items
- Oracle API key: owner installs into the Oracle env when the skeleton stands.
- Public hostname for the PWA (subdomain vs tunnel): owner choice, Stage 3.
- Trader Joe's walkthrough + paper receipt: owner's next natural shop (Stage 5 input).
