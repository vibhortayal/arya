# 2026-11-02 Used it: off use-by, into Suggestions

Owner asks (UI/UX thread, 2026-11-02):
- Still good? only offered Still good / It expired; add "Used it".
- 05:50Z: "I meant in the suggestions section ... Aria should not add
  anything to the list themselves, right? They always give suggestions."
- 05:50Z: suggestions must work out which list, and ask only when they
  can't (list deleted, etc.).
- 05:52Z: if an item is already on a list, it has run out: stop showing it
  in the go-bad section.

Built:
- Today usedUp(), shared by Use soon (chip and item sheet) and Still good?:
  untracks the date (Use soon), sets the new "used" flag. state._reported_out
  counts "used" like "out" (Running low learns, item is due and admitted)
  but only "out" puts a row on the list, so the item is a suggestion
  ("you used it up"). Undo clears "used" and restores the date.
- Running low Add on Today uses addToUsual: the 409's suggested list (the
  usual store's) straight away; "Which list?" only when there is none or
  it was deleted.
- state.on_list_ids(d): Use soon, Still good? and Ask's food dates skip
  items on a list.
- Help n1, Ask knowledge, tests (tests/test_still_good_used_it.py, listpick).

Misses to learn from: v1 copied the check's own pattern instead of the
existing Used it (#96); then "suggested list option" was read as "the
suggested list", not the Suggestions section. Arya suggests, the household
adds.
