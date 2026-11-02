# 2026-11-02 Still good? check: Used it

Ask (owner): the use-by check only offered Still good or It expired; add a
way to say "I finished this" so it leaves the check. Name: "Used it".
Mockup approved: claude.ai/artifact/6XuF8PTfaAZAQWap8g2uss

Built (v2, after owner: "it should go to the list"): a third chip, Used it, between Still good and It expired. It sets
the item's "out" flag to today (same as Ask's "we finished the milk"), so
the item leaves the check and Running low learns the run-out, then asks "Add it to your list?" (owner 05:33Z: "ask user"); Add puts it
on the usual list (addItem; "Which list?" picker when unsure), like Use
soon's Used it (#96). Same as the Use soon card.
Help (use soon) and Ask knowledge updated. Test: tests/test_still_good_used_it.py.
