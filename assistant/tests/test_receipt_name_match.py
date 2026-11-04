"""Smart receipt-line / list-item name matching (conservative)."""
import os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from api import quest  # noqa: E402

M = quest._name_match


class TestSmartMatch(unittest.TestCase):
    def test_owner_screenshot_pairs(self):
        self.assertTrue(M("MILK ORGANIC HALF GALLON", "Milk - 2%"))
        self.assertTrue(M("APPLES COSMIC CRISP 2 @ $1.19 x2", "Apple"))
        self.assertTrue(M("APPLES COSMIC CRISP 2 @ $1.19 x2", "Apples"))
        self.assertTrue(M("BANANA ORG EACH 2 @ $0.29 x2", "banana"))

    def test_plural_organic_abbrev(self):
        self.assertTrue(M("ORGANIC BANANAS", "Banana"))
        self.assertTrue(M("KS ORG BNNA 3LB", "Bananas"))
        self.assertTrue(M("STRAWBERRIES 1 LB", "Strawberry"))

    def test_old_behaviour_kept(self):
        self.assertTrue(M("Greek Yogurt 32 oz", "Greek Yogurt"))
        self.assertFalse(M("Oat Milk Chocolate", "Milk"))

    def test_different_foods_stay_apart(self):
        self.assertFalse(M("APPLE JUICE", "Apple"))
        self.assertFalse(M("PEANUT BUTTER", "Peanut"))
        self.assertFalse(M("ALMOND MILK", "Milk"))
        self.assertFalse(M("BANANA BREAD", "Banana"))
        self.assertFalse(M("HONEYCRISP", "Banana"))
        self.assertFalse(M("", "Milk"))

    def test_core_tokens(self):
        self.assertEqual(quest._core_tokens("Milk - 2%"), {"milk"})
        self.assertEqual(quest._core_tokens("APPLES COSMIC CRISP 2 @ $1.19 x2"), {"apple"})


if __name__ == "__main__":
    unittest.main()
