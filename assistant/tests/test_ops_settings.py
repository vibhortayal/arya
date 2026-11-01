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


class TestOpsData(TestOpsAccounts):
    def test_delete_needs_typed_name_saves_a_copy(self):
        from api import state
        with state.as_user("kim@test.arya"):
            state._save("receipts.json", [{"id": 1}, {"id": 2}])
        post = lambda b: self.c.post("/api/ops/delete", json=b)
        self.assertEqual(post({"user": "kim@test.arya", "what": "receipts", "confirm": "nope"}).status_code, 400)
        self.assertEqual(post({"user": "kim@test.arya", "what": "bogus", "confirm": "kim@test.arya"}).status_code, 400)
        r = post({"user": "kim@test.arya", "what": "receipts", "confirm": "kim@test.arya"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["removed"], 2)
        with state.as_user("kim@test.arya"):
            self.assertEqual(state._load("receipts.json", None), [])
        d = os.path.join(state.base_dir(), "ops-deleted")
        self.assertEqual(len(os.listdir(d)), 1)
        self.assertEqual(json.load(open(os.path.join(d, os.listdir(d)[0]))), [{"id": 1}, {"id": 2}])
        self.assertEqual(post({"user": "kim@test.arya", "what": "names", "confirm": "kim@test.arya"}).status_code, 200)

    def test_mirror_needs_a_database_and_owner(self):
        os.environ.pop("DATABASE_URL", None)
        self.assertEqual(self.c.post("/api/ops/mirror", json={"kind": "verify"}).status_code, 400)
        self.assertEqual(self.c.get("/api/ops/mirror").json()["configured"], False)
        self.login("kim@test.arya", "pw-123456")
        self.assertEqual(self.c.post("/api/ops/mirror", json={"kind": "verify"}).status_code, 403)
        self.assertEqual(self.c.post("/api/ops/delete", json={}).status_code, 403)


class TestMirrorJob(unittest.TestCase):
    def test_backfill_then_verify_with_a_fake_database(self):
        import time as _t
        from unittest import mock
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["DATABASE_URL"] = "postgres://x"
        os.environ["ARYA_STORE"] = "dual"
        try:
            from api import ops_data, pgstore, state
            state.write_json_atomic(os.path.join(state.base_dir(), "users", "kim", "lists.json"), {"a": 1})
            db = {}
            with mock.patch.object(pgstore, "write", lambda o, n, obj: db.__setitem__((o, n), obj)), \
                 mock.patch.object(pgstore, "read", lambda o, n: db.get((o, n), pgstore._MISSING)):
                self.assertTrue(ops_data.start("verify"))
                while ops_data.job()["state"] == "running":
                    _t.sleep(0.01)
                self.assertFalse(ops_data.job()["ok"])
                self.assertTrue(ops_data.start("backfill"))
                while ops_data.job()["state"] == "running":
                    _t.sleep(0.01)
                self.assertTrue(ops_data.job()["ok"], ops_data.job())
                ops_data.start("verify")
                while ops_data.job()["state"] == "running":
                    _t.sleep(0.01)
                self.assertTrue(ops_data.job()["ok"])
                self.assertIn("1 of 1 match", ops_data.job()["result"])
        finally:
            os.environ.pop("DATABASE_URL", None)
            os.environ.pop("ARYA_STORE", None)
