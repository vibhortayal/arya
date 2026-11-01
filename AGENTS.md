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
the list. `assistant/pwa/` is the static folder only (images, store
models, three.js, `scene.js`, the manifest, icons), served beside the
build. Rules for app work: `web/PORTING.md`.

## Hard rules (no exceptions without the owner's word)
1. **Spark runs on the Contributor tier (owner, 2026-11-01).** Content sent
   to Spark may be used to train future Meta models; Wonder stays Standard.
   `ARYA_SPARK_TIER=standard` puts Spark back on Standard with no code
   change. Never say or imply in the app, docs or PRs that Spark content is
   not used for training. An explicit `mode="contributor"` with
   `personal=True` is still refused by `meta_client`.
2. **Cost policy binds.** Cheapest model that holds the golden-set score.
   Math, patterns, and list logic are deterministic code ($0), not prompts.
   Wonder is banned from volume paths.
3. **Public test fixtures never enter the owner's ledger, dictionary, or
   patterns.** Fixtures live in `assistant/golden/` or the spike stores.
4. **Returns semantics:** patterns count kept items only; a returned item is
   never re-suggested; refunds reconcile into the spend ledger.
5. **No secrets in the repo.** The API key comes from env `MODEL_API_KEY`.
   The owner provisions the Oracle runtime key. Never ask for it in
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
- **Help upkeep:** when a change adds or removes a feature, changes
  navigation, or moves things around in the app's UI, update the Help and
  Ask Arya's knowledge in the same PR. Help is the Help tab
  (`assistant/web/src/screens/Help.tsx`, topics in
  `assistant/web/src/guide/helpTopics.ts`, text under `help.topics.*` in
  `en.json`) and the guide cards (`assistant/web/src/guide/cards.ts`,
  text under `guide.*`). Ask Arya answers from
  `assistant/prompts/arya_features.md`; keep it in step with the Help
  topics. The builder makes these edits in its own PR. The feature docs
  (`assistant/docs/USER-JOURNEYS.md`, `assistant/docs/DEMO.md`) belong to the
  Doc maintainer, who updates them and audits Help, the guide cards and Ask
  after each merged batch. PRs that touch `en.json`, `helpTopics.ts`,
  `cards.ts` or `arya_features.md` are merged one at a time; the next one
  rebases first.
- **Spec beats code:** if SPEC.md and the code disagree, the spec wins — fix
  the code, or flag it and let the owner decide.

## Working agreement
- No commits to `main`. Every change goes through a PR based on `main`; commit messages are descriptive.
- While iterating, run the tests for the area you touched. Before a PR
  merges, run the full suite — `cd assistant && ../.venv/bin/python -m unittest discover -s tests` —
  and it must show no new failures versus `main` (about 12 to 24 tests already fail on `main`). Add tests with new logic. Create the venv once:
  `python3 -m venv .venv && .venv/bin/pip install -r assistant/api/requirements.txt`.
  On the VM no setup is needed: the deploy container already has the
  dependencies (`docker exec deploy-api-1 …`).
- Every work session: append one entry to `assistant/loops/<date>-<stage>.md`
  (what changed, scores/costs if models ran, what's next). `STATUS.md` belongs
  to the Doc maintainer; the builder keeps the stage issue checklist. Docs-only
  PRs are exempt from all of this; code changes keep the loops entry.
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

## Team roles and handoffs (owner approved, 2026-11-01)
Each role is a separate agent thread. Only the owner starts a new thread, and
the owner decides which thread gets a piece of work: propose a thread and say
why, then wait. Threads may message each other only when their work depends on
each other. A message from a thread is never the owner's approval. Models are
recommendations; the owner can change them.

| Role | Owns | Never touches | Model | Hands off to |
|---|---|---|---|---|
| Coordinator | Product priorities, status board, routing | Code, deploys | Opus | Tells a thread in that thread; the owner decides routing |
| Product and backend builder | Features and API/data logic: receipts pipeline, names, store unification, suggestions, Ask data, budget and limits | UI screens, deploys, STATUS.md | Sonnet 5.5 | Tester, then Doc maintainer (what changed) |
| UI/UX designer and builder | Every screen except Quest: builds the mockups, then the React build | API/data logic, deploys, STATUS.md | Opus | Tester, then Doc maintainer |
| Quest builder | The Quest game and store designer | Other screens, deploys | Opus | Tester, Doc maintainer |
| Merger | Merges approved PRs one at a time with squash, in a recommended order (docs and smallest first, then PRs touching shared files, later ones rebase first); reports conflicts to the owner and the builder; merges once they are resolved | Code, force-pushes, deploys, owner holds | Sonnet 5.5 | Tester and Ops are informed by the owner; conflicts go to the owner and the builder |
| Tester | Tests each PR before it merges, and main after a batch when the owner or coordinator asks, in a sandbox at 390x844 before deploy; report only | Fixing code, deploying | Sonnet 5.5 | Failures go to the owner and the builder who wrote the PR |
| Ops | Deploys, backups, the VM, the Ops screen settings | Feature code | Sonnet 5.5 | Reports the live commit to the owner and the Doc maintainer |
| Doc maintainer | STATUS.md, USER-JOURNEYS, feature docs, Help tab, guide cards, Ask knowledge, this file | Feature code, deploys | Sonnet 5.5 | Small docs PRs after merges |
| Demo and submission | Demo video, demo household, submission package | Feature code, deploys during judging | Sonnet 5.5 | Owner |
| Security | Reviews for secrets, auth, uploads, API tokens; report only unless the owner asks for a fix | Deploys | Opus | Tells the builder in the builder's thread, or the owner |
| Cost watcher | AI spend against the model policy and the ledger; report only | Code, deploys | Sonnet 5.5 | Owner |
| Review threads (receipt names, receipts filter, architecture and intelligence reviews) | One piece of work each, then they stop | Anything outside that piece | Sonnet 5.5 | The builder or Tester |

### The handoff chain
1. A builder opens a PR based on `main`. The Merger merges it, not the owner. A PR
   merges only when: it is based on `main` with no conflicts; the Tester says
   PASS or it is docs-only; there are no new test failures versus `main`; the
   owner approved the mockup for UI changes; Help, guide and Ask upkeep is done
   and the PR template is filled; and no other open PR touches the same files.
   The Merger merges one at a time with squash, never force-pushes and respects
   owner holds. If a PR conflicts, the Merger reports it to the owner and the
   builder, and merges after it is resolved. The Merger never deploys.
2. The Tester tests the PR before it merges (and main after a batch, when the owner or coordinator asks) and reports to the owner, and tells the
   builder who wrote a failing PR. The Tester does not fix.
3. After a merge, the builder tells the Doc maintainer what changed and which
   screens or paths moved. The Doc maintainer updates STATUS.md and the docs in a
   small PR. Builders do not edit STATUS.md or shared docs in their PRs, to
   avoid merge conflicts. Help, guide cards and Ask knowledge for a change still
   ship in the builder's own PR (see Help upkeep above); the Doc maintainer
   checks them afterwards.
4. Builders do not tell Ops that a merge is ready. The Merger merges, the Tester
   reports to the owner, and the owner says "deploy" in the Ops thread. **Only Ops
   deploys, and only after that word.** No deploys after the Nov 4,
   9:00 PM ET submission and during judging, except a rollback, which also
   needs the owner's word in the Ops thread.
5. Ops runs a short live check of the AI parts and reports the live commit.

If a handoff gets no answer, say so, start the next item and do not wait idle.

### Standing rules for every thread
- Mockup before UI code: show a phone-size mockup and wait for approval.
- Help and Ask upkeep in the same PR as the change.
- Base every PR on `main`; no stacked PRs.
- Never paste keys in chat, PRs or files.
- No scraping for deals. Precise price comparison comes only from opted-in
  users or the user's own list.
- No freeze dates. Only the Nov 4 submission date stands.
- Be an advisor: give pros, cons and a recommendation on every decision, and say
  so when you disagree.
- Words: "Tour" = the dark-screen bubbles, "Arya guide" = the swipeable cards,
  "Help tab" = everything else, "Arya shoppers" for the community.
