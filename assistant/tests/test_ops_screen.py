"""The owner's Ops screen (2026-10-31): the summary, the switches and
what they stop. Owner only; the demo and other accounts get 403."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient


class TestOpsScreen(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import deps, state
        state.set_current_user(None)
        from api.main import app
        self.deps = deps
        self._orig = deps._LEDGER
        deps._LEDGER = os.path.join(tempfile.mkdtemp(), "ledger.jsonl")
        self.c = TestClient(app)
        self.c.post("/auth/setup", json={"username": "owner-a", "password": "correct horse"})
        from api import auth
        auth.create_user("kim@test.arya", "pw-123456")

    def tearDown(self):
        from api import state
        state.set_current_user(None)
        self.deps._LEDGER = self._orig
        os.environ.pop("ARYA_OWNER_USERNAME", None)

    def _login(self, name):
        self.c.post("/auth/logout")
        self.assertEqual(self.c.post("/auth/login", json={"username": name, "password": "pw-123456"}).status_code, 200)

    def test_only_the_owner_reads_or_sets(self):
        self._login("kim@test.arya")
        self.assertEqual(self.c.get("/api/ops").status_code, 403)
        self.assertEqual(self.c.post("/api/ops/controls", json={"ai_paused": True}).status_code, 403)
        self.c.post("/auth/logout")
        self.c.post("/auth/demo")
        self.assertEqual(self.c.get("/api/ops").status_code, 403)

    def test_summary_flags_a_failing_feature_and_a_frozen_account(self):
        from api.cost_ledger import CostLedger, usage_kind
        os.environ["ARYA_OWNER_USERNAME"] = "kim@test.arya"
        led = CostLedger(self.deps._LEDGER, user="x@y")
        tok = usage_kind.set("reads")
        for _ in range(6):
            led.record("wonder", "m", ok=False, err="timeout", ms=900)
        usage_kind.reset(tok)
        self.deps.freeze("ann@x", 1.4)
        self._login("kim@test.arya")
        d = self.c.get("/api/ops").json()
        titles = [n["title"] for n in d["needs"]]
        self.assertIn("Photo and receipt reads failing", titles)
        self.assertIn("ann@x is frozen", titles)
        self.assertEqual(d["frozen"][0]["user"], "ann@x")
        self.assertIn("ai_paused", d["controls"])

    def test_pause_stops_paid_reads_and_lists_keep_working(self):
        from fastapi import HTTPException
        os.environ["ARYA_OWNER_USERNAME"] = "kim@test.arya"
        self._login("kim@test.arya")
        self.assertEqual(self.c.post("/api/ops/controls", json={"ai_paused": True}).status_code, 200)
        with self.assertRaises(HTTPException) as cm:
            self.deps.new_client()
        self.assertEqual(cm.exception.status_code, 503)
        with self.assertRaises(HTTPException):
            self.deps._budget_guard()
        self.assertEqual(self.c.get("/auth/me").status_code, 200)
        self.c.post("/api/ops/controls", json={"ai_paused": False})
        self.deps.new_client()
        log = open(os.path.join(os.environ["ARYA_DATA_DIR"], "ops-changes.jsonl")).read().splitlines()
        self.assertEqual(json.loads(log[0])["set"], {"ai_paused": True})

    def test_demo_live_off_only_stops_the_demo(self):
        from fastapi import HTTPException
        from api import state
        os.environ["ARYA_OWNER_USERNAME"] = "kim@test.arya"
        self._login("kim@test.arya")
        self.c.post("/api/ops/controls", json={"demo_live": False})
        self.deps._budget_guard()                       # a real account still reads
        with self.assertRaises(HTTPException):
            self.deps._budget_guard(demo=True)

    def test_photo_reader_override_beats_the_environment(self):
        from api.decode import service
        os.environ["ARYA_OWNER_USERNAME"] = "kim@test.arya"
        os.environ["ARYA_PHOTO_READER"] = "wonder"
        try:
            self.assertEqual(service.photo_reader(), "wonder")
            self._login("kim@test.arya")
            self.assertEqual(self.c.post("/api/ops/controls", json={"photo_reader": "spark"}).status_code, 200)
            self.assertEqual(service.photo_reader(), "standard")
            self.c.post("/api/ops/controls", json={"photo_reader": None})
            self.assertEqual(service.photo_reader(), "wonder")
            self.assertEqual(self.c.post("/api/ops/controls", json={"photo_reader": "x"}).status_code, 400)
            self.assertEqual(self.c.post("/api/ops/controls", json={}).status_code, 400)
        finally:
            os.environ.pop("ARYA_PHOTO_READER", None)


if __name__ == "__main__":
    unittest.main()
