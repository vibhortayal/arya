"""Ask and voice adds read the quantity out of the words and never
match a plainer tracked item (owner iPhone test, 2026-11-01: "oat milk
and two lemons" added Milk - 2% and an item named "two lemons")."""
import unittest

from tests.test_ask_in_list import TestAskSurfaces as Base, StubChat
from api.list.intake import split_list_items_units


class NumberWords(unittest.TestCase):
    def test_spoken_counts(self):
        self.assertEqual(split_list_items_units("two lemons"), [("lemons", 2, "")])
        self.assertEqual(split_list_items_units("add three avocados"), [("avocados", 3, "")])
        self.assertEqual(split_list_items_units("twelve eggs, one gallon milk"),
                         [("eggs", 12, ""), ("milk", 1, "gallon")])

    def test_names_that_start_with_a_number_word_stay_names(self):
        self.assertEqual(split_list_items_units("one percent milk"), [("one percent milk", 1, "")])
        self.assertEqual(split_list_items_units("oat milk"), [("oat milk", 1, "")])


class AskQty(Base):
    def row(self, name):
        return self.rows().get(name)

    def test_two_lemons_is_lemons_times_two(self):
        out = self.ask([{"type": "add_to_list", "item": "two lemons"}])
        self.assertIn("Added lemons ×2", out["applied"][0])
        r = self.row("lemons")
        self.assertIsNotNone(r)
        self.assertEqual(r["qty"], 2)
        self.assertIsNone(self.row("two lemons"))

    def test_model_qty_field(self):
        self.ask([{"type": "add_to_list", "item": "lemons", "qty": 3}])
        self.assertEqual(self.row("lemons")["qty"], 3)

    def test_oat_milk_is_not_an_existing_milk(self):
        before = set(self.rows())
        self.ask([{"type": "add_to_list", "item": "oat milk"}])
        r = self.row("oat milk")
        self.assertIsNotNone(r)
        # no tracked milk row was added to the list by this ask
        self.assertEqual(set(self.rows()) - before, {"oat milk"})
