# Arya

Arya is a grocery assistant. It keeps a living model of one household's
purchases — receipts, returns, patterns — so the shopping list writes
itself. On top of that model sits Quest, a play layer that turns the
weekly shop into a treasure hunt in a 3D model of the player's own
store. One product, one app, one account.

**Live:** https://arya-pilot.duckdns.org — "Try the demo" opens a
fictional household with no account. A judge can play the whole loop
there: add to the list by typing, photo or voice, play the Trader
Joe's hunt in every mode and view, finish on a receipt photo, and use
Ask Arya. Every demo write goes into an in-memory sandbox for that
visitor only; nothing reaches disk or another visitor. Bulk imports
and batch model jobs need a real account. The owner's data stays
behind the owner's account.

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
plays as shelf cards and can be mapped by its own shoppers. Find it
for me aims the camera at one item: SAM 3.1 boxes it, Muse Spark
verifies it, and no picture of a person is kept. The receipt photo ends the hunt: it scores the haul and
feeds the brain. Detail: `docs/quest/`.

## Measured results

- **Receipt photos — production reader (Muse Wonder 1.0, Spark
  fallback).** On the Gate 0 public set (9 receipts, 98 lines),
  through the production path: 97/98 lines with the right product
  and price after hand adjudication (98.98%; the automatic scorer
  gives 87/98), zero price errors, arithmetic 7/7. Muse Spark on the
  same hand adjudication: 92/98 (93.88%). Record: WONDER-EVAL.md in
  the research repo, `assistant/loops/2026-10-27-wonder-decode.md`.
- **Gate 0 — the photo gate (Muse Spark, before Wonder).** Public
  set 90/98 (91.84%, product identity + paid price), owner subset
  32/32, combined 122/130 (93.85%); strict-string 81.6%; arithmetic
  7/7. One silent price rotation got through; it is recorded, and
  the review queue is the mitigation. Record: GATE-REPORT.md in the
  research repo.
- **"Where am I?" localizer** (written by Muse Wonder): 42/45 stops
  right, 45/45 within one stop, on held-out frames from the mapping
  video (frames half a second from indexed ones, never indexed
  themselves). It has not yet been measured on fresh shopper photos
  taken on another day.
- **Staple judge:** precision 0.79 against a purchase-cadence proxy
  on the owner's 114 receipts (eval method and disagreement lists
  in the research repo).
- **Owner corpus:** 114 receipts, 1,226 lines, 114/114 arithmetic
  match.
- **Tests:** `cd assistant && python -m unittest discover -s tests`
  (count in `STATUS.md`).

## How this was built

Everything in this repository was built during the hackathon build
window, which opened on Oct 27, 2026. The first commit is Oct 27,
15:13 ET. The engine (decode, dictionary, ledger, patterns, the
first PWA) was written by Muse Wonder in a separate spike session
that started on Oct 27, then committed here in stages over about 30
minutes; that is why the first commits arrive quickly. The loop
logs in `assistant/loops/` record each session. The household data
behind the owner's account (114 receipts back to 2023) is the
owner's purchase history, imported as data; it is not code.

The Trader Joe's walkthrough frames ship in the app.


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
