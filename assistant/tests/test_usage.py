"""Keeping Arya running (owner, 2026-10-30): each paid call is booked to
the account that made it, with a kind; /api/usage reports lifetime and
this month; the heads-up and the pause only reach an account far above
a typical one, and never the owner."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient


def _book(path, user, usd, kind="reads", bucket="app"):
    from api.cost_ledger import CostLedger, usage_kind
    tok = usage_kind.set(kind)
    try:
        CostLedger(path, bucket=bucket, user=user).record(
            mode="standard", model="m", input_tokens=1, cached_tokens=0,
            output_tokens=1, cost_usd=usd)
    finally:
        usage_kind.reset(tok)


class TestUsage(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import deps, state
        state.set_current_user(None)  # sessions are read with no account set
        from api.main import app
        self.deps = deps
        self.ledger = os.path.join(tempfile.mkdtemp(), "ledger.jsonl")
        self._orig = deps._LEDGER
        deps._LEDGER = self.ledger
        self.c = TestClient(app)
        self.c.post("/auth/setup", json={"username": "owner-a", "password": "correct horse"})
        from api import auth
        auth.create_user("kim@test.arya", "pw-123456")
        os.environ["ARYA_USER_HOURLY_FREEZE_USD"] = "1000"  # off, except in its own test

    def tearDown(self):
        from api import state
        state.set_current_user(None)
        self.deps._LEDGER = self._orig
        for k in ("ARYA_OWNER_USERNAME", "ARYA_COST_PUBLIC_MIN", "ARYA_USER_HOURLY_FREEZE_USD"):
            os.environ.pop(k, None)

    def _login(self, name):
        self.c.post("/auth/logout")
        r = self.c.post("/auth/login", json={"username": name, "password": "pw-123456"})
        self.assertEqual(r.status_code, 200, r.text)

    def test_rows_carry_user_and_kind_only_for_real_accounts(self):
        import json
        _book(self.ledger, "kim@test.arya", 0.02, "ask")
        _book(self.ledger, "demo", 0.40, "reads", bucket="demo")
        rows = [json.loads(l) for l in open(self.ledger)]
        self.assertEqual((rows[0]["user"], rows[0]["kind"]), ("kim@test.arya", "ask"))
        self.assertNotIn("user", rows[1])

    def test_kind_follows_the_url(self):
        from api.cost_ledger import kind_for_path
        self.assertEqual(kind_for_path("/api/chat"), "ask")
        self.assertEqual(kind_for_path("/decode/photo"), "reads")
        self.assertEqual(kind_for_path("/api/storemap/scan"), "maps")
        self.assertEqual(kind_for_path("/api/list/add"), "helps")

    def test_usage_totals_one_account(self):
        _book(self.ledger, "kim@test.arya", 1.00, "reads")
        _book(self.ledger, "kim@test.arya", 0.25, "ask")
        _book(self.ledger, "other@test.arya", 9.00, "reads")
        self._login("kim@test.arya")
        d = self.c.get("/api/usage").json()
        self.assertEqual(d["lifetime_usd"], 1.25)
        self.assertEqual(d["month_usd"], 1.25)
        self.assertEqual(d["kinds"]["reads"], {"n": 1, "usd": 1.0})
        self.assertEqual(d["kinds"]["ask"]["n"], 1)
        self.assertFalse(d["heavy"])
        self.assertFalse(d["paused"])
        self.assertIsNone(d["whole"])  # two accounts: too few for an average

    def test_whole_shows_once_enough_accounts_have_spend(self):
        os.environ["ARYA_COST_PUBLIC_MIN"] = "2"
        _book(self.ledger, "kim@test.arya", 1.00)
        _book(self.ledger, "other@test.arya", 3.00)
        _book(self.ledger, "demo", 5.00, bucket="demo")
        self._login("kim@test.arya")
        w = self.c.get("/api/usage").json()["whole"]
        self.assertEqual((w["usd"], w["people"], w["average_usd"]), (4.0, 2, 2.0))

    def test_heavy_warns_then_ceiling_pauses_but_not_the_owner(self):
        from fastapi import HTTPException
        _book(self.ledger, "kim@test.arya", 3.10)
        self._login("kim@test.arya")
        d = self.c.get("/api/usage").json()
        self.assertTrue(d["heavy"])
        self.assertFalse(d["paused"])
        self.deps._budget_guard()  # warned, not stopped
        _book(self.ledger, "kim@test.arya", 2.00)
        d = self.c.get("/api/usage").json()
        self.assertTrue(d["paused"])
        from api import state
        state.set_current_user("kim@test.arya")
        with self.assertRaises(HTTPException) as cm:
            self.deps._budget_guard()
        self.assertEqual(cm.exception.status_code, 429)
        os.environ["ARYA_OWNER_USERNAME"] = "kim@test.arya"
        self.deps._budget_guard()  # the owner is never limited
        state.set_current_user(None)
        self.assertFalse(self.c.get("/api/usage").json()["paused"])

    def test_an_hour_over_the_line_freezes_reads_until_lifted(self):
        from fastapi import HTTPException
        from api import state
        os.environ["ARYA_USER_HOURLY_FREEZE_USD"] = "1"
        _book(self.ledger, "kim@test.arya", 1.20)
        self._login("kim@test.arya")
        d = self.c.get("/api/usage").json()
        self.assertTrue(d["paused"])  # asking never freezes
        self.assertEqual(self.deps.frozen_until("kim@test.arya"), 0)
        state.set_current_user("kim@test.arya")
        with self.assertRaises(HTTPException) as cm:
            self.deps._budget_guard()
        self.assertEqual(cm.exception.status_code, 429)
        self.assertGreater(self.deps.frozen_until("kim@test.arya"), 0)
        # still frozen once the hour's spend has aged out of the window
        os.environ["ARYA_USER_HOURLY_FREEZE_USD"] = "1000"
        with self.assertRaises(HTTPException):
            self.deps._budget_guard()
        state.set_current_user(None)  # sessions are read with no account set
        # a normal account cannot lift it; the owner can
        r = self.c.post("/api/usage/unfreeze", json={"user": "kim@test.arya"})
        self.assertEqual(r.status_code, 403, r.text)
        os.environ["ARYA_OWNER_USERNAME"] = "kim@test.arya"
        self.assertEqual(self.c.post("/api/usage/unfreeze", json={"user": "kim@test.arya"}).status_code, 200)
        self.assertEqual(self.deps.frozen_until("kim@test.arya"), 0)

    def test_the_demo_household_sees_nothing(self):
        _book(self.ledger, "kim@test.arya", 1.00)
        self.c.post("/auth/demo")
        d = self.c.get("/api/usage").json()
        self.assertEqual(d["lifetime_usd"], 0)
        self.assertFalse(d["heavy"])


if __name__ == "__main__":
    unittest.main()
