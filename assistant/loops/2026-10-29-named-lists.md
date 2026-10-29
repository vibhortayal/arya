# 2026-10-29 Named lists (List tab)

Changed: api/state.py (named_lists, lists.json), api/main.py (/api/lists,
update, delete, restore, /api/list/move, list_id on add and from-text,
lists in /api/home and the plan rows, lists in the data export),
api/chat_service.py + prompts/chat_v1.md (add_to_list takes a list name,
snapshot names the lists), pwa/lists.js (sheets, writes, Undo), app.js,
quest.js (hunt from a list), index.html (one-row add), styles.css, sw.js
(arya-v68). tests/test_named_lists.py; seven shell tests follow the new
markup.
Models run: none. Cost: $0.
Left out on purpose: per-item store inside a list (Party), the quiet
"could grab here too" group (the old store lens is gone), smart Add field,
mic to Arya, hunt Ask bar (next PRs).

## PR 2: Ask from the List
Changed: api/chat_service.py (surface "list"/"hunt": adds apply with the
added items returned for Undo, risky actions come back as proposals;
apply_confirmed; CURRENT SCREEN context), api/main.py (/api/chat surface and
context, /api/chat/apply, item_ids from from-text), pwa/aryaask.js (answer
card, Undo, confirm), app.js (smart field, mic to Arya), sw.js (arya-v69).
tests/test_ask_in_list.py. The Ask tab behaves as before.

## PR 3: Ask bar on the hunt
Pinned "Ask Arya…" bar (hunt only) opens a sheet: three quick questions, a field and a mic. Uses AryaAsk with surface "hunt" and a context of store, next item, aisle and what is left. Adds apply with Undo, risky changes confirm, and nothing here tells the crew an item is missing (that stays on "Not here?"). Cache bumped to arya-v70. Not checked on a live hunt or with the real model.
