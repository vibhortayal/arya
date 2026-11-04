"""'We finished the yogurt' after the yogurt row was removed this cycle
must put it back: the reply says it is on the list (owner bug 2026-11-03)."""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(__file__))
import test_ask_in_list as base  # noqa: E402

Y = "Greek Yogurt 32 oz"


class TestRanOutAfterRemove(base.TestAskSurfaces):
    def on_list(self):
        return Y in [i["name"] for i in self.c.get("/api/home").json()["list"]["items"]]

    def test_removed_tracked_item_returns_when_out(self):
        self.ask([{"type": "ran_out", "item": Y}])
        flags = self.c.get("/api/account/export").json()["flags"]
        iid = next(k for k, v in flags.items() if v.get("out"))
        self.c.post("/api/list/remove", json={"item_id": iid})
        self.assertFalse(self.on_list())
        out = self.ask([{"type": "ran_out", "item": Y}])
        self.assertIn("on the list", out["applied"][0])
        self.assertTrue(self.on_list())


del base.TestAskSurfaces  # run only this class

if __name__ == "__main__":
    unittest.main()
