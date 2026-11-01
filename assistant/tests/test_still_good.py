""""Still good?" asks only while an item could still be at home (owner,
2026-11-01: after a bulk upload it asked about milk from Jul 8, yogurt
from last Dec and eggs from Apr, 19 at once, in receipt capitals)."""
import unittest

from api.eyes.service import CHECK_MAX_DAYS, MAX_CHECKS, short_name, should_check, still_good_window


class TestWindow(unittest.TestCase):
    def test_milk_is_asked_from_its_shelf_life_for_a_few_days(self):
        self.assertFalse(should_check(8, 9))
        self.assertTrue(should_check(9, 9))
        self.assertTrue(should_check(13, 9))
        self.assertFalse(should_check(14, 9))

    def test_months_old_purchases_are_never_asked(self):
        for prior in (3, 5, 9, 14, 21):
            for age in (60, 116, 324):
                self.assertFalse(should_check(age, prior), (age, prior))

    def test_the_window_never_passes_the_cap(self):
        for prior in range(1, 40):
            self.assertLessEqual(still_good_window(prior)[1], CHECK_MAX_DAYS)

    def test_no_shelf_life_no_question(self):
        self.assertFalse(should_check(10, None))

    def test_few_at_once(self):
        self.assertLessEqual(MAX_CHECKS, 3)


class TestShortName(unittest.TestCase):
    def test_receipt_capitals_and_sizes_are_cleaned(self):
        self.assertEqual(short_name("2% MILK ORGANIC"), "2% Milk Organic")
        self.assertEqual(short_name("RASPBERRIES"), "Raspberries")
        self.assertEqual(short_name("Kirkland Signature 5DZ EGGS 5 dozen"), "Kirkland Signature Eggs")
        self.assertEqual(short_name("Taylor Farms Salad Kit, 12 oz, 2-count"), "Taylor Farms Salad Kit")
        self.assertEqual(short_name("Chobani Yogurt"), "Chobani Yogurt")


if __name__ == "__main__":
    unittest.main()


class FakeSpark:
    api_key = "k"

    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def chat(self, messages, **kw):
        self.calls.append(messages[1]["content"])
        return self.reply, {}, 0.0


class TestSparkShelfLife(unittest.TestCase):
    def test_answers_are_parsed_and_bounded(self):
        from api import shelflife
        fake = FakeSpark('{"items": [{"item_id": "a", "shelf_days": 9},'
                         ' {"item_id": "b", "shelf_days": null},'
                         ' {"item_id": "c", "shelf_days": 400},'
                         ' {"item_id": "zzz", "shelf_days": 3}]}')
        out = shelflife.ask_batch(fake, [("a", "2% MILK ORGANIC"), ("b", "Rice"), ("c", "Honey")])
        self.assertEqual(out, {"a": 9, "b": None, "c": None})
        self.assertIn("[a] 2% MILK ORGANIC", fake.calls[0])

    def test_spark_wins_over_the_keyword_table_and_null_means_never_ask(self):
        from api import shelflife
        cache = {"x": {"days": 4}, "y": {"days": None}}
        self.assertEqual(shelflife.shelf_days("x", "Whole Milk", cache), 4)
        self.assertIsNone(shelflife.shelf_days("y", "Whole Milk", cache))
        self.assertEqual(shelflife.shelf_days("z", "Whole Milk", cache), 9)  # keyword fallback

    def test_no_key_asks_nothing(self):
        from api import shelflife

        class NoKey:
            api_key = ""
        self.assertEqual(shelflife.pending(NoKey()), 0)


class TestSkippedItemsKeepTheKeywordTable(unittest.TestCase):
    def test_asked_without_answer_falls_back(self):
        from api import shelflife
        self.assertEqual(shelflife.shelf_days("x", "Whole Milk", {"x": {"asked": True}}), 9)
