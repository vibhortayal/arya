"""Points and levels (owner, 2026-10-28): rewards only ever add, and
they bank when the receipt settles the hunt. No lives, no penalty."""
import unittest

from api import social


def sess(n, got):
    return {"items": [{"name": str(i), "checked": i < got} for i in range(n)]}


class TestPoints(unittest.TestCase):
    def test_points_add_per_item_full_haul_and_receipt(self):
        self.assertEqual(social.hunt_points(sess(4, 3)), 3 * 10 + 50)
        self.assertEqual(social.hunt_points(sess(4, 4)), 4 * 10 + 25 + 50)
        self.assertEqual(social.hunt_points(sess(4, 0)), 50)

    def test_levels_grow_and_never_go_down(self):
        self.assertEqual(social.level_for(0)["level"], 1)
        self.assertEqual(social.level_for(99)["level"], 1)
        self.assertEqual(social.level_for(100)["level"], 2)
        self.assertEqual(social.level_for(299)["level"], 2)
        self.assertEqual(social.level_for(300)["level"], 3)
        lv = social.level_for(350)
        self.assertEqual((lv["level_floor"], lv["next_level_at"]), (300, 600))
        last = 1
        for p in range(0, 5000, 7):
            n = social.level_for(p)["level"]
            self.assertGreaterEqual(n, last)
            last = n

    def test_client_mirrors_the_server_rule(self):
        import os
        js = open(os.path.join(os.path.dirname(__file__), "..", "pwa", "quest.js"), encoding="utf-8").read()
        self.assertIn("const QPTS = { item: 10, haul: 25, receipt: 50, boss: 40 };", js)


if __name__ == "__main__":
    unittest.main()
