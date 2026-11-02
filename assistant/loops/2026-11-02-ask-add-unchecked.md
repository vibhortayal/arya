# 2026-11-02 Ask Arya adds land with the items still to buy

Owner bug, 2026-11-02: asking Ask Arya to add an item put it in the checked (done) part of the list.

Cause: an item ticked earlier this trip keeps its tick (`checked_on` is the current cycle). The Add box clears that tick when you type the item again (`_add_name_to_list`), but Ask's `apply_actions` did not. So "add naan" after naan was ticked set it back on the list with the tick still on.

Fix (`api/chat_service.py`, `_untick`): Ask's add, "ran out" and "expired" actions clear the tick, and the tick on the list being added to when the item is also on a second list. Both Ask paths are covered: tracked items and typed (manual) items.

Tests: `tests/test_ask_add_unchecked.py` (5). Three of them fail without the fix.

Docs: one sentence in `prompts/arya_features.md` (lists). No screen change, so no Help or guide change and no mockup.

Not caused by this change, failing on main in this sandbox too: `test_stickers.py` (cv2), `test_receipt_jobs.py` (1), and `test_quest.py` abandon test (order dependent; passes alone).
