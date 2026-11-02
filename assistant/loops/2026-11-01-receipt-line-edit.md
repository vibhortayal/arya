# 2026-11-01 Full receipt line edit (backend)

Owner picked FULL (mockup claude.ai/artifact/LzdNLypdXcZU1pheqNc17y): name, quantity and price on a filed receipt line. Shape agreed with the UI/UX thread.

- POST /api/receipts/{receipt_id}/lines/{idx} {name?, qty?, line_total?}: only fields sent change. name = To check's rename (teaches the name, fixes the same item on other receipts; `also`/`undo` as there). qty > 0 sets unit_price. line_total ≥ 0 for items; discounts and returns keep their sign.
- The printed subtotal/tax/total never change. `state.edit_receipt_line` keeps the first-read values in `edited_from`, recomputes `totals_reconcile` (lines vs subtotal, or total less tax), marks `lines_edited`, keeps the reader's answer in `reader_reconcile`. A receipt that no longer adds up stops counting as checked (and is not a shared price source).
- Response: {ok, line, also, undo, totals_reconcile, lines_sum, subtotal, tax, total, lines_edited}. Undo = same call with old values.
- Group receipts: edits go to the filer's copy via _as_receipt_owner, like rename.
- Ask knowledge: receipts section.

Tests: tests/test_receipt_line_edit.py.
