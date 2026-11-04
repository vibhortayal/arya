"""Store news names (owner, 2026-11-04): a shared "Eggs: out" report
reaches a list that says "Large eggs" or "Eggs 12 ct", by the same core
words as the receipt matcher (plurals, size and unit noise dropped).
Conservative: "Egg noodles" or "Almond milk" never take an eggs or milk
alert, and an alert still needs its item on my list."""
import unittest

from tests.test_shared_reports import Base


class TestNewsItemMatch(Base):
    def setUp(self):
        super().setUp()
        for u in ("a@x.com", "b@x.com", "c@x.com"):
            self.report(u, item="Eggs", store="Trader Joe's")
            self.report(u, item="Milk", store="Trader Joe's")

    def items(self, wanted):
        return sorted(n["item"] for n in self.news_for("me@x.com", wanted=wanted, stores=["Trader Joe's"]))

    def test_size_and_unit_words_still_match(self):
        self.assertEqual(self.items(["Large eggs"]), ["Large eggs"])
        self.assertEqual(self.items(["Eggs 12 ct"]), ["Eggs 12 ct"])
        self.assertEqual(self.items(["Organic Milk 1 gal"]), ["Organic Milk 1 gal"])

    def test_a_different_product_never_matches(self):
        self.assertEqual(self.items(["Egg noodles", "Almond milk", "Chocolate milk"]), [])

    def test_my_own_words_and_both_items(self):
        self.assertEqual(self.items(["Large eggs", "Milk - 2%"]), ["Large eggs", "Milk - 2%"])

    def test_finding_large_eggs_clears_an_eggs_report(self):
        self.as_("me@x.com")
        self.sr.found("Trader Joe's", "Large eggs", None)
        self.assertEqual(self.items(["Large eggs", "Milk"]), ["Milk"])


if __name__ == "__main__":
    unittest.main()
