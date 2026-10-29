# AGENTS.md — read this first. Any coding agent can pick up work from here.

**Project: Arya** — a grocery assistant that keeps a living model of one
household's purchases (receipts, returns, patterns) so the shopping list
writes itself. Meta Global AI Developer Hackathon 2026, Team Nightshift,
Indie track. **Submission deadline: Nov 4, 2026, 9:00 PM ET.**

## Source of truth
This GitHub repo. In order: `assistant/docs/SPEC.md` (what/why) >
`assistant/docs/IMPLEMENTATION.md` (stages/how) > `STATUS.md` (where we are)
> GitHub Issues (stage task lists) > code. The companion research repo
(`vibhortayal/meta-hackathon-research`) is the frozen evidence record.

## Read before working
1. `STATUS.md` — current stage, done/next, blockers.
2. The stage section of `assistant/docs/IMPLEMENTATION.md` for your task.
3. `assistant/docs/MODEL-POLICY.md` — cost rules (binding).
4. The GitHub issue for your stage — acceptance lives there.

## Layout (IMPLEMENTATION §2.1)
`assistant/api/` one module per spec component; ALL Meta API calls go
through `assistant/api/meta_client.py` (no other module calls the API).
Routes live in `assistant/api/routes/` (one FastAPI router per area); `api/main.py`
only wires them. Shared request plumbing (ledger, budget guard, `new_client()`, JSON
helpers) is in `api/deps.py`; the demo sandbox and login middleware in `api/demo_guard.py`.
`assistant/harness/` eval loops; `assistant/prompts/` versioned prompts;
`assistant/golden/` golden fixtures; `assistant/loops/` work-session logs.
`assistant/web/` is the app (React + Vite, TypeScript): screens in
`web/src/screens/`, shared parts in `web/src/ui/` and `web/src/lib/`,
styles in `web/src/styles/`, the service worker in `web/src/sw.js`.
The API serves the build (`web/dist`) at `/`. Do not bump a cache name:
the build gives each shell file a hashed name and the worker precaches
the list. `assistant/pwa/` is now the static folder only (images, store
models, three.js, `scene.js`, the manifest, icons); the API serves it at
`/` beside the build. Rules for app work: `web/PORTING.md`.

## Hard rules (no exceptions without the owner's word)
1. **Personal data is Standard mode only.** Contributor mode is eval-only,
   on synthetic or public data. `meta_client` enforces this; do not bypass.
2. **Cost policy binds.** Cheapest model that holds the golden-set score.
   Math, patterns, and list logic are deterministic code ($0), not prompts.
   Wonder is banned from volume paths.
3. **Public test fixtures never enter the owner's ledger, dictionary, or
   patterns.** Fixtures live in `assistant/golden/` or the spike stores.
4. **Returns semantics:** patterns count kept items only; a returned item is
   never re-suggested; refunds reconcile into the spend ledger.
5. **No secrets in the repo.** The API key comes from env `MODEL_API_KEY`.
   The owner provisions the Oracle runtime key himself. Never ask for it in
   an issue or commit it anywhere.
6. **Product documents are written in ASD-STE100** (controlled language).
7. **Raw owner data is not in this repo** (no real receipts/JSON dumps).
   Synthetic fixtures only. Owner data lives in the staging area described
   in STATUS.md.

## Coding behavior guidelines
Condensed from Andrej Karpathy's observations on LLM coding pitfalls, via
https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md.
They bias toward care over speed; for trivial changes use judgment.

1. **Think before coding.** State assumptions. If a request has more than one
   reading, name them and say which you chose; do not pick silently. If a
   simpler approach exists, say so. If something is unclear, ask.
2. **Simplicity first.** Write the least code that solves the task. No
   unrequested features, no abstraction for single-use code, no speculative
   configuration, no handling for cases that cannot happen.
3. **Surgical changes.** Touch only what the request needs. Match the existing
   style. Do not refactor or reformat unrelated code; mention unrelated dead
   code instead of deleting it. Remove only the imports and names your own
   change orphaned. Every changed line should trace to the request.
4. **Goal-driven execution.** Turn the task into a check you can verify (a
   failing test first for a bug, a passing test after a refactor). For
   multi-step work, state a short plan with a check for each step, and loop
   until the checks pass.

### Arya rules that win over the above
If a guideline conflicts with these, these win:
- **UI changes: wireframe first.** Show a phone-size mockup built from the
  real app CSS and wait for the owner's approval before writing UI code.
- **PRs:** base every PR on `main`; no stacked PRs.
- **Tests:** CI is manual-only; never add a `pull_request` trigger.
- **Cost:** math, patterns, and list logic stay deterministic code ($0 per call
  because no model is needed). Model spend is allowed from hackathon credits
  (see `assistant/docs/MODEL-POLICY.md`).
- **Scope:** grocery only.
- **Prices** come only from the user's own receipts and lists — no scraping,
  no retailer APIs, no web search (SPEC FR-11.1). Community price comparison
  is opt-in and not live (SPEC FR-11.7).
- **Spec beats code:** if SPEC.md and the code disagree, the spec wins — fix
  the code, or flag it and let the owner decide.

## Working agreement
- No commits to `main`. Every change goes through a PR based on `main`; commit messages are descriptive.
- While iterating, run the tests for the area you touched. Before a PR
  merges, run the full suite — `cd assistant && ../.venv/bin/python -m unittest discover -s tests` —
  and it must be green. Add tests with new logic. Create the venv once:
  `python3 -m venv .venv && .venv/bin/pip install -r assistant/api/requirements.txt`.
  On the VM no setup is needed: the deploy container already has the
  dependencies (`docker exec deploy-api-1 …`).
- Every work session: append one entry to `assistant/loops/<date>-<stage>.md`
  (what changed, scores/costs if models ran, what's next) and update
  `STATUS.md` + the stage issue checklist. Docs-only PRs are exempt from all
  three; code changes keep the full duty.
- Stage starts and deploys need the owner's go-ahead. Meta hackathon credits
  (plus Baseten and Modal credits) cover model spend, including image
  generation, so there is no $0 rule; still log spend in the ledger and keep
  runs sensible (a capped test before a big batch).

## Design work

- Impeccable v4.8.0 is vendored at `.claude/skills/impeccable/` (installed
  2026-10-27 at the owner's direction; the npx installer's bundle download
  is blocked on this network, so it was copied from the pbakaus/impeccable
  repo's plugin build — same files). Run its `context` once per design
  session and follow its playbooks. Visual language: the wireframe theme —
  greyscale structure with one orange accent (#E4572E), light mode only,
  grouped lists, 44 pt targets.
- The staple judge (api/judge.py) gates list admission; the pattern engine
  reports facts only. Explicit user intent (manual add, ran-out, expired)
  always beats the judge. Unjudged or unresolved-name items stay off the
  list — precision over recall, by the owner's word.
- Deploy by `git pull` on the VM only. Never rsync --delete over the VM
  tree: `assistant/deploy/.env` is VM-only (the owner's
  MODEL_API_KEY) and a --delete sync removed it on 2026-10-27; it was
  restored from the running containers' environment.
