# STATUS — where Arya stands (updated 2026-10-27)

**Current stage: Stage 6 — hardening + UX pass (2026-10-27). Stages 3–4 and Ask Arya chat are LIVE. The full UX review (assistant/docs/UX-REVIEW.md, 21 findings) is implemented: Apple design-system rebuild, list add/remove/qty/check-off, review-queue actions, voice in Ask, and the staple judge (reasoning model) gating list admission over the deterministic pattern facts. Stage 5 (store add-on) is HELD by the owner until grocery features close. Remaining for submission: judge sweep verification on owner data, demo video, final submission package (owner go-ahead required). Public HTTPS is up at the stable name **https://arya-pilot.duckdns.org** (owner's DuckDNS, set to the VM IP 165.1.78.155; Caddy obtained a Let's Encrypt certificate 2026-10-27 — validation succeeded, so ports 80/443 are publicly reachable). The Cloudflare quick tunnel remains as a backup door. DuckDNS updater installed on the VM (systemd timer, 5 min; token in ~/.config/duckdns/token, 600, VM only — verified OK). AUTH IS LIVE: accounts + session cookies, per-user data; the API returns 401 signed-out; first-run setup is open for exactly one account, which adopts the seeded household data. Try-the-demo is LIVE: the login screen offers a synthetic demo household (fictional, 27 receipts, read-only — writes return 403, zero model calls). Remaining: the owner creates his account and does the phone check. Stages 0–2 done except the photo path (Gate 0 VERDICT (2026-10-27): PASS on the gate metric (product identity + paid price) - public set 91.84% (90/98), combined with the owner subset 93.85% (122/130); arithmetic 7/7. Caveats: abbreviation expansions separate the strict-string metric (81.6%), faded vintage print misreads digits (flagged for review), one silent price-rotation in pub-05 (review queue is the mitigation). Public set reached 9 receipts, not 16 - hand-labelability was the binding constraint; sourcing record is in the research repo's GATE-REPORT.md.**
Deadline: submission Nov 4, 2026, 9:00 PM ET.

| Stage | State |
| --- | --- |
| 0.5 Spikes | Spike 1 PASS (PDF decode 7/7 arithmetic). Spike B closed: owner plan B — uploads/exports. Gate 0 photo decode: owner subset 32/32 lines; public subset running (external). |
| 0 Foundations | Repo + layout ✓ · model policy ✓ · meta_client + cost_ledger ✓ (6 tests green) · eval harness skeleton ✓ · Oracle skeleton LIVE ✓ (db healthy, api + caddy up on the VM; GET :8081/health returns ok) · owner provisioned the Oracle API key 2026-10-27; live decode verified on the VM (Standard, $0.0054/call, ledger row written) |
| 1 Decode API | In progress. Prompt v2 written (versioned file). JSON import + PDF-text decode built, 10 tests green; real-corpus smoke: 114/114 reconcile, 1,058 item / 118 discount / 50 return lines typed, 5 orphan discounts flagged. Photo path waits on Gate 0. Dictionary v1 BUILT: 458 entries (10 fee-class), ORG BELLAS resolved = Organic Baby Bella Mushrooms (0.90); 2 entries honestly unresolved (KS Blueberry, KS Vanilla — review-queue material). Dictionary data lives in the staging area, not git. |
| 2 Patterns/list/cart | DONE (v1). Ledger 1,074 entries; 91 patterns; returns netted FIFO; lapsed state for items the household stopped buying; list requires >=3 kept purchases. Staple check: egg whites every ~21d (x35), spinach ~22d (x30), pasture eggs ~34d (x25) — all correct, none due after the Oct 26 trip. Known limit: seasonality not modeled (annual items read as long intervals). |
| 3 PWA-core | LIVE. Auth + per-user data; first account (owner) adopted the 114-receipt household. Demo household live and read-only. |
| 4 Eyes + chat | LIVE. Eyes dual-judge sightings with confirm/reject; Ask Arya chat with server-validated actions; voice input + spoken replies (Stage 6). |
| 5 Store add-on | HELD by owner (needs TJ walkthrough video + paper receipt). |
| 6 Hardening/UX | IN PROGRESS. UX review implemented + deployed; Impeccable vendored (.claude/skills/impeccable); PRODUCT.md + DESIGN.md written. |

## Data staging (owner data — NOT in this repo)
114 Costco receipts (2023-10-25 → 2026-10-26, 1,226 lines, 114/114
arithmetic) staged in the Hatch workspace
`meta-hackathon-2026/imports/costco-json/` with STAGING-REPORT.md; the
report is in the research repo. Raw files stay out of git.

## Blockers / owner items
- Oracle API key: owner installs into the Oracle env when the skeleton stands.
- Public hostname for the PWA (subdomain vs tunnel): owner choice, Stage 3.
- Trader Joe's walkthrough + paper receipt: owner's next natural shop (Stage 5 input).

## Connector (2026-10-27)
Muse is an intake surface: per-account API tokens (Home card "Use Arya
from Muse" mints; hash-only storage), the custom.arya connector +
bin/arya.py CLI, order-text intake for forwarded online orders. Live
proof done (read on the owner account; write on a scratch account).
Distribution: registration opens after the hackathon with a
"Muse is the only way in" notice; per-user spend caps first.

## Evening addendum (2026-10-27, later)
- **ARCHITECTURE.md added** (assistant/docs/): the as-built record — two
  layers (edge perception in the user's Muse, core verification and
  reasoning in Arya), intake paths, the agents and their limits, the
  connector, onboarding, cost control, deployment. SPEC.md gained rules
  8–10 (discounts are structure; research proposes, the user disposes;
  no silent identity edits) and both living docs carry the evening
  revision notes.
- **Resolver LIVE**: POST /api/review/suggest takes researched
  candidates with source URLs for unresolved items AND for single
  unverified receipt lines. First runs on owner data: 5 of 7 unresolved
  items identified from Costco's own catalog pages; 4 receipt lines
  identified by item number (Bissell 3857P, Cole Haan socks, KS fleece
  zip, Puma crew socks). TNWMNPRBTC and TB DRESSSOCK have no catalog
  match and stay open — no guesses posted.
- **Discount lines are structural**: always auto-verified in decode,
  never queued (code rule, all paths). The owner's 6 queued discount
  lines were cleared; the line queue holds only real questions.
- **Curator reconcile**: proposals the dictionary has already overtaken
  (already one group, duplicates, splits already in effect) retire as
  "superseded" when the queue is read, and already-grouped clusters are
  never proposed again. Of the owner's 23 pending proposals, 21 were
  already in effect; the queue now shows only genuine judgment calls.
- **Connect-step upgrade**: numbered steps for both halves of the setup
  plus a copyable fallback setup prompt (connect view + Profile).
- Hotfix: bindItemLinks helper (dropped in the Stage 6 file split)
  restored after the owner hit "Could not load" on Home.
- Suite: 60 green. sw arya-v12.
