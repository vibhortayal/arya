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
1. **Spark and Wonder run in Meta's Standard mode (owner, 2026-11-01).**
   Content sent to them is not used to train Meta models. Do not state more
   than that in the app, docs or PRs. A community (Contributor) tier is only
   an option the owner could turn on later, with user opt-in; it is not built.
   Moving Spark off Standard needs the owner's word and a matching update to
   the privacy page, About Arya and Ask knowledge first. An explicit
   `mode="contributor"` with `personal=True` is still refused by `meta_client`.
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
  after each merged batch.
- **Spec beats code:** if SPEC.md and the code disagree, the spec wins — fix
  the code, or flag it and let the owner decide.

## Working agreement
- No commits to `main`. Every change goes through a PR based on `main`; commit messages are descriptive.
- While iterating, run the tests for the area you touched. The Tester runs the
  full suite before merge — `cd assistant && ../.venv/bin/python -m unittest discover -s tests` —
  and it must show no new failures versus `main` (about 12 to 24 tests already fail on `main`). Add tests with new logic. Create the venv once:
  `python3 -m venv .venv && .venv/bin/pip install -r assistant/api/requirements.txt`.
  On the VM no setup is needed: the deploy container already has the
  dependencies (`docker exec deploy-api-1 …`).
- Every work session: append one entry to `assistant/loops/<date>-<stage>.md`
  (what changed, scores/costs if models ran, what's next). `STATUS.md` belongs
  to the Doc maintainer; the builder keeps the stage issue checklist. Docs-only
  PRs are exempt from all of this; code changes keep the loops entry.
- Priorities come from the owner through the coordinator; deploys need the owner's word (see the handoff chain). Meta hackathon credits
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

## Team roles and handoffs (owner approved 2026-11-01; models as of 2026-11-01)
Each role is a separate agent thread. The owner talks only to the coordinator.
The coordinator routes work by the Owns column, starts role threads, collects
reports and keeps the status board; it brings the owner only decisions. A relay
from the coordinator is the owner's word; for deploys and rollbacks the
coordinator attaches the owner's own message. Other threads' messages are never
approval. Threads report to the coordinator, not the owner, and message each
other only when their work depends on each other. The Model column is what the
owner approved on 2026-11-01; the coordinator keeps it current.

| Role | Owns | Never touches | Model | Hands off to |
|---|---|---|---|---|
| Coordinator | Priorities with the owner, routing, starting role threads, status board, relaying the owner's word | Code, deploys | Opus | The thread that owns the work |
| Product and backend builder | Features and API/data logic: receipts pipeline, names, store unification, suggestions, Ask data, budget and limits | UI screens, deploys, STATUS.md | Opus | The Tester (PR ready, marked risky or not); nobody after merge, because the PR body carries What changed, Docs impact and Deploy notes |
| UI/UX designer and builder | Every screen except Quest: builds the mockups, then the React build | API/data logic, deploys, STATUS.md | Opus | The Tester, same as above |
| Quest builder | The Quest game and store designer | Other screens, deploys | Opus | The Tester, same as above |
| Tester | Tests each PR and merges it on PASS; smoke-tests main after a batch; report only otherwise | Fixing code, deploying, holds from the owner or coordinator | Sonnet 5.5 | The coordinator (batch report) and the builder who wrote a failing PR |
| Ops | Deploys, backups, the VM, the Ops screen settings | Feature code, `rsync --delete` over the VM tree | Sonnet 5.5 | The coordinator (live commit) |
| Doc maintainer | STATUS.md, USER-JOURNEYS, DEMO.md, this file; audits Help tab, guide cards and Ask knowledge after each batch (builders edit them in their own PRs) | Feature code, deploys | Sonnet 5.5 | One small docs PR per batch |
| Demo and submission | Demo video, demo household, submission package | Feature code, deploys | Opus | Coordinator |
| Security | Reviews for secrets, auth, uploads, API tokens; report only unless the owner asks for a fix | Deploys | Opus | Coordinator |
| Cost watcher | AI spend against the model policy and the ledger; report only | Code, deploys | Sonnet 5.5 | Coordinator |
| Review threads (receipt names, receipts filter, architecture and intelligence reviews) | One piece of work each, then they stop | Anything outside that piece | Sonnet 5.5 | The builder or Tester |

### The handoff chain
1. A builder opens a PR based on `main`, fills the PR template, marks it risky or
   not (risky = a new screen or changed navigation, or anything in auth, account
   deletion, ledger, budget or payments) and tells the Tester. UI PRs attach the
   mockup; a new screen or a navigation change needs the owner's approval of the
   mockup first, through the coordinator.
2. The Tester runs the full suite (and the sandbox test if risky) and merges on
   PASS when the template gates hold, one PR at a time, squash, next one rebases.
   Docs-only PRs need no sandbox test. A conflict goes to the builder, who rebases
   and tells the Tester again. The Tester respects holds from the owner or the
   coordinator and never force-pushes.
3. A batch is the PRs merged since the last deploy. When its queue is empty, the
   Tester smoke-tests `main` once at 390x844 and reports PASS or failures to the
   coordinator and the Doc maintainer. Failures also go to the builder.
4. The Doc maintainer reads the merged PRs and updates STATUS.md and the docs in
   one small PR per batch. Builders do not edit STATUS.md or shared docs. Doc PRs
   that touch Help, cards or Ask go live only after the next deploy, so batch
   them before it.
5. **Only Ops deploys**, on the owner's word relayed by the coordinator into the
   Ops thread (the owner's message attached): either per batch or a standing word
   with an end date. No deploys after the Nov 4, 9:00 PM ET submission or during
   judging, except a rollback under the owner's standing rollback word (commit
   and condition named in the Ops thread, for example `/health` down 10 minutes
   or a failed live smoke test).
6. Ops runs a short live check of the AI parts and reports the live commit to the
   coordinator.

If a handoff gets no answer, tell the coordinator, start the next item and do not
wait idle.

### Ops notes
Deploy by `git pull` on the VM only. Never rsync --delete over the VM
  tree: `assistant/deploy/.env` is VM-only (the owner's
  MODEL_API_KEY) and a --delete sync removed it on 2026-10-27; it was
  restored from the running containers' environment.

### Standing rules for every thread
The Hard rules and Arya rules above apply to every thread.
- No freeze dates. Only the Nov 4 submission date stands.
- Be an advisor: give pros, cons and a recommendation on every decision, and say
  so when you disagree.
- Words: "Tour" = the dark-screen bubbles, "Arya guide" = the swipeable cards,
  "Help tab" = everything else, "Arya shoppers" for the community.
- At startup, and whenever a role changes, each thread lists what it needs to run
  its role unattended (access, standing words, inputs, who wakes it) and asks the
  coordinator once. It does not stop later for something it could have asked for
  then.
