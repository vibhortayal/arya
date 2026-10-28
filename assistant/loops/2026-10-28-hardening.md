# 2026-10-28 — Hardening pass over the 2026-10-28 code review

Overnight Phase 1. Every finding in Claude's review
(`arya-review-2026-10-28`) verified against the code first, then
fixed, refuted, or deferred per the overnight brief's scope.
Nine local commits on main (not pushed — the parent reviews,
pushes, deploys). Suite: 270 → **317 green**. SW cache arya-v32.
No model calls were made by this pass; no spend.

## Dispositions

| Finding | Disposition |
|---|---|
| H1 blocking Meta calls on the event loop | **Fixed** `d2f195e` — all model work (decode, judge, transcribe, chat, eyes, list reads, shelf scan, quest session/shop-off creation) runs via `run_in_threadpool` (20 call sites); CPU-bound `locate` wrapped too, same defect class. Proof: `tests/test_event_loop.py` — /health answers in <1 s while a 2 s decode is in flight. Pure-code routes (optimizer) verified model-free, untouched. |
| H2 non-atomic, unlocked JSON store | **Fixed** `82da728` — writes are temp-file + `os.replace`; every load-modify-save cycle in state/auth/quest runs under a per-file RLock. Proof: `tests/test_store_atomic.py` — parallel flag writes, quest checks, session minting lose nothing; a reader during heavy writes never sees a partial file. |
| H3 Meta errors → bare 500s | **Fixed** `fbc7236` — non-JSON gateway bodies, timeouts, URLError, and wrong-shape 200s all map to RuntimeError; routes keep answering 502. Proof: unit tests per failure mode + a route-level timeout test. |
| H4 demo shares the real budget cap | **Fixed** `e2dfee3` — ledger rows carry a bucket; the demo's four live doors spend from the demo bucket under its own cap (default $2/day, `ARYA_DEMO_DAILY_BUDGET_USD`); the app guard counts app rows only, so demo spend can no longer pause real accounts. Demo minting capped per IP (`ARYA_DEMO_AUTH_RATE`, 120/h) and live doors too (`ARYA_DEMO_DOOR_RATE`, 240/h, in the middleware). Expired sessions pruned on write. Judge experience unchanged. |
| M5 plaintext sessions + spoofable limiter key | **Fixed** `a2deeab` — sessions stored under SHA-256 (API-token scheme); pre-hardening plaintext sessions migrate on first use, so nobody is logged out at deploy. Login limiter keys on the LAST X-Forwarded-For entry (the one Caddy appended), tested against rotating spoofed first entries. |
| M6 malformed input 500s + flag mass-assignment | **Fixed** `9a1e4f3` — every JSON route parses through `_json_body`/`_json_obj` (400, never 500); the flag route writes only the ten real flag keys and rejects a body with none; qty/check require item_id (the null-key write is gone); idx fields coerce with a 400. Proof: `tests/test_validation.py`. |
| M7 two clocks, one UI | **Fixed (brief scope)** `6a95e6e` — the Today header renders the real date; `as_of` appears only as a labeled "Data through" line. The brain's as_of anchoring itself is deliberate design (patterns are computed as of the newest data) and was NOT rewired — changing it would change a product rule. |
| M8 stale items / near-duplicates | **Deferred** — not among the brief's 13 Phase 1 items; it is curator/product-rule territory (which near-duplicates merge is the owner's call, cf. the Raspberry/Raspberries pair). |
| M9 List: N+1 item calls, no loading state | **Fixed** `542d1d9` — `/api/home` ships `price_by_store` for list items (same aggregation as `item_detail`); the List paints with zero per-item requests and shows a loading state first. |
| M10 friends are a single-account stub | **Fixed** `340c4a6` — request/accept mirror handle+status into both accounts' own quest.json stores (nothing else crosses: badge/hunt fields start None and are never copied); unregistered handles are a 400; mutual requests accept both sides; Shop-Off now requires a registered opponent. Proof: `tests/test_friends.py`, the two-account HTTP round trip from the brief. Existing TestSocial/TestShopOff updated to register the accounts they use. |
| M11 Caddy: no CSP/HSTS, silent HTTP login failure | **Fixed** `d7d6d11` — HSTS (1y, includeSubDomains) + a same-origin CSP (the one inline theme script and inline styles are why script/style carry 'unsafe-inline'); the `:80` catch-all now redirects permanently to the canonical HTTPS name, ending the silent Secure-cookie login failure on every plain-HTTP path. Caddyfile syntax could not be validated on this VM (no caddy binary); it uses canonical directives and the parent's deploy reload will fail loudly if wrong. Sub-point deferred: `/health` also returns a receipt count — not in the brief's item text; flagged for the owner. |
| L12 input surface (eyes kind, negative idx, open prefixes) | **Partial** — eyes `kind` allowlist + negative-idx 404 fixed in `9a1e4f3`. The `_OPEN_PREFIXES` constant is verified dead code (defined at main.py:79, referenced nowhere; the middleware matches path prefixes directly) — left in place, removal is cosmetic and outside the brief. A deny-by-default middleware rewrite is likewise outside the brief. |
| L13 Postgres migration | **Deferred per brief** — pre-flip list. |
| L14 repo binary hygiene | **Deferred per brief** — pre-flip list. |
| U1 List density | **Fixed** `542d1d9` — no store tags in the All lens (detail lives in the item view); the store filter is one horizontally scrolling row. |
| U2 blank states | **Fixed** `542d1d9` — List loading state; Eyes empty state; Ask opens with a prompt line + three suggestion chips that fill and submit the form, and the chat input can shrink (`min-width: 0`) with a slimmer Send button so the placeholder shows in full. |
| U3 token row squeeze | **Fixed** `8bcad67` — token rows wrap; the status text gets a 160 px basis. |
| U4 wrong Today date | **Fixed** `6a95e6e` — same fix as M7. |
| U5 /auth/me 401 noise | **Fixed** `8bcad67` — signed-out answers 200 `{user: null, demo: false}`; boot branches on `me.user`. |
| U6 copy/IA | **Partial** — the "Hunts" tile now reads "Hunts finished" (the count is done sessions under the verified-only rule; the label was the bug, not the count). The Analysis "coming next" promise and the Prepared-cart/Approve wording are product-copy decisions — deferred to the owner, not rewritten unilaterally. |
| U7 sign-out tap target | **Fixed** `8bcad67` — header Sign out is an inline-flex target with 44 px min-height. |

## Top gap (unbuilt feature, not a defect)

Friends now exist across accounts, but nothing tells a friend
when a hunt starts or finishes — there is no notification
engine. Reported, not built: it is a feature with product
choices inside it, outside the hardening brief.

## Notes for the deploy

- Live sessions migrate to hashed keys on first use — no forced
  logout at deploy.
- The owner's live flags.json still holds the junk empty record
  for item "x" from the reviewer's probe (M6 evidence). The flag
  allowlist prevents new ones; the record itself is removed in a
  separate, backed-up live-data step after these commits land.
- Heads-up received mid-run: `quest.py` DRIVERS lacks "photo"
  (owner-hit live bug) — Spark hotfixes that separately; this
  pass's quest.py changes are all in `340c4a6` and do not touch
  the DRIVERS line.

## Commits

82da728 H2 · fbc7236 H3 · d2f195e H1 · 9a1e4f3 M6+L12 ·
a2deeab M5 · e2dfee3 H4 · 340c4a6 M10 · 6a95e6e M7/U4 ·
542d1d9 M9/U1/U2 · 8bcad67 U3/U5/U6/U7 · d7d6d11 M11 ·
plus this log, STATUS, and the arya-v32 SW bump.
