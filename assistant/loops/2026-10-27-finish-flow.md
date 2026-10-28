# Finish flow — this trip's receipt, now or later (2026-10-27)

Discussion 41. The owner phone-tested Finish and rejected the
"Or use a receipt already filed" picker ("why would i need to
tag an uploaded receipt"), then extended the design: the
settling receipt must be this trip's — now, or later against
the same hunt.

## What changed

- **Picker removed.** The Finish view keeps its heading, the
  scorecard line, and "Snap the receipt"; the filed-receipt
  section, its renderer, and its click path are gone, and the
  client no longer sends an existing receipt_id at finish.
  (Known leftover, noted per the original instruction: the
  server attach endpoint still accepts any filed receipt_id —
  it is now also the late-attach mechanism below, and only
  the client doors govern which receipt may settle a hunt. A
  later cleanup can bind it tighter; nothing in the UI can
  reach an old receipt anymore.)
- **Skip, plainly.** The Finish screen's second action is now
  "Skip", with one line stating the consequence: the hunt
  stays unsettled, waiting in Receipts under a "Receipt
  missing" tag.
- **Settled is explicit.** Sessions carry `settled`: finishing
  without a receipt records settled=false; attaching the
  receipt (at finish or later) records settled=true and
  closes the session (state done), as before.
- **The unsettled entry.** GET /api/quest/receipts now also
  returns `unsettled` — finished hunts awaiting their receipt
  (store, finish date, items collected). The Receipts view
  logs each at the head of the archive with the owner's exact
  tag, **"Receipt missing"**, and an **"Upload the receipt"**
  button: the photo goes through the normal /decode/photo,
  files as a receipt, attaches to THIS hunt, settles it, and
  the entry clears (the filed receipt takes its place in the
  archive). Still this trip's own receipt, attached late —
  never a picker.
- **Rewards gate (owner-ratified ruling).** While unsettled,
  the play record stands but receipt-verified rewards do not
  credit. This was already the architecture — badges and the
  profile hunt count read receipt-closed (done) sessions
  only, and the Community boards filter state == "done"
  client-side — and it is now pinned by tests rather than
  left implicit: a fast, fully-checked unsettled hunt earns
  neither Speed Demon nor Clean Sweep and does not move the
  hunt count; the late upload earns both. (Ruled by Spark
  from "the receipt is the proof," ratified by the owner
  2026-10-27; recorded here so it can be struck with one
  word.)
- The Score screen's no-receipt copy now points at the real
  door (Receipts + the tag) instead of the session card.
- Docs: DISCUSSION.md entry 41 states the full rule. A grep
  of STATUS, README, and the quest docs found no copy
  describing settling with a filed receipt (one historical
  loops file mentions the picker as build history of its
  day; logs are not product copy and were left alone).

## Tests

Suite: **247 green** (7 new in tests/test_finish_flow.py):
skip finishes unsettled and logs the tagged entry; the
rewards gate holds while unsettled; the late upload settles,
clears the entry, and credits; a receipt at finish is settled
from the start; client pins for the picker's absence, the
plain Skip, and the Receipts-view entry/upload wiring;
Discussion 41 logged. SW cache **arya-v27**. **Not pushed,
not deployed** — parent reviews and ships.
