# Docs collapse — 2026-10-27 (night)

**Problem.** The repo told two stories. `docs/quest/` told the
current one (one product: the Arya brain, Quest as its play
layer). The root README, the STATUS header, and
`assistant/docs/SUBMISSION-DRAFT.md` still told the pre-Quest
grocery-only story: no Quest, no connector, no Resolver, no
Curator; a stage table claiming the photo path "waits on Gate 0"
long after Gate 0 passed; and a best-case-only Gate 0 figure
("93.9% across 13 receipts" — the combined number with no split).

**What changed.**

- `README.md` rewritten as a landing page: one product (brain
  first, Quest as the play layer), the live URL, how the pieces
  fit, links into `docs/quest/`. Headline numbers stated in full:
  Gate 0 public 91.84% (90/98 lines, 9 public receipts), owner
  subset 32/32, combined 93.85%, strict-string 81.6%, arithmetic
  7/7, and the one silent price rotation stated as a miss with
  the review queue as the mitigation. Staple-judge precision
  0.79 and the 181-test suite alongside.
- `STATUS.md`: the 400-word header wall replaced by a short
  current-state block (what is live, 181 green, current stage),
  the same full Gate 0 statement, and a framing note for the
  dated record below. Stage-table fixes: Stage 0.5 Gate 0 line
  (was "public subset running"), Stage 1 (was "In progress" +
  "Photo path waits on Gate 0"), Stage 5 (was "HELD — needs TJ
  walkthrough"; superseded by Quest Stages C–E per DISCUSSION
  29), Stage 6 (was "IN PROGRESS"). Blockers section updated:
  the API key, the hostname, and the TJ walkthrough are closed;
  what remains is the demo video, the submission package (owner
  go-ahead), and the public flip. The rewrite also removes the
  VM IP and the DuckDNS token path the old header carried —
  DISCUSSION 28's pre-flip scrub item, done early for this file.
- `assistant/docs/SUBMISSION-DRAFT.md`: kept as the paste-ready
  portal copy (docs/quest/SUBMISSION.md is the judging map and
  checklist; it holds no copy to paste, so the draft is not
  superseded — it is aligned instead). "What it is" now covers
  Quest, the Muse connector, the Resolver, and the Curator;
  "How Meta models are used" adds Voice Transcribe, SAM 3.1,
  and VGGT; Evidence carries the full Gate 0 split, the silent
  rotation disclosure, judge precision 0.79, the store model,
  and 181 tests.
- `assistant/docs/ARCHITECTURE.md`: "Tests (59)" → 181; §12
  registration line no longer promises a "Muse is the only
  way in" notice (retired by the intake-parity ruling,
  DISCUSSION 26); §12 Stage 5 line marked superseded by the
  Quest store work.
- Quest pack counts: `docs/quest/README.md` Status block (83 →
  181 tests; Stages A–C → A–E; intake parity and the Brain
  restyle now built and live; shelf graph built, 18 stops /
  55 regions) and `docs/quest/ARCHITECTURE.md` (60 → 181 tests).

**Left as written, on purpose.**

- The dated STATUS sections keep their per-stage suite counts
  and their "not deployed — deploy is a separate owner step"
  endings. They were true when written; the new header says so
  and states that the deploy steps followed the same evening.
  Rewriting them would falsify the record to fix a framing
  problem the header now solves.
- `assistant/docs/ARCHITECTURE.md` §1–§2 still describe the
  edge/core layering with server decode as "fallback". That
  predates the intake-parity ruling; STATUS and DISCUSSION 26
  carry the current ruling. Not reworded here — it is an
  architecture description, not a status claim.
- `assistant/loops/` logs are untouched, including any stale
  lines in them; they are the internal session record, not
  judge-facing docs.

**Verification.** Grep sweep over the repo docs for the stale
set ("waits on Gate 0", "public subset running", "only way in",
"zero model calls", 59/60/83 test counts, "93.9%", the VM IP,
the DuckDNS token path): clean outside the loops logs and one
STATUS note that records the Muse-only line as retired.
No code or tests touched; no model calls; $0.
