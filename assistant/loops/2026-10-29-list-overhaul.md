# 2026-10-29 — List overhaul (owner issues 3 and 4)

Owner: "when I select trader joes in list, why am i seeing costco prepared
cart? we need to overhaul the list section." Wireframe v1
(https://claude.ai/artifact/BV9qJFShCqqV3V6QHtHqha) approved: "yes, build
as per suggested", with the recommended answers to its three questions.

Root causes:
- The Prepared cart is one household cart; `api/cart/build.py prepare()`
  defaults the store to Costco and copies every due item. It ignored the
  list lens. Removed from the List (the API stays for now).
- Pattern-predicted staples were list rows, so a list mixed what you
  added with Arya's guesses.
- The demo household had no named lists: a lone "All" chip.

Changes:
- `state.derived()`: each list row carries `on_list` (manual add, typed
  add, or "I'm out" not yet answered by a purchase). Due staples and
  expired items are suggestions (`on_list` false) with `every_days`,
  `days_since` and `expired_on` for a one-line reason. No model calls.
- `/api/quest/plan` rows carry `on_list`; a hunt from a named list takes
  only what is on it.
- PWA: Lists home (cards with count, first items, suggestion pill), list
  page (title, Select, ⋯ menu, composer, your rows, "Suggested for X",
  checked rows folded with Clear, quiet "Start a hunt"), why sheet (cadence
  with 8-week dots, last bought, usual store and price; Add / Not now /
  Never), swipe reveals Move / Remove (no instant remove), long-press or
  Select for multi-select and a Move sheet with New list and Undo.
- Suggestion placement: the list it is filed under, else the list linked
  to the store it is bought at most, else Everything else.
- Demo: `make_demo_household` writes lists.json (Costco, Trader Joe's)
  and flags.json (a few items on each, Basil on no list). Demo bar is one
  line. Footer lines ("Every door runs on Meta models…", "add from Muse
  chat…") removed at the owner's word.
- Rebased on PR #104 (List first): Today's running low, store alerts and
  list cards now count only `on_list` rows; the Eyes "seen" notes moved to
  Today's Still good? block.

Tests: 1068 green (new tests/test_list_overhaul.py). Cost: $0.

Next: owner items 2 and 3 from the same message (a home for "Snap an
expiry date", an edit icon on the list name) — wireframe first.
