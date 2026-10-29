"""Demo cost lever — review 2026-10-28, H4.

The demo's live doors spend from their own ledger bucket with
their own daily cap: demo spend can exhaust the demo's day but
never trips the real accounts' budget guard. Demo session minting
and the live doors are rate-limited per IP. Expired sessions are
pruned on write.
"""
import json, os, tempfile, time, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"


class TestLedgerBuckets(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".jsonl")
        os.close(fd)
        os.unlink(self.path)
        from api.cost_ledger import CostLedger
        self.CostLedger = CostLedger

    def _record(self, bucket, cost):
        self.CostLedger(self.path, bucket=bucket).record(
            mode="standard", model="m", input_tokens=1,
            cached_tokens=0, output_tokens=1, cost_usd=cost)

    def test_buckets_total_separately(self):
        self._record("app", 1.50)
        self._record("demo", 0.75)
        led = self.CostLedger(self.path)
        self.assertEqual(led.spent_today(), 2.25)
        self.assertEqual(led.spent_today("app"), 1.50)
        self.assertEqual(led.spent_today("demo"), 0.75)

    def test_legacy_rows_count_as_app(self):
        with open(self.path, "w") as f:
            f.write(json.dumps({
                "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "mode": "standard", "model": "m", "input_tokens": 1,
                "cached_tokens": 0, "output_tokens": 1,
                "cost_usd": 0.50}) + "\n")
        led = self.CostLedger(self.path)
        self.assertEqual(led.spent_today("app"), 0.50)
        self.assertEqual(led.spent_today("demo"), 0.0)


class TestGuardSeparation(unittest.TestCase):
    def setUp(self):
        from api import deps
        fd, self.path = tempfile.mkstemp(suffix=".jsonl")
        os.close(fd)
        os.unlink(self.path)
        import api.main as main
        from api.cost_ledger import CostLedger
        self.main, self.CostLedger = main, CostLedger
        self._orig_ledger = deps._LEDGER
        deps._LEDGER = self.path

    def tearDown(self):
        from api import deps
        deps._LEDGER = self._orig_ledger

    def test_demo_spend_does_not_trip_the_app_guard(self):
        from api import deps
        from fastapi import HTTPException
        self.CostLedger(self.path, bucket="demo").record(
            mode="wonder", model="m", input_tokens=1, cached_tokens=0,
            output_tokens=1, cost_usd=3.00)
        deps._budget_guard()  # app bucket empty: no raise
        with self.assertRaises(HTTPException) as cm:
            deps._budget_guard(demo=True)  # demo cap is $2
        self.assertEqual(cm.exception.status_code, 503)


class TestDemoRateLimits(unittest.TestCase):
    def setUp(self):
        from api import demo_guard
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["ARYA_DEMO_AUTH_RATE"] = "3"
        from fastapi.testclient import TestClient
        import api.main as main
        demo_guard._demo_auth_hits.clear()
        demo_guard._demo_door_hits.clear()
        self.c = TestClient(main.app)

    def tearDown(self):
        del os.environ["ARYA_DEMO_AUTH_RATE"]

    def test_demo_session_minting_is_capped(self):
        for _ in range(3):
            r = self.c.post("/auth/demo")
            self.assertEqual(r.status_code, 200, r.text)
        r = self.c.post("/auth/demo")
        self.assertEqual(r.status_code, 429, r.text)


class TestHaulWritesAreFree(unittest.TestCase):
    """Haul fixes, hides and posts never call a model, so they spend
    no live-door budget (they sit under the sessions prefix)."""

    def test_door_check(self):
        from api import demo_guard
        import api.main as main
        for path in ("/api/quest/sessions/s1/haul/fix",
                     "/api/quest/sessions/s1/haul/hide",
                     "/api/quest/sessions/s1/haul/post",
                     "/api/quest/sessions/s1/haul/receipts"):
            self.assertFalse(demo_guard._demo_live_door(path), path)
        # The real doors stay counted.
        for path in ("/api/quest/sessions", "/api/quest/sessions/s1/check",
                     "/api/quest/sessions/s1/receipt", "/decode/photo",
                     "/api/quest/scan-shelf"):
            self.assertTrue(demo_guard._demo_live_door(path), path)


class TestSessionPruning(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import auth
        self.auth = auth

    def test_new_session_prunes_expired(self):
        self.auth._save("sessions.json", {
            "dead": {"user": "gone@example.com", "demo": False,
                     "expires": int(time.time()) - 10}})
        tok = self.auth.new_session("live@example.com")
        stored = self.auth._load("sessions.json", {})
        self.assertNotIn("dead", stored)
        self.assertEqual(len(stored), 1)
        self.assertEqual(self.auth.session_user(tok), "live@example.com")


if __name__ == "__main__":
    unittest.main()


class TestSessionShare(unittest.TestCase):
    def setUp(self):
        from api import main, state
        from api import deps
        from api import demo_guard
        self.main, self.state = main, state
        fd, path = tempfile.mkstemp(suffix=".jsonl")
        os.close(fd)
        os.unlink(path)
        self._old = deps._LEDGER
        deps._LEDGER = path

    def tearDown(self):
        from api import deps
        self.state.set_overlay(None)
        deps._LEDGER = self._old

    def _spend(self, box, usd):
        from api import deps
        self.state.set_overlay(box)
        deps._ledger().record(mode="standard", model="m", input_tokens=1,
                                   cached_tokens=0, output_tokens=1, cost_usd=usd)

    def test_visit_share_stops_one_visitor_only(self):
        from api import deps
        from fastapi import HTTPException
        a, b = {}, {}
        self._spend(a, 0.50)
        self.state.set_overlay(a)
        with self.assertRaises(HTTPException) as cm:
            deps._budget_guard()
        self.assertEqual(cm.exception.status_code, 503)
        self.assertIn("this demo visit", cm.exception.detail)
        self.state.set_overlay(b)       # another visitor is unaffected
        deps._budget_guard()

    def test_daily_demo_cap_message_is_friendly(self):
        from api import deps
        from fastapi import HTTPException
        os.environ["ARYA_DEMO_DAILY_BUDGET_USD"] = "0.30"
        try:
            self._spend({}, 0.35)
            self.state.set_overlay({})
            with self.assertRaises(HTTPException) as cm:
                deps._budget_guard()
            self.assertIn("paused for today", cm.exception.detail)
        finally:
            del os.environ["ARYA_DEMO_DAILY_BUDGET_USD"]
