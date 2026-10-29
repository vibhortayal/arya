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
