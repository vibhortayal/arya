"""Ask: a package size is not a count (owner bug, 2026-11-04, live):
"We finished the Greek yogurt." read "Greek Yogurt 32 oz" as 32 of
them ("Add 32 Greek Yogurt to Costcozy", then "Added Greek Yogurt
32 oz x32"). A size in an item's own name stays in the name; a size
someone says ("2 lb chicken") reads as "2 lb", never "x2"; counts
("two lemons") still count."""
import unittest

from tests.test_ask_in_list import TestAskSurfaces


class TestAskSize(TestAskSurfaces):
    def flag_of(self, name):
        flags = self.c.get("/api/account/export").json()["flags"] or {}
        return next(f for f in flags.values() if f.get("name") == name or name in str(f.get("name")))

    def test_finished_the_yogurt_is_one_tub(self):
        out = self.ask([{"type": "ran_out", "item": "Greek Yogurt 32 oz"}])
        text = " ".join(out["applied"] + out["skipped"])
        self.assertNotIn("×32", text)
        self.assertNotIn("32 Greek", text)
        self.assertEqual(len(out["applied"]), 1, text)

    def test_finished_with_a_model_qty_of_the_size(self):
        out = self.ask([{"type": "ran_out", "item": "Greek Yogurt 32 oz", "qty": 32}])
        text = " ".join(out["applied"] + out["skipped"])
        self.assertNotIn("×32", text)

    def test_add_the_yogurt_by_its_name(self):
        out = self.ask([{"type": "add_to_list", "item": "Greek Yogurt 32 oz"}])
        text = " ".join(out["applied"] + out["skipped"])
        self.assertNotIn("×32", text)
        self.assertNotIn("32 Greek", text)

    def test_which_list_chip_keeps_the_size_in_the_name(self):
        self.c.post("/api/lists", json={"name": "Weekend"})
        out = self.ask([{"type": "add_to_list", "item": "Hummus 10 oz"}])
        sends = [c["send"] for c in out.get("choices") or []]
        for s in sends:
            self.assertNotIn("10 Hummus", s)
        self.assertNotIn("×10", " ".join(out["applied"] + out["skipped"]))

    def test_finished_with_two_lists_offers_the_tub_not_32(self):
        # The live case: two lists, so Ask asks which; the chips said
        # "Add 32 Greek Yogurt to Costcozy".
        self.c.post("/api/lists", json={"name": "Weekend"})
        out = self.ask([{"type": "ran_out", "item": "Greek Yogurt 32 oz"}])
        sends = [c["send"] for c in out["choices"]]
        self.assertTrue(sends)
        self.assertEqual(sends[0], "Add Greek Yogurt 32 oz to Costco")
        # The tap, as the model reads it back.
        done = self.ask([{"type": "add_to_list", "item": "Greek Yogurt 32 oz", "list": "Costco"}])
        text = " ".join(done["applied"] + done["skipped"])
        self.assertNotIn("\u00d732", text)

    def test_a_said_size_reads_as_a_size(self):
        out = self.ask([{"type": "add_to_list", "item": "2 lb chicken thighs"}])
        text = " ".join(out["applied"])
        self.assertIn("2 lb", text)
        self.assertNotIn("×2", text)

    def test_counts_still_count(self):
        out = self.ask([{"type": "add_to_list", "item": "two lemons"}])
        self.assertIn("×2", " ".join(out["applied"]))


del TestAskSurfaces

if __name__ == "__main__":
    unittest.main()
