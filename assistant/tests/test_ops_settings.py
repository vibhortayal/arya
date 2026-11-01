"""Ops settings (2026-11-01): limits, caps and model choices set from the
Ops screen beat the environment, stay inside safe ranges, are per-account
where asked, and are logged."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient


class TestOpsSettings(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import state, site_flags
        state.set_current_user(None)
        site_flags._cache["at"] = 0.0
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/setup", json={"username": "owner-a", "password": "correct horse"})
        from api import auth
        auth.create_user("kim@test.arya", "pw-123456")
        os.environ["ARYA_OWNER_USERNAME"] = "owner-a"
        self.c.post("/auth/login", json={"username": "owner-a", "password": "correct horse"})

    def tearDown(self):
        from api import state
        state.set_current_user(None)
        for k in ("ARYA_OWNER_USERNAME", "ARYA_USER_HOURLY_FREEZE_USD", "ARYA_SPARK_TIER"):
            os.environ.pop(k, None)

    def post(self, body):
        return self.c.post("/api/ops/controls", json=body)

    def test_default_then_env_then_ops(self):
        from api import settings
        self.assertEqual(settings.get("hourly_freeze_usd"), 1.0)
        os.environ["ARYA_USER_HOURLY_FREEZE_USD"] = "2"
        self.assertEqual(settings.get("hourly_freeze_usd"), 2.0)
        self.assertEqual(self.post({"settings": {"hourly_freeze_usd": 3}}).status_code, 200)
        self.assertEqual(settings.get("hourly_freeze_usd"), 3.0)
        self.post({"settings": {"hourly_freeze_usd": None}})
        self.assertEqual(settings.get("hourly_freeze_usd"), 2.0)

    def test_out_of_range_is_refused(self):
        for bad in (0, 0.01, 51, "x", True):
            self.assertEqual(self.post({"settings": {"hourly_freeze_usd": bad}}).status_code, 400, bad)
        self.assertEqual(self.post({"settings": {"nope": 1}}).status_code, 400)

    def test_override_for_one_account_only(self):
        from api import settings
        r = self.post({"overrides": {"kim@test.arya": {"hourly_freeze_usd": 10}}}); self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(settings.get("hourly_freeze_usd", "KIM@test.arya"), 10.0)
        self.assertEqual(settings.get("hourly_freeze_usd", "other@x"), 1.0)
        self.assertEqual(self.post({"overrides": {"ghost@x": {"hourly_freeze_usd": 5}}}).status_code, 400)
        self.assertEqual(self.post({"overrides": {"kim@test.arya": {"daily_budget_usd": 5}}}).status_code, 400)

    def test_limits_drive_the_guards(self):
        from api import deps
        self.post({"settings": {"monthly_ceiling_usd": 7}, "overrides": {"kim@test.arya": {"monthly_ceiling_usd": 20}}})
        self.assertEqual(deps.user_limits()[1], 7.0)
        self.assertEqual(deps.user_limits("kim@test.arya")[1], 20.0)

    def test_spark_tier_reasoning_open_model_and_log(self):
        from api import meta_client, site_flags
        self.assertEqual(self.post({"spark_tier": "standard", "reasoning_effort": "high", "open_model": " m-1 "}).status_code, 200)
        self.assertEqual(meta_client.spark_tier(), "standard")
        self.assertEqual(site_flags.reasoning_effort(), "high")
        self.assertEqual(site_flags.open_model(), "m-1")
        self.assertEqual(self.post({"spark_tier": "bogus"}).status_code, 400)
        d = self.c.get("/api/ops").json()
        self.assertEqual(d["controls"]["spark_tier"], "standard")
        self.assertEqual(d["settings"]["hourly_freeze_usd"]["default"], 1.0)
        self.assertEqual(d["changes"][0]["user"], "owner-a")

    def test_meta_says_box(self):
        self.assertEqual(self.post({"meta_says": 190.5}).status_code, 200)
        self.assertEqual(self.c.get("/api/ops").json()["meta_says"]["usd"], 190.5)
        self.assertEqual(self.post({"meta_says": -1}).status_code, 400)

    def test_only_owner(self):
        self.c.post("/auth/logout")
        self.c.post("/auth/login", json={"username": "kim@test.arya", "password": "pw-123456"})
        self.assertEqual(self.post({"settings": {"hourly_freeze_usd": 5}}).status_code, 403)


if __name__ == "__main__":
    unittest.main()


class TestOpsAccounts(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import state, site_flags
        state.set_current_user(None)
        site_flags._cache["at"] = 0.0
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/setup", json={"username": "owner-a", "password": "correct horse"})
        from api import auth
        auth.create_user("kim@test.arya", "pw-123456")
        os.environ["ARYA_OWNER_USERNAME"] = "owner-a"
        self.c.post("/auth/login", json={"username": "owner-a", "password": "correct horse"})

    def tearDown(self):
        from api import state
        state.set_current_user(None)
        os.environ.pop("ARYA_OWNER_USERNAME", None)

    def login(self, u, p):
        self.c.post("/auth/logout")
        return self.c.post("/auth/login", json={"username": u, "password": p})

    def test_switch_an_account_off_and_on(self):
        names = [a["user"] for a in self.c.get("/api/ops/accounts").json()["accounts"]]
        self.assertIn("kim@test.arya", names)
        self.assertEqual(self.c.post("/api/ops/accounts", json={"user": "owner-a", "disabled": True}).status_code, 400)
        self.assertEqual(self.c.post("/api/ops/accounts", json={"user": "kim@test.arya", "disabled": True}).status_code, 200)
        self.login("kim@test.arya", "pw-123456")
        self.assertEqual(self.c.get("/api/usage").status_code, 403)
        self.login("owner-a", "correct horse")
        self.c.post("/api/ops/accounts", json={"user": "kim@test.arya", "disabled": False})
        self.login("kim@test.arya", "pw-123456")
        self.assertNotEqual(self.c.get("/api/usage").status_code, 403)

    def test_owner_change_needs_password_and_can_be_undone(self):
        post = lambda b: self.c.post("/api/ops/owner", json=b)
        self.assertEqual(post({"username": "ghost@x", "password": "correct horse"}).status_code, 400)
        self.assertEqual(post({"username": "kim@test.arya", "password": "wrong"}).status_code, 403)
        self.assertEqual(post({"username": "kim@test.arya", "password": "correct horse"}).status_code, 200)
        self.login("kim@test.arya", "pw-123456")
        self.assertEqual(self.c.get("/api/ops").status_code, 200)
        self.login("owner-a", "correct horse")
        self.assertEqual(self.c.get("/api/ops").status_code, 200)

    def test_old_owner_loses_rights_after_a_day(self):
        from api import site_flags
        self.c.post("/api/ops/owner", json={"username": "kim@test.arya", "password": "correct horse"})
        site_flags.set_nested("owner", "at", 1)
        os.environ["ARYA_OWNER_USERNAME"] = "someone-else"
        self.login("owner-a", "correct horse")
        self.assertEqual(self.c.get("/api/ops").status_code, 403)
        self.login("kim@test.arya", "pw-123456")
        self.assertEqual(self.c.get("/api/ops").status_code, 200)
