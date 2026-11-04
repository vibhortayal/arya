"""Quest review fixes (2026-11-04, owner: "I want all fixes", "fix P3").

- "It's somewhere else here" and "Can't tell" never become a shared
  "not there" alert; only an empty shelf (or a replaced product) does.
- A Quest substitute pairs with its receipt line as a confirmed swap.
- One Quest trip plus its receipt raises the level by the game's points
  plus 50, never the grabs twice. Express keeps its full hunt points.
"""
import os, tempfile, unittest

from tests.test_quest import TODAY, make_client, setup_account


class TestSharedKinds(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        setup_account(self)

    def test_only_a_gone_item_is_shared(self):
        from api import shared_reports
        assert shared_reports.add("Trader Joe's", "Milk", "milk", "wrong_aisle") is None
        assert shared_reports.add("Trader Joe's", "Milk", "milk", "cant_tell") is None
        assert shared_reports.add("Trader Joe's", "Eggs", "eggs", "empty_shelf") is not None

    def test_an_old_wrong_aisle_row_never_alerts(self):
        from api import shared_reports
        os.environ["ARYA_REPORT_QUORUM"] = "1"
        try:
            with shared_reports._locked():
                doc = shared_reports._load()
                sk = shared_reports._store_key("Trader Joe's")
                doc[sk] = [{"store_key": sk, "item_key": "milk", "kind": "wrong_aisle",
                            "at": shared_reports._iso(shared_reports._now()), "by": "someone-else"}]
                shared_reports._save(doc)
            assert shared_reports.groups("Trader Joe's") == []
        finally:
            del os.environ["ARYA_REPORT_QUORUM"]


class TestSubstituteOnReceipt(unittest.TestCase):
    def test_instead_pairs_as_a_confirmed_swap(self):
        from api import haul
        sess = {"items": [{"name": "Milk", "group": "milk", "qty": 1, "checked": True, "instead": "Oat milk"}]}
        lines = [{"_name": "Oat Milk", "_qty": 1, "raw": "OAT MILK"}]
        out = haul.match(sess, lines)
        assert out["matched"] == [] and out["grabbed_only"] == [] and out["on_receipt_only"] == []
        assert len(out["swapped"]) == 1
        sw = out["swapped"][0]
        assert sw["name"] == "Oat milk" and sw["from"] == "Milk" and sw["suggested"] is False


class TestOneLevel(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        setup_account(self)

    def _file_receipt(self, rid):
        from api import state
        prev = state._current_user.get()
        state.set_current_user("owner@example.com")
        try:
            rs = state.receipts()
            rs.append({"receipt_id": rid, "merchant": "Trader Joe's", "purchased_at": TODAY,
                       "lines": [], "subtotal": 0, "tax": 0, "total": 0, "totals_reconcile": True})
            state._save("receipts.json", rs)
        finally:
            state._current_user.set(prev)

    def _trip(self, mode, rid):
        c = self.c
        sid = c.post("/api/quest/sessions", json={"store": "Trader Joe's", "mode": mode,
                                                 "items": ["milk", "eggs"]}).json()["id"]
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        for it in ("milk", "eggs"):
            c.post(f"/api/quest/sessions/{sid}/check", json={"item": it, "checked": True})
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "finished"})
        self._file_receipt(rid)
        r = c.post(f"/api/quest/sessions/{sid}/receipt", json={"receipt_id": rid})
        assert r.status_code == 200 and r.json()["state"] == "done", r.text
        return r.json()

    def test_a_quest_trip_counts_game_points_plus_50(self):
        c = self.c
        before = c.get("/api/quest/profile").json()["points"]
        done = self._trip("quest", "r-q-1")
        boss = 40 if done.get("boss") and any(i.get("checked") and i.get("group") == done["boss"]["group"] for i in done["items"]) else 0
        game = 20  # the game scored the two grabs
        c.put("/api/quest/game", json={"profile": {"xp": game, "stickers": [], "weeks": []}})
        after = c.get("/api/quest/profile").json()["points"]
        assert after - before == game + 50 + boss

    def test_express_keeps_its_hunt_points(self):
        from api import social
        c = self.c
        before = c.get("/api/quest/profile").json()["points"]
        done = self._trip("express", "r-x-1")
        after = c.get("/api/quest/profile").json()["points"]
        assert after - before == social.hunt_points(done)


if __name__ == "__main__":
    unittest.main()
