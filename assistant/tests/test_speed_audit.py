"""Speed and feel audit (2026-10-31): Today's one aggregate read, the
per-request ledger memo, and the in-memory session check."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ.pop("MODEL_API_KEY", None)
from fastapi.testclient import TestClient  # noqa: E402

TODAY_PARTS = {"home", "settings", "news", "dashboard", "insights", "powers",
               "quest_receipts", "review", "curator", "profile"}


class TestSpeedAudit(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        assert self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"}).status_code == 200

    def test_today_answers_every_part_in_one_read(self):
        r = self.c.get("/api/today")
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual(set(d), TODAY_PARTS)
        for k in TODAY_PARTS:
            self.assertIsNotNone(d[k], k)
        # The same answers the separate routes give.
        self.assertEqual(d["home"], self.c.get("/api/home").json())
        self.assertEqual(d["settings"], self.c.get("/api/settings").json())

    def test_today_needs_login(self):
        self.c.post("/auth/logout")
        self.assertEqual(TestClient(self.c.app).get("/api/today").status_code, 401)

    def test_ledger_built_once_per_request(self):
        from unittest import mock
        from api import state
        calls = []
        real = state._derived
        with mock.patch.object(state, "_derived", side_effect=lambda: calls.append(1) or real()):
            self.assertEqual(self.c.get("/api/today").status_code, 200)
        # home, insights and the rest share one build.
        self.assertEqual(len(calls), 1)

    def test_a_write_clears_the_memo(self):
        from api import state
        state.start_request_memo()
        try:
            state.set_current_user("t@x.y")
            first = state.derived()
            self.assertFalse(first["smart_list"]["items"])
            state.set_flag("manual-milk", {"manual": True, "name": "Milk"})
            names = [i["name"] for i in state.derived()["smart_list"]["items"]]
            self.assertIn("Milk", names)
            # Each caller gets its own copy.
            a, b = state.derived(), state.derived()
            a["smart_list"]["items"].clear()
            self.assertTrue(b["smart_list"]["items"])
        finally:
            state._memo.set(None)
            state.set_current_user(None)

    def test_memo_copies_are_deep_and_fall_back(self):
        # re-audit N6: pickle copies, deepcopy when pickle cannot.
        from api import state
        v = {"a": [{"b": 1}]}
        c = state._clone(v)
        c["a"][0]["b"] = 2
        self.assertEqual(v["a"][0]["b"], 1)
        odd = {"f": lambda: 1}
        self.assertIs(state._clone(odd)["f"], odd["f"])

    def test_tick_round_trips_off_the_event_loop(self):
        self.c.post("/api/list/add", json={"name": "Milk"})
        iid = next(i["item_id"] for i in self.c.get("/api/home").json()["list"]["items"] if i["name"] == "Milk")
        self.assertEqual(self.c.post("/api/list/check", json={"item_id": iid, "checked": True}).status_code, 200)
        it = next(i for i in self.c.get("/api/home").json()["list"]["items"] if i["item_id"] == iid)
        self.assertTrue(it.get("checked"))

    def test_session_cache_sees_logout(self):
        from api import auth
        tok = self.c.cookies.get(auth.COOKIE)
        self.assertEqual(auth.session_info(tok)["user"], "t@x.y")
        self.assertEqual(auth.session_info(tok)["user"], "t@x.y")  # the cached copy
        self.c.post("/auth/logout")
        self.assertIsNone(auth.session_info(tok))


if __name__ == "__main__":
    unittest.main()
