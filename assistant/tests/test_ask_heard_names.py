"""Ask hears list names (owner, 2026-11-02: voice gave "Costcosi" for
Costcozy and Ask did not find the list). Near names and sound-alikes
match the user's own lists; two that fit ask which, with tap-to-answer
choices; nothing is added to a list the user did not mean."""
import unittest

from tests import test_ask_in_list as base


class TestHeardNames(unittest.TestCase):
    setUp = base.TestAskSurfaces.setUp
    ask = base.TestAskSurfaces.ask
    rows = base.TestAskSurfaces.rows

    def make(self, name):
        r = self.c.post("/api/lists", json={"name": name})
        self.assertEqual(r.status_code, 200, r.text)

    def lists(self):
        return {l["name"]: l["id"] for l in self.c.get("/api/lists").json()["lists"]}

    def where(self, item):
        return self.rows()[item].get("list")

    def setUp_town(self):
        # The one demo list renamed as in Demo Town, plus a second list.
        lid = self.lists()["Costco"]
        self.assertEqual(self.c.post("/api/lists/update", json={"id": lid, "name": "Costcozy"}).status_code, 200)
        self.make("Trader Jill's")

    def test_misheard_names_find_the_list(self):
        self.setUp_town()
        for heard, item in [("Costcosi", "naan"), ("costco see", "atta"), ("trader jail", "basil leaves")]:
            out = self.ask([{"type": "add_to_list", "item": item, "list": heard}])
            self.assertTrue(out["applied"], (heard, out))
            self.assertEqual(out["choices"], [])
        ids = self.lists()
        self.assertEqual(self.where("naan"), ids["Costcozy"])
        self.assertEqual(self.where("atta"), ids["Costcozy"])
        self.assertEqual(self.where("basil leaves"), ids["Trader Jill's"])

    def test_two_close_lists_ask_with_choices(self):
        self.setUp_town()
        self.make("Costcosy run")
        self.make("Costcosy")   # sounds the same as Costcozy
        out = self.ask([{"type": "add_to_list", "item": "naan", "list": "Costcosi"}])
        self.assertEqual(out["applied"], [])
        self.assertIn("Which one?", out["skipped"][0])
        labels = [c["label"] for c in out["choices"]]
        self.assertIn("Costcozy", labels)
        self.assertIn("Costcosy", labels)
        self.assertIn("Add naan to Costcozy", [c["send"] for c in out["choices"]])
        self.assertNotIn("naan", self.rows())

    def test_no_match_asks_with_every_list_and_makes_none(self):
        self.setUp_town()
        before = set(self.lists())
        out = self.ask([{"type": "add_to_list", "item": "naan", "list": "Walmart"}])
        self.assertEqual(out["applied"], [])
        self.assertEqual({c["label"] for c in out["choices"]}, before)
        self.assertEqual(set(self.lists()), before)   # no list made from a near-miss
        self.assertNotIn("naan", self.rows())

    def test_no_list_named_with_two_lists_offers_both(self):
        self.setUp_town()
        out = self.ask([{"type": "add_to_list", "item": "naan", "qty": 2}])
        self.assertEqual([c["send"] for c in out["choices"]],
                         ["Add 2 naan to Costcozy", "Add 2 naan to Trader Jill's"])

    def test_tapping_a_choice_adds_there(self):
        self.setUp_town()
        out = self.ask([{"type": "add_to_list", "item": "naan"}])
        pick = next(c for c in out["choices"] if c["label"] == "Trader Jill's")
        # The tap sends pick["send"]; the model turns it into this action.
        self.assertEqual(pick["send"], "Add naan to Trader Jill's")
        self.ask([{"type": "add_to_list", "item": "naan", "list": "Trader Jill's"}])
        self.assertEqual(self.where("naan"), self.lists()["Trader Jill's"])

    def test_remove_from_unknown_list_offers_lists(self):
        self.setUp_town()
        out = self.ask([{"type": "remove_from_list", "item": "naan", "list": "Walmart"}])
        self.assertTrue(all(c["send"].startswith("Remove naan from ") for c in out["choices"]))

    def test_two_questions_send_no_chips(self):
        self.setUp_town()
        out = self.ask([{"type": "add_to_list", "item": "naan"}, {"type": "add_to_list", "item": "atta"}])
        self.assertEqual(len(out["skipped"]), 2)
        self.assertEqual(out["choices"], [])

    def test_unrelated_name_does_not_sound_alike(self):
        self.setUp_town()
        out = self.ask([{"type": "add_to_list", "item": "naan", "list": "Safeway"}])
        self.assertEqual(out["applied"], [])


if __name__ == "__main__":
    unittest.main()
