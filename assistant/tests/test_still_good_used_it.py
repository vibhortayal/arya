"""Still good? gets "Used it" (owner, 2026-11-02): off the check, and the
item is marked used up (the "out" flag Ask's "we finished it" sets), so
Running low learns. The flag route must accept "out" and the check must
skip an item marked out since its last buy."""
import os
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")


def src(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class StillGoodUsedIt(unittest.TestCase):
    def test_today_offers_used_it_on_each_check(self):
        s = src("web/src/screens/Today.tsx")
        self.assertIn("data-check-used", s)
        self.assertIn('check("used", c.item_id)', s)
        self.assertIn("{ out: new Date().toISOString().slice(0, 10) }", s)
        self.assertIn('"usedItToast"', src("web/src/i18n/en.json"))

    def test_out_is_a_flag_and_ends_the_check(self):
        from api.routes.items import _FLAG_KEYS
        self.assertIn("out", _FLAG_KEYS)
        self.assertIn('said = f.get("out") or f.get("expired")', src("api/routes/home.py"))

    def test_docs_name_used_it(self):
        self.assertIn("Used it (you finished it", src("prompts/arya_features.md"))


if __name__ == "__main__":
    unittest.main()
