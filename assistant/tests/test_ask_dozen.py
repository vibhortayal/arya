"""Ask "add a dozen eggs" gave "Pasture Eggs 12 ct ×12" (Tester, live
2026-11-01): a quantity counts packages, so a dozen of a 12-count carton
is one carton."""
import unittest

from api import chat_service
from tests.test_ask_gaps import AskCase


class PackSize(unittest.TestCase):
    def test_pack_sizes(self):
        p = chat_service.pack_size
        self.assertEqual((p("Pasture Eggs 12 ct"), p("Large Eggs 18 Count"), p("Eggs dozen"),
                          p("Whole Milk 1 gal"), p("Coffee Beans 12 oz")), (12, 18, 12, 1, 1))

    def test_packs(self):
        f = chat_service._packs
        self.assertEqual(f(12, "Pasture Eggs 12 ct"), 1)
        self.assertEqual(f(24, "Pasture Eggs 12 ct"), 2)
        self.assertEqual(f(2, "Pasture Eggs 12 ct"), 2)    # two cartons stays two
        self.assertEqual(f(12, "Coffee Beans 12 oz"), 12)  # ounces are not a count
        self.assertEqual(f(6, "Pasture Eggs 12 ct"), 6)


class AskDozen(AskCase):
    def test_dozen_eggs_is_one_carton(self):
        out = self.ask("add a dozen eggs", [{"type": "add_to_list", "item": "Pasture Eggs 12 ct", "qty": 12, "list": "Costco"}])
        self.assertTrue(out["applied"][0].startswith("Added Pasture Eggs 12 ct"), out)
        self.assertNotIn("\u00d7", out["applied"][0])
        out = self.ask("add two dozen eggs", [{"type": "add_to_list", "item": "eggs", "qty": 24}])
        self.assertIn("\u00d72", out["applied"][0])
        self.assertNotIn("\u00d724", out["applied"][0])


if __name__ == "__main__":
    unittest.main()
