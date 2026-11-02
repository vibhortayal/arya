# 2026-11-02 Still good? check: Used it

Ask (owner): the use-by check only offered Still good or It expired; add a
way to say "I finished this" so it leaves the check. Name: "Used it".
Mockup approved: claude.ai/artifact/6XuF8PTfaAZAQWap8g2uss

Built: a third chip, Used it, between Still good and It expired. It sets
the item's "out" flag to today (same as Ask's "we finished the milk"), so
the item leaves the check and Running low learns the run-out. Undo clears it.
Help (use soon) and Ask knowledge updated. Test: tests/test_still_good_used_it.py.
