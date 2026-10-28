# Arya

Arya is a grocery assistant. It keeps a living model of one household's
purchases — receipts, returns, patterns — so the shopping list writes
itself. On top of that model sits Quest, a play layer that turns the
weekly shop into a treasure hunt in a 3D model of the player's own
store. One product, one app, one account.

**Live:** https://arya-pilot.duckdns.org — "Try the demo household"
opens a fictional household. Its photo and voice doors call the Meta
API and keep nothing; every other write is refused. The owner's data
stays behind the owner's account.

## The brain

- **Intake.** Receipts enter as PDF or photo. Muse Spark reads them;
  code checks every line against the printed total before anything
  posts. Lists enter in any form: a photo of a note or whiteboard,
  a paste, typing, voice, or Muse with the Arya connector.
- **Ledger.** Kept purchases only: returns net out, bought-for-others
  is tracked but never suggested, discounts fold into their parent
  item.
- **Patterns and the judge.** Deterministic engines learn cadence and
  price by store. A Muse Spark staple judge gates what the pattern
  facts may put on the list. The Curator proposes product merges and
  splits; the user applies them — no silent edits. The Resolver
  researches names Arya cannot resolve and shows its sources; the
  user settles.
- **Eyes.** A fridge or pantry photo produces sightings. The user
  confirms before the model changes.
- **Ask Arya.** A chat agent grounded in a snapshot of the model. It
  answers from the data and applies stated facts as server-validated
  actions.

## The game (Quest)

List → Store → Play → Receipt. Pick a store from the directory
(search by name, address, or ZIP; favorites first; a store can be
added with its address). A mapped store carries a 3D model built
from a shopper's walkthrough video: VGGT builds the geometry,
SAM 3.1 segments the shelves, Muse Spark labels them, and each
hunt stop sits at its item's matched shelf. An unmapped store
plays on the flat Strip view and can be mapped by its own
shoppers. The receipt photo ends the hunt: it scores the haul and
feeds the brain. Detail: `docs/quest/`.

## Measured results

- **Gate 0 — photo receipt decode**, hand-labeled before decoding.
  Public set: 91.84% of lines correct (product identity + paid
  price), 90/98 lines across 9 public receipts. Owner subset:
  32/32 lines. Combined: 93.85% (122/130). Strict-string accuracy
  is 81.6% — abbreviation expansions count as misses there.
  Arithmetic reconciled on 7/7 receipts. One silent price rotation
  got through the public set; it is recorded, not hidden, and the
  review queue is the stated mitigation. Full record: the research
  repo's GATE-REPORT.md.
- **Staple judge:** precision 0.79 against a purchase-cadence proxy
  on the owner's 114 receipts (eval method and disagreement lists
  in the research repo).
- **Owner corpus:** 114 receipts, 1,226 lines, 114/114 arithmetic
  match.
- **Tests:** 181, green.

## Rules that hold

Personal data is Standard mode only, enforced in
`api/meta_client.py`. Costs are policy:
`assistant/docs/MODEL-POLICY.md`. Every door runs on Meta models —
Muse in chat, Spark on the Meta API in the app. Documents are
the source of truth: `assistant/docs/SPEC.md` and
`IMPLEMENTATION.md`; `STATUS.md` states where the build stands;
`docs/quest/` carries the hackathon doc pack (pitch, game design,
submission map). Agents: read `AGENTS.md` first.

Meta Global AI Developer Hackathon 2026 — Team Nightshift, Indie
track. Submission deadline: Nov 4, 2026, 9:00 PM ET.
