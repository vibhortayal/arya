# Arya

A grocery assistant that keeps a living model of one household's
purchases — receipts, returns, patterns — so the list writes itself.

**Live:** https://arya-pilot.duckdns.org — tap "Try the demo household"
for a fictional, read-only household. The owner's data stays behind the
owner's account.

## How it works

- **Intake.** One upload: a receipt PDF or a photo. Muse Spark reads it;
  code checks the lines against the printed total before anything posts.
- **Ledger.** Kept purchases only: returns net out, bought-for-others is
  tracked but never suggested, discounts fold into their parent item.
- **Patterns.** Deterministic engines learn cadence and price by store.
  Three kept buys make a claim. The smart list is a derived view.
- **Eyes.** A fridge or pantry photo produces sightings; two independent
  reads must agree, and the user confirms before the model changes.
- **Ask Arya.** A chat agent grounded in a snapshot of the model. It
  answers from the data and applies stated facts as validated actions.

Personal data is Standard mode only, enforced in `api/meta_client.py`.
Costs are policy: `assistant/docs/MODEL-POLICY.md`. Documents are the
source of truth: `assistant/docs/SPEC.md`, `IMPLEMENTATION.md`, and
`STATUS.md` for where the build stands. Agents: read `AGENTS.md` first.

Meta Global AI Developer Hackathon 2026 — Team Nightshift, Indie track.
