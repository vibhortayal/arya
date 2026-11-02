"""Ask Arya adds land in the unchecked part of the list (owner bug,
2026-11-02): an item ticked earlier this trip and asked for again was
re-added with its tick still on, so it showed under Checked off."""
import unittest

from tests import test_ask_in_list as base


class TestAskAddUnchecked(unittest.TestCase):
    setUp = base.TestAskSurfaces.setUp
    ask = base.TestAskSurfaces.ask
    rows = base.TestAskSurfaces.rows

    def tick(self, name):
        iid = self.rows()[name]["item_id"]
        r = self.c.post("/api/list/check", json={"item_id": iid, "checked": True})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(self.rows()[name].get("checked"))
        return iid

    def test_new_item_is_unchecked(self):
        self.ask([{"type": "add_to_list", "item": "naan"}])
        row = self.rows()["naan"]
        self.assertTrue(row.get("on_list"))
        self.assertFalse(row.get("checked"))

    def test_ticked_item_asked_again_comes_off_checked(self):
        self.ask([{"type": "add_to_list", "item": "naan"}])
        self.tick("naan")
        out = self.ask([{"type": "add_to_list", "item": "naan"}])
        self.assertTrue(out["applied"])
        row = self.rows()["naan"]
        self.assertTrue(row.get("on_list"))
        self.assertFalse(row.get("checked"))

    def test_ticked_item_from_chat_screen_comes_off_checked(self):
        self.ask([{"type": "add_to_list", "item": "naan"}])
        self.tick("naan")
        self.ask([{"type": "add_to_list", "item": "naan", "qty": 2}], surface="chat")
        row = self.rows()["naan"]
        self.assertFalse(row.get("checked"))
        self.assertEqual(row.get("qty"), 2)

    def test_ran_out_after_a_tick_is_unchecked(self):
        self.ask([{"type": "add_to_list", "item": "naan"}])
        self.tick("naan")
        self.ask([{"type": "ran_out", "item": "naan"}])  # chat surface applies at once
        self.assertFalse(self.rows()["naan"].get("checked"))

    def test_tick_on_an_extra_list_comes_off_too(self):
        self.ask([{"type": "add_to_list", "item": "naan"}])
        iid = self.rows()["naan"]["item_id"]
        r = self.c.post("/api/lists", json={"name": "Corner shop"})
        self.assertEqual(r.status_code, 200, r.text)
        lid = next(l["id"] for l in self.c.get("/api/lists").json()["lists"] if l["name"] == "Corner shop")
        # On a second list too, and ticked there only.
        self.assertEqual(self.c.post("/api/list/also", json={"item_id": iid, "list_id": lid}).status_code, 200)
        self.assertEqual(self.c.post("/api/list/check", json={"item_id": iid, "checked": True, "list_id": lid}).status_code, 200)
        self.assertEqual(self.rows()["naan"].get("checked_in"), [lid])
        self.ask([{"type": "add_to_list", "item": "naan", "list": "Corner shop"}])
        row = self.rows()["naan"]
        self.assertFalse(row.get("checked"))
        self.assertNotIn(lid, row.get("checked_in") or [])


if __name__ == "__main__":
    unittest.main()
