"""Used it / I'm out on an item bought only once (Tester, 2026-11-03):
it has no interval, so Running low and the list must give the
household's own reason instead of formatting a None interval, which
made /api/home answer 500 and broke Lists and Today."""
import copy, datetime, json, os, shutil, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient


class TestOnceBought(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = d
        from tests.test_eyes_chat import seed_demo
        seed_demo(d)
        shutil.copytree(os.path.join(d, "users", "demo"), os.path.join(d, "users", "owner"), dirs_exist_ok=True)
        from api import auth, main
        auth.create_user("owner", "owner-pass-1")
        f = os.path.join(d, "users", "owner", "receipts.json")
        rs = json.load(open(f))
        rec = copy.deepcopy(rs[0])
        line = copy.deepcopy(rec["lines"][0])
        line.update(item_id="once-spin", sku="once-spin", decoded_name="Baby Spinach 16 oz", raw="BABY SPINACH")
        rec.update(receipt_id="once", purchased_at=(datetime.date.today() - datetime.timedelta(days=3)).isoformat(), lines=[line])
        rs.append(rec)
        json.dump(rs, open(f, "w"))
        self.c = TestClient(main.app, raise_server_exceptions=False)
        self.c.post("/auth/login", json={"username": "owner", "password": "owner-pass-1"})
        self.assertEqual(self.c.get("/api/home").status_code, 200)
        self.today = datetime.date.today().isoformat()

    def low(self):
        r = self.c.get("/api/home")
        self.assertEqual(r.status_code, 200, r.text)
        return {x["item_id"]: x for x in r.json()["running_low"]}

    def test_used_it_keeps_home_working(self):
        self.assertEqual(self.c.post("/api/items/once-spin/flag", json={"used": self.today}).status_code, 200)
        row = self.low().get("once-spin")
        self.assertIsNotNone(row)
        self.assertEqual(row["reason"], "You used it up")
        self.assertIn("home", self.c.get("/api/today").json())

    def test_im_out_keeps_home_working(self):
        self.assertEqual(self.c.post("/api/items/once-spin/flag", json={"out": self.today}).status_code, 200)
        row = self.low().get("once-spin")
        self.assertIsNotNone(row)
        self.assertNotIn("every ~", row["reason"])


class TestDueReason(unittest.TestCase):
    def test_no_interval_gives_what_the_household_said(self):
        from api.list.build import due_reason
        self.assertEqual(due_reason({"median_interval_days": None, "user_report": "you said you're out"}), "You said you're out")
        self.assertEqual(due_reason({"median_interval_days": None}), "You used it up")
        self.assertEqual(due_reason({"median_interval_days": 7.4, "days_since_last": 9}), "every ~7 days; last bought 9 days ago")


if __name__ == "__main__":
    unittest.main()
