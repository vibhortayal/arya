"""Running-low flags — audit 2026-10-29.

A "ran out" report ends when the item is bought again; a snooze ends
on its calendar date even when no receipt lands; both keep the
judge's staple gate for patterns.
"""
import os, tempfile, unittest
from datetime import date, timedelta

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
from fastapi.testclient import TestClient  # noqa: E402

from tests.test_list_pass import FakeClient, seed_receipt  # noqa: E402


class TestRunningLowFlags(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.main = main
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={
            "username": "t@x.y", "password": "long-password"})
        assert r.status_code == 200, r.text
        today = date.today()
        self.days = [(today - timedelta(days=d)).isoformat()
                     for d in (80, 66, 52, 38)]
        for d in self.days:
            seed_receipt(self.c, "Costco", d, [("Eggs", "2002", 5.0)], "r-" + d)
        from api import state
        self.state = state
        state.set_current_user("t@x.y")
        state._save("dictionary.json", {"entries": [
            {"item_id": "costco-2002", "sku": "2002",
             "canonical_name": "Eggs", "aliases": []}]})
        state._save("judged.json", {"costco-2002": {
            "list_ok": True, "class": "STAPLE", "buys": 4}})
        state.set_current_user(None)

    def tearDown(self):
        self.state.set_current_user(None)

    def flag(self, **f):
        self.c.post("/api/items/costco-2002/flag", json=f)

    def on_list(self):
        return [i["item_id"] for i in self.c.get("/api/home").json()["list"]["items"]]

    def test_due_baseline(self):
        self.assertIn("costco-2002", self.on_list())

    def test_snooze_ends_on_its_date_without_a_new_receipt(self):
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        self.flag(snoozed_until=yesterday)
        self.assertIn("costco-2002", self.on_list())

    def test_snooze_hides_until_its_date(self):
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        self.flag(snoozed_until=tomorrow)
        self.assertNotIn("costco-2002", self.on_list())

    def test_ran_out_ends_when_bought_again(self):
        self.flag(never=False, out=(date.today() - timedelta(days=3)).isoformat())
        seed_receipt(self.c, "Costco", date.today().isoformat(),
                     [("Eggs", "2002", 5.0)], "r-rebuy")
        self.assertNotIn("costco-2002", self.on_list())

    def test_ran_out_still_counts_before_a_rebuy(self):
        self.flag(out=date.today().isoformat())
        self.assertIn("costco-2002", self.on_list())
