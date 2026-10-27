# STATUS — where Arya stands (updated 2026-10-27)

**Current stage: Stage 3 — PWA-core LIVE on the VM (v1). Public HTTPS is up at the stable name **https://arya-pilot.duckdns.org** (owner's DuckDNS, set to the VM IP the VM; Caddy obtained a Let's Encrypt certificate 2026-10-27 — validation succeeded, so ports 80/443 are publicly reachable). The Cloudflare quick tunnel remains as a backup door. DuckDNS updater installed on the VM (systemd timer, 5 min; token in ~/.config/duckdns/token, 600, VM only — verified OK). AUTH IS LIVE: accounts + session cookies, per-user data; the API returns 401 signed-out; first-run setup is open for exactly one account, which adopts the seeded household data. Remaining: the owner creates his account and does the phone check. Stages 0–2 done except the photo path (Gate 0).**
Deadline: submission Nov 4, 2026, 9:00 PM ET.

| Stage | State |
| --- | --- |
| 0.5 Spikes | Spike 1 PASS (PDF decode 7/7 arithmetic). Spike B closed: owner plan B — uploads/exports. Gate 0 photo decode: owner subset 32/32 lines; public subset running (external). |
| 0 Foundations | Repo + layout ✓ · model policy ✓ · meta_client + cost_ledger ✓ (6 tests green) · eval harness skeleton ✓ · Oracle skeleton LIVE ✓ (db healthy, api + caddy up on the VM; GET :8081/health returns ok) · owner provisioned the Oracle API key 2026-10-27; live decode verified on the VM (Standard, $0.0054/call, ledger row written) |
| 1 Decode API | In progress. Prompt v2 written (versioned file). JSON import + PDF-text decode built, 10 tests green; real-corpus smoke: 114/114 reconcile, 1,058 item / 118 discount / 50 return lines typed, 5 orphan discounts flagged. Photo path waits on Gate 0. Dictionary v1 BUILT: 458 entries (10 fee-class), ORG BELLAS resolved = Organic Baby Bella Mushrooms (0.90); 2 entries honestly unresolved (KS Blueberry, KS Vanilla — review-queue material). Dictionary data lives in the staging area, not git. |
| 2 Patterns/list/cart | DONE (v1). Ledger 1,074 entries; 91 patterns; returns netted FIFO; lapsed state for items the household stopped buying; list requires >=3 kept purchases. Staple check: egg whites every ~21d (x35), spinach ~22d (x30), pasture eggs ~34d (x25) — all correct, none due after the Oct 26 trip. Known limit: seasonality not modeled (annual items read as long intervals). |
| 3 PWA-core | LIVE v1 on the VM (:8081): Home (running low with date ranges, list, prepared cart + approve), Scan (JSON import, text decode, review queue), Dashboard (spend/returns/for-others/trips, by month/store, top items), item detail (cadence, price by store, history, add-to-list / never-suggest). Seeded with the real corpus: 114 receipts. Review queue: 12 lines + 1 name. |
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
