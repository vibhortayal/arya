"""Game: album. Aisles map a product name to an album page. Pure,
deterministic, $0: no model, no network."""
import json
import os
import unittest
from datetime import date

from api import aisles

MANIFEST = os.path.join(os.path.dirname(__file__), "..", "pwa", "assets",
                        "characters", "manifest.json")


class TestAisleFor(unittest.TestCase):
    def test_name_to_aisle_table(self):
        table = {
            "ice cream": "Frozen",        # before "cream" is Dairy
            "peanut butter": "Pantry",    # before "butter" is Dairy
            "pasta sauce": "Pantry",
            "eggplant": "Produce",        # a whole word, not "egg"
            "Oat milk": "Dairy",
            "sourdough": "Bakery",
            "hummus": "Deli",
            "paper towels": "Household",  # plural tolerant
            "Organic Bananas": "Produce",
            "Frozen peas": "Frozen",      # the modifier wins
            "Eggs 12ct": "Dairy",
            "potato chips": "Pantry",     # the head noun wins
            "durian": None,               # unknown stays unplaced
            "": None,
            None: None,
        }
        for name, want in table.items():
            self.assertEqual(aisles.aisle_for(name), want, name)

    def test_the_name_decides_and_the_shelf_label_is_a_fallback(self):
        # A known name is never overruled by the shelf it was grabbed at.
        self.assertEqual(aisles.aisle_for("Bananas", "Frozen Foods"), "Produce")
        self.assertEqual(aisles.aisle_for("Bananas", "Dairy"), "Produce")
        self.assertEqual(aisles.aisle_for("Bananas", "Aisle 4"), "Produce")
        # A name the map does not know falls back to the label.
        self.assertEqual(aisles.aisle_for("durian", "Bakery"), "Bakery")
        self.assertIsNone(aisles.aisle_for("durian", "Aisle 4"))
        self.assertIsNone(aisles.aisle_for("durian"))

    def test_a_mixed_shelf_label_does_not_move_a_clear_product(self):
        # Trader Joe's graph label for a mixed shelf.
        label = "Cheese & Dip Shelf"
        for name in ("Brie", "Sharp Cheddar", "Whole Milk"):
            self.assertEqual(aisles.page_for(name, label), "Dairy", name)
        self.assertEqual(aisles.page_for("Hummus", label), "Deli")

    def test_the_same_product_from_two_shelves_lands_on_one_page(self):
        shelves = ["Cheese & Dip Shelf", "Deli", "Dairy", "Frozen Foods",
                   "Aisle 4", None]
        for name in ("Brie", "Sharp Cheddar", "Eggs 12ct", "Bananas"):
            pages = {aisles.page_for(name, s) for s in shelves}
            self.assertEqual(len(pages), 1, (name, pages))

    def test_common_names_the_first_map_misfiled(self):
        table = {
            "Corn Flakes": "Pantry", "Black pepper": "Pantry",
            "Ginger ale": "Pantry", "Rice cakes": "Pantry",
            "Cornstarch": "Pantry", "Corn starch": "Pantry",
            "Canned pumpkin": "Pantry", "Pumpkin puree": "Pantry",
            # The plain words still go where they belong.
            "Corn": "Produce", "Sweet corn": "Produce", "Ginger": "Produce",
            "Bell pepper": "Produce", "Chocolate cake": "Bakery",
        }
        for name, want in table.items():
            self.assertEqual(aisles.page_for(name), want, name)

    def test_constants(self):
        self.assertEqual(aisles.AISLES, ["Produce", "Bakery", "Deli", "Dairy",
                                         "Pantry", "Frozen", "Household"])
        self.assertEqual(aisles.SLOTS, 8)
        self.assertEqual(aisles.OTHER, "Other finds")

    def test_every_aisle_has_rules_and_a_badge(self):
        for a in aisles.AISLES:
            self.assertIn(a, aisles.PAGE_BADGES, a)
            self.assertTrue(aisles._RULES.get(a), a)
        self.assertEqual(aisles.PAGE_BADGES["Halloween"], "Pumpkin King")
        self.assertEqual(aisles.PAGE_BADGES["Dairy"], "Dairy Royalty")

    def test_no_phrase_is_claimed_by_two_aisles_at_equal_weight(self):
        seen = {}
        for aisle, phrases in aisles._RULES.items():
            for ph in phrases:
                other = seen.get(ph)
                # A phrase listed twice must be in the same aisle.
                self.assertTrue(other in (None, aisle), f"{ph}: {other} vs {aisle}")
                seen[ph] = aisle


class TestSeasons(unittest.TestCase):
    def test_season_for(self):
        self.assertEqual(aisles.season_for("Candy Corn"), "Halloween")
        self.assertEqual(aisles.season_for("Mini pumpkin"), "Halloween")
        # Baking stock is not a seasonal find.
        for name in ("Pumpkin puree", "Canned pumpkin", "Pumpkin pie filling"):
            self.assertIsNone(aisles.season_for(name), name)
        self.assertEqual(aisles.season_for("pumpkins"), "Halloween")
        self.assertIsNone(aisles.season_for("Milk"))
        self.assertIsNone(aisles.season_for(""))

    def test_window_edges(self):
        s = aisles.SEASONS[0]
        self.assertEqual(s["badge"], "Pumpkin King")
        self.assertFalse(aisles.season_visible(s, date(2026, 9, 14)))
        self.assertTrue(aisles.season_visible(s, date(2026, 9, 15)))
        self.assertTrue(aisles.season_visible(s, date(2026, 10, 31)))
        self.assertTrue(aisles.season_visible(s, date(2026, 11, 5)))
        self.assertFalse(aisles.season_visible(s, date(2026, 11, 6)))
        self.assertTrue(aisles.season_visible("Halloween", date(2027, 10, 1)))
        self.assertFalse(aisles.season_visible("Nope", date(2026, 10, 1)))

    def test_window_that_wraps_the_new_year(self):
        s = {"window": ((12, 15), (1, 5))}
        self.assertTrue(aisles.season_visible(s, date(2026, 12, 25)))
        self.assertTrue(aisles.season_visible(s, date(2027, 1, 5)))
        self.assertFalse(aisles.season_visible(s, date(2027, 1, 6)))
        self.assertFalse(aisles.season_visible(s, date(2026, 12, 14)))

    def test_page_for_prefers_season_then_aisle_then_other(self):
        self.assertEqual(aisles.page_for("Mini pumpkin"), "Halloween")
        self.assertEqual(aisles.page_for("Pumpkin puree"), "Pantry")
        self.assertEqual(aisles.page_for("Oat milk"), "Dairy")
        self.assertEqual(aisles.page_for("durian"), "Other finds")


class TestArtParity(unittest.TestCase):
    def test_art_for_follows_the_manifest(self):
        with open(MANIFEST, encoding="utf-8") as fh:
            m = json.load(fh)
        self.assertEqual(aisles.art_for("Whole Milk"), "milk.webp")
        self.assertEqual(aisles.art_for("Organic Bananas"), "banana.webp")
        self.assertEqual(aisles.art_for("Strawberries"), "fruit.webp")   # category
        self.assertEqual(aisles.art_for("Frozen Pizza"), "pizza.webp")   # item beats category
        self.assertEqual(aisles.art_for("Ice Cream"), "frozen.webp")
        self.assertEqual(aisles.art_for("Eggplant"), "vegetable.webp")   # not egg
        self.assertEqual(aisles.art_for("Durian"), m["fallback"])
        self.assertEqual(aisles.art_for(""), m["fallback"])

    def test_every_character_it_returns_exists(self):
        root = os.path.dirname(MANIFEST)
        for name in ("milk", "banana", "granola", "ice cream", "bagel",
                     "olive oil", "durian", "yogurt", "carrot"):
            self.assertTrue(os.path.exists(os.path.join(root, aisles.art_for(name))), name)

    def test_matches_the_client_resolver(self):
        """Same inputs, same answers as qFaceFor (see test_celebration)."""
        cases = {"Blueberries": "blueberry.webp", "Organic Bananas": "banana.webp",
                 "Whole Milk": "milk.webp", "Eggs 12ct": "egg.webp",
                 "Olive Oil": "olive-oil.webp", "Peanut Butter": "peanut-butter.webp",
                 "KS Almonds": "almond.webp", "Greek Yogurt": "dairy.webp",
                 "Bagels": "bakery.webp", "Carrots": "vegetable.webp",
                 "Granola": "pantry.webp", "Durian": "basket.webp"}
        for name, want in cases.items():
            self.assertEqual(aisles.art_for(name), want, name)


if __name__ == "__main__":
    unittest.main()
