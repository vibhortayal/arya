# CLAUDE.md
This repo's agent contract lives in **AGENTS.md** (repo root). Read it first;
it is the single source for layout, hard rules, and workflow. Product truth:
`assistant/docs/SPEC.md` + `assistant/docs/IMPLEMENTATION.md`; current state:
`STATUS.md`; stage tasks: GitHub Issues.

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
- **Cost:** $0 per call for math, patterns, and list logic (see
  `assistant/docs/MODEL-POLICY.md`).
- **Scope:** grocery only.
