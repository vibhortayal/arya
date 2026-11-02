"""Used it (owner, 2026-11-02), on Use soon and on the Still good? check:
the item leaves the use-by section and moves to Suggestions. Arya never
adds to a list itself ("They always give suggestions"); Add on the
suggestion does, asking "Which list?" when it can't tell. Undo puts it
back. The "used" flag counts like "out" for Running low, but the item
is a suggestion, not a list row."""
import os
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")


def src(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class UsedIt(unittest.TestCase):
    def test_today_offers_used_it_in_both_places(self):
        s = src("web/src/screens/Today.tsx")
        self.assertIn("data-check-used", s)
        self.assertIn('check("used", c.item_id)', s)
        self.assertIn("{ used: day }", s)
        self.assertIn("{ used: null", s)                         # Undo
        self.assertIn("await usedUp({ id: s.item_id, name: s.name, soon: s", s)  # Use soon too
        # never adds by itself; the suggestion's Add picks the list
        self.assertNotIn("addToUsual(id, name)", s)
        self.assertIn('await addToUsual(id, it?.name || "")', s)
        self.assertIn('"usedToSuggest"', src("web/src/i18n/en.json"))

    def test_used_is_a_flag_and_ends_the_check(self):
        from api.routes.items import _FLAG_KEYS
        self.assertIn("used", _FLAG_KEYS)
        self.assertIn('said = f.get("out") or f.get("used") or f.get("expired")', src("api/routes/home.py"))

    def test_used_makes_a_suggestion_not_a_list_row(self):
        from api import state
        p = {"last_bought": "2026-10-20"}
        self.assertTrue(state._reported_out(p, {"used": "2026-11-02"}))
        self.assertFalse(state._reported_out(p, {"used": "2026-10-01"}))   # bought since
        s = src("api/state.py")
        # only "out" (the household's "I'm out") puts an item on the list
        self.assertIn('out_now = bool(f.get("out")) and not f.get("expired")', s)
        self.assertIn('"you used it up"', s)

    def test_on_a_list_means_no_use_by_question(self):
        # Owner 2026-11-02: an item on a list has run out, so Use soon and
        # Still good? (and Ask's food dates) leave it alone.
        from api import state
        d = {"smart_list": {"items": [{"item_id": "milk", "on_list": True},
                                      {"item_id": "kale", "on_list": False}]}}
        self.assertEqual(state.on_list_ids(d), {"milk"})
        home = src("api/routes/home.py")
        self.assertIn('and p["item_id"] not in listed', home)
        self.assertIn('if r["item_id"] not in listed]', home)
        self.assertIn("state.on_list_ids(d)", src("api/chat_service.py"))

    def test_docs_name_used_it(self):
        self.assertIn("Used it (you finished it", src("prompts/arya_features.md"))
        self.assertIn("moves to Suggestions", src("prompts/arya_features.md"))


if __name__ == "__main__":
    unittest.main()
