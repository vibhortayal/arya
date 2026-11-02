# 2026-11-02 Fix a line on a filed receipt (UI)

**Ask (owner, 2026-11-01):** "Can I change the name of items later from my receipt?" He picked "full": name, quantity and price. Mockup: claude.ai/artifact/LzdNLypdXcZU1pheqNc17y. The backend is the Product builder's #407: `POST /api/receipts/{id}/lines/{idx}`, plus `raw` and `edited` on detail lines.

**Changes**
- Receipt screen: a hint line, and every line can be tapped (keyboard too, because kit `Row` with `onClick` is now a button). An "edited" tag marks changed lines.
- `ui/LineFix.tsx` "Fix this line" sheet:
  - Shows "Printed: …" when the server sends `raw`.
  - Fields for name, quantity (items only) and price paid or amount.
  - Sends only the fields that changed.
  - `linesMatch` mirrors `api/state.py lines_add_up`. When a change breaks the printed total, the sheet warns with the amount and the button reads "Save anyway".
- After a save, a toast says how many other receipts got the name, with Undo. Undo posts the old values, then `/api/review/undo` for the other receipts.
- If edited lines stop matching, the receipt foot says "You changed some lines, and they no longer add up to the printed total of $X."
- Help: "Add your first receipt" gets n4. Ask knowledge is in #407.

**Tests:** `screens/linefix.test.tsx` (4). Web: 485 tests pass. Python: 0 failures. Checked at 360x640 and 390x844 against the live demo (Save needs #407).
