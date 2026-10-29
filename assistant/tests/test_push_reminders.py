"""Push reminders: off by default, hidden and refused until the flag
and the VAPID keys exist; one push a day per account; one cycle is
announced once; dead phones are dropped; the demo never gets it."""
import os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"

SUB = {"endpoint": "https://push.example.com/abc", "keys": {"p256dh": "k", "auth": "a"}}


def read(name):
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", "pwa", name)) as fh:
        return fh.read()


class TestPush(unittest.TestCase):
    def setUp(self):
        from api import deps
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        for k in ("ARYA_PUSH_REMINDERS", "ARYA_VAPID_PUBLIC_KEY", "ARYA_VAPID_PRIVATE_KEY"):
            os.environ.pop(k, None)
        from fastapi.testclient import TestClient
        import api.main as main
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "alice@example.com", "password": "pw-alice"})
        assert r.status_code == 200, r.text

    def tearDown(self):
        for k in ("ARYA_PUSH_REMINDERS", "ARYA_VAPID_PUBLIC_KEY", "ARYA_VAPID_PRIVATE_KEY"):
            os.environ.pop(k, None)

    def flag_on(self):
        os.environ["ARYA_PUSH_REMINDERS"] = "1"
        os.environ["ARYA_VAPID_PUBLIC_KEY"] = "pub"
        os.environ["ARYA_VAPID_PRIVATE_KEY"] = "priv"

    def test_off_by_default(self):
        self.assertEqual(self.c.get("/api/push/config").json()["enabled"], False)
        for path, body in (("subscribe", {"subscription": SUB}), ("settings", {"notice_days": 3}),
                           ("unsubscribe", {}), ("test", {})):
            self.assertEqual(self.c.post("/api/push/" + path, json=body).status_code, 404, path)

    def test_flag_without_keys_stays_off(self):
        os.environ["ARYA_PUSH_REMINDERS"] = "1"
        self.assertFalse(self.c.get("/api/push/config").json()["enabled"])

    def test_login_required(self):
        from fastapi.testclient import TestClient
        import api.main as main
        self.assertEqual(TestClient(main.app).get("/api/push/config").status_code, 401)

    def test_subscribe_settings_test(self):
        self.flag_on()
        cfg = self.c.get("/api/push/config").json()
        self.assertTrue(cfg["enabled"])
        self.assertEqual((cfg["notice_days"], cfg["subscribed"]), (2, False))
        self.assertEqual(self.c.post("/api/push/test", json={}).status_code, 400)
        self.assertEqual(self.c.post("/api/push/subscribe", json={"subscription": {"endpoint": "http://x"}}).status_code, 400)
        self.assertTrue(self.c.post("/api/push/subscribe", json={"subscription": SUB}).json()["subscribed"])
        self.assertEqual(self.c.post("/api/push/settings", json={"notice_days": 5}).json()["notice_days"], 5)
        for bad in (0, 8, "x"):
            self.assertEqual(self.c.post("/api/push/settings", json={"notice_days": bad}).status_code, 400)
        self.assertFalse(self.c.post("/api/push/unsubscribe", json={"endpoint": SUB["endpoint"]}).json()["subscribed"])

    def test_private_key_never_returned(self):
        self.flag_on()
        self.assertNotIn("priv", self.c.get("/api/push/config").text)

    def test_demo_has_no_reminders(self):
        self.flag_on()
        from fastapi.testclient import TestClient
        import api.main as main
        d = TestClient(main.app)
        d.post("/auth/demo")
        self.assertFalse(d.get("/api/push/config").json()["enabled"])
        self.assertEqual(d.post("/api/push/subscribe", json={"subscription": SUB}).status_code, 403)

    def test_compose(self):
        from api import reminders as r
        one = r.compose([("Milk", 2, "m@1")])
        self.assertEqual(one["title"], "Milk is probably running out in 2 days")
        self.assertIn("running out", r.compose([("Milk", 0, "m")])["title"])
        self.assertNotIn(" in ", r.compose([("Milk", 0, "m")])["title"])
        self.assertEqual(r.compose([("Milk", 1, "m")])["title"], "Milk is probably running out in 1 day")
        many = r.compose([(n, 1, n) for n in ("Milk", "Eggs", "Bananas", "Rice")])
        self.assertEqual(many["title"], "4 things are about to run out")
        self.assertIn("and 1 more", many["body"])
        self.assertEqual(r.compose([], test=True)["url"], "/#list")

    def test_due_items_window(self):
        from api import reminders as r, state
        def p(i, n, gap, since, **kw):
            return dict(item_id=i, purchase_count=n, median_interval_days=gap, days_since_last=since,
                        due=since >= gap, admitted=True, last_bought="2026-10-20", **kw)
        pats = [p("milk", 5, 7, 5), p("eggs", 5, 7, 1), p("rice", 2, 30, 40), p("oat", 5, 7, 8),
                dict(p("ghee", 4, 30, 1), admitted=False)]
        saved = state.names
        state.names = lambda: {"milk": "Milk", "eggs": "Eggs", "oat": "Oats"}
        try:
            got = r.due_items(2, {"patterns": pats})
        finally:
            state.names = saved
        self.assertEqual([(n, l) for n, l, _ in got], [("Oats", 0), ("Milk", 2)])

    def test_daily_job(self):
        from api import reminders as r, state
        self.flag_on()
        sent = []
        sender = lambda sub, payload: sent.append(payload)
        state.set_current_user("alice@example.com")
        try:
            r.subscribe(SUB)
            items = [("Milk", 1, "milk@2026-10-20")]
            orig = r.due_items
            r.due_items = lambda n, d=None: items
            try:
                self.assertEqual(r.run_for_current_user("2026-10-29", sender), 1)
                self.assertEqual(r.run_for_current_user("2026-10-29", sender), 0, "one a day")
                self.assertEqual(r.run_for_current_user("2026-10-30", sender), 0, "same cycle, once")
                items.append(("Eggs", 0, "eggs@2026-10-15"))
                self.assertEqual(r.run_for_current_user("2026-10-31", sender), 1)
                self.assertEqual(sent[-1]["title"], "Eggs is probably running out")
            finally:
                r.due_items = orig
        finally:
            state.set_current_user(None)

    def test_dead_phone_dropped(self):
        from api import reminders as r, state
        class Gone(Exception):
            response = type("R", (), {"status_code": 410})()
        def boom(sub, payload):
            raise Gone()
        state.set_current_user("alice@example.com")
        try:
            r.subscribe(SUB)
            self.assertEqual(r.send({"title": "x"}, boom), 0)
            self.assertFalse(r.config()["subscribed"])
        finally:
            state.set_current_user(None)

    def test_client_wiring(self):
        self.assertIn("/push.js", read("sw.js"))
        self.assertIn('addEventListener("push"', read("sw.js"))
        self.assertIn('addEventListener("notificationclick"', read("sw.js"))
        self.assertIn("push.js", read("index.html"))
        html = read("index.html")
        self.assertIn('id="pf-reminders" hidden', html)
