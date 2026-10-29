# 2026-10-29 — Typed name links to the tracked item

Owner: no known bugs. The list audit found that a typed "milk" made its
own row next to the tracked "Whole Milk", and "mlik" became a new item.

`existing_item_id` (api/list/intake.py) now tries, in order: exact key
(tracked first, then typed items); the typed words inside exactly one
tracked name and at least half of it ("milk" -> "Whole Milk"; two
candidates or a long name means no link); the same after fixing a
one-slip typo against the household's own words ("mlik" -> "milk"; a
swap of neighbours, or one edit in words of six letters or more, so
"pear" never becomes "peas"). Never blocks an add; no model call, $0.
Add box, Ask, and expiry all use it. The model verdict from #95 is not
used here: the household's own words resolve the cases found.

Tests: tests/test_list_add_duplicates.py (links, no-guess, typos, route).
