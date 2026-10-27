# 2026-10-27 — Arya Quest Stage A (engine)

Owner approved the pivot and the build start ("start Stage A, run VGGT
on Modal in parallel"). Stage A is engine-only: sessions, the
Optimizer, Shop-Off, friends/profile/badges, and the connector's
quest-add. Design source: arya-quest/docs (ARCHITECTURE §2/§2b,
GAME-DESIGN community layer, UX.md session model). No model calls
anywhere in this stage — all deterministic code, $0 spend. NOT
deployed; the owner deploys separately.

## Commits
- `41c099d` A1 sessions: `api/quest.py` — a session is one store trip
  {store, mode quest|express, state machine, items, timestamps,
  receipt_id} in a per-account `quest.json` (added to the first-account
  adoption list). Item adds merge quantity on product identity: the
  dictionary group representative via `group_map()`, with exact then
  token-subset name resolution (typed "milk" finds "Whole Milk 1 gal";
  ambiguity stays unresolved at this layer — asking is the
  Optimizer's job). Endpoints under /api/quest/sessions incl. check,
  state (stamps started_at/finished_at), and receipt attach (receipt
  must exist; attach closes the session as done).
- `2673256` A2 the Optimizer: `api/optimizer.py` + POST
  /api/quest/optimize. Merge duplicates into summed quantities,
  correct typos against the dictionary (exact normalized, token
  coverage, difflib ≥0.80, per-token ≥0.75 with plurals squashed),
  and ASK when candidates split on distinguishing tokens (organic /
  frozen / fresh / whole / oat / …) — the Curator's never-merge-
  distinct-products doctrine at list time. Unresolved entries (incl.
  dictionary entries still marked unresolved) are never used as
  correction targets. Report: in/out/merged/corrected/questions/
  unresolved. Bug found by tests: an exact base-name match
  ("blueberries") must not hide its organic/frozen variants — the
  candidate pool is exact + fuzzy, and the split decides.
- `2ed3498` A3 Shop-Off + social: `api/social.py`, Shop-Off in
  quest.py. A race links two sessions (the opponent's is a local
  placeholder owned by this account, marked as such); the winner is
  computed on read when both are done, by the attached receipts'
  timestamps — the photo finish. Friends: handle-based
  request/accept, mutual requests auto-accept. Profile: handle,
  stats (done hunts, receipt count, consecutive ISO-week streak),
  and a data-driven badge shelf over real data — Top Contributor
  (receipt tiers), Egg Baron (egg receipts), Banana Republic
  (banana weeks), Speed Demon (sub-10-minute hunt), Clean Sweep
  (fully checked hunt), First Mapper (locked until store data
  exists, criteria shown).

## Connector
`custom.arya` gained `quest-add STORE "item" [QTY]`: finds today's
open session for the store (or creates it) and adds through the new
endpoints; documented in CONNECTOR.md. The connector folder is not
this repo — edited in place, no commit there.

## Tests
60 → 71 green (+11: TestQuestSessions ×2, TestOptimizer ×5,
TestShopOff ×1, TestSocial ×3). Conventions kept: seed files before
/auth/setup so adoption carries them (dictionary, receipts,
quest.json); login-fail dict cleared per suite; Quest paths assert
no model is ever called (FakeClient raises).

## Next
Stage B (PWA client on the approved wireframes) and the VGGT
verdict gate the hunt scene. Deployment of Stage A is the owner's
separate step (git pull on the VM only).
