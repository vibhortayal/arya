# 2026-10-28 — Owner phone-pass batch (Spark)

Owner walked the live app and filed seven fixes; built in one PR
(branch fix/phone-pass-batch) for his review. No model spend ($0).

- Store picker: tap-to-advance (qPickStore), typed store + Enter,
  receipt stores top-3 + Show-all fold, type field on top,
  #st-next removed.
- Check the list: opt-next never disabled; #opt-skip while questions
  pending; unanswered = kept as typed; ask-later set (localStorage)
  marks the List row and the question re-asks at the next plan.
- Celebration: qOnCollected is a no-op (owner-disabled); manifest,
  facts, and qCelebrate stay for a one-function re-enable.
- Receipt sheet: root cause was .btn having no display — a <label>
  is inline, so the pill collapsed onto the text. .btn is now
  inline-flex; verified by geometry in the drive.
- Add -> List: view-scan deleted; composer on List (split preview
  chips mirror the server split, chip removal rewrites the field,
  one line + Enter adds instantly); Eyes section shows only while a
  sighting is pending; four tabs; Meta-models line is List footer.
- Today: New session above Your games; staplesLine is a count only.
- SW arya-v43. Suite: 387 tests, 1 failure — test_photo_driver
  frames budget, PRE-EXISTING on main (proven on a clean stash):
  the walk-frame scrub commit (31d623d) pushed totals over the
  guide (20.4MB vs 20MB; first-5 1.412MB vs 1.4MB) and scrub.json
  makes the dir count 91. Needs its own call: re-encode or re-budget.
- Drive (demo, local instance): all checks pass — Today order/line,
  4 tabs, composer split + Enter, picker advance, clean-list skip of
  Check, celeb layer stays hidden through a grab, sheet geometry.
  Not exercised in demo: the receipts fold (demo has 1 history
  store) and an optimizer question to skip (demo list is clean) —
  both unit-pinned in tests/test_phone_pass.py.
