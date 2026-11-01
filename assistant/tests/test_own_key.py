"""Use my own Meta key (BYOK, owner 2026-11-01; Fable review numbers in
brackets). The key is encrypted in its own per-user file, never echoed,
skips only the app's dollar caps, and a key Meta refuses fails the read
with no fallback to the app's key."""
import json, os, tempfile, unittest
from unittest import mock

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient

KEY = "LLM_123456789|abcdefghijklmnopqrstuvwxyz0123456789WXYZ"
USER = "kim@test.arya"


class OwnKeyCase(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        self.env = mock.patch.dict(os.environ, {"ARYA_KEY_VAULT_SECRET": "s3cret-for-tests",
                                                "MODEL_API_KEY": "app-key",
                                                "ARYA_USER_HOURLY_FREEZE_USD": "1000"})
        self.env.start()
        from api import deps, own_key, state
        state.set_current_user(None)
        own_key._user_hits.clear()
        own_key._ip_hits.clear()
        deps._verify_hits.clear()   # the shared per-IP sign-in code throttles
        deps._code_hits.clear()
        for b in (own_key._start_ip, own_key._start_email, own_key._create_ip):
            b.clear()
        from api import meta_client
        self._mc = deps.MetaClient
        deps.MetaClient = meta_client.MetaClient  # other test files leave a fake here
        self.deps = deps
        self._ledger = deps._LEDGER
        deps._LEDGER = os.path.join(tempfile.mkdtemp(), "ledger.jsonl")
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/setup", json={"username": "owner-a", "password": "correct horse"})
        from api import auth
        auth.create_user(USER, "pw-123456")
        self.c.post("/auth/logout")
        r = self.c.post("/auth/login", json={"username": USER, "password": "pw-123456"})
        self.assertEqual(r.status_code, 200, r.text)

    def tearDown(self):
        from api import state
        state.set_current_user(None)
        self.deps._LEDGER = self._ledger
        self.deps.MetaClient = self._mc
        self.env.stop()

    def save(self, ok=True, key=KEY):
        with mock.patch("api.own_key.check", return_value=ok):
            return self.c.put("/api/account/own-key", json={"key": key})

    def key_file(self):
        from api import state
        return os.path.join(state.user_dir(USER), "own_key.json")


class TestSwitches(OwnKeyCase):
    def test_off_without_the_vault_secret(self):
        for env in ({"ARYA_KEY_VAULT_SECRET": ""},):
            with mock.patch.dict(os.environ, env):
                self.assertEqual(self.c.get("/api/account/own-key").json(),
                                 {"available": False, "set": False, "ends": None, "status": None,
                                  "required": False})
                self.assertEqual(self.save().status_code, 503)  # fails closed [5]
        self.assertFalse(os.path.exists(self.key_file()))

    def test_the_demo_cannot_have_a_key(self):  # [2]
        from api import own_key, state
        with state.as_user(state.DEMO_USER):
            self.assertFalse(own_key.available())
            self.assertIsNone(own_key.for_current_user())


class TestSaving(OwnKeyCase):
    def test_save_shows_only_the_last_four_and_encrypts(self):  # [1][3][9]
        r = self.save()
        self.assertEqual(r.json(), {"saved": True, "ends": "WXYZ"})
        self.assertEqual(self.c.get("/api/account/own-key").json(),
                         {"available": True, "set": True, "ends": "WXYZ", "status": "ok",
                          "required": False})
        raw = open(self.key_file()).read()
        self.assertNotIn(KEY, raw)
        self.assertNotIn("123456789", raw)
        self.assertNotIn(KEY, self.c.get("/api/account/export").text)
        self.assertNotIn("own_key", self.c.get("/api/account/export").text)

    def test_not_a_meta_key_is_refused_without_echo(self):  # [3]
        for bad in ("sk-ant-secretthing", "LLM_", "LLM_" + "x" * 300, "LLM_has space"):
            r = self.save(key=bad)
            self.assertEqual(r.status_code, 400, bad)
            self.assertNotIn(bad[4:12] or "x", r.text if len(bad) > 4 else "")
        self.assertFalse(os.path.exists(self.key_file()))

    def test_a_key_meta_rejects_is_not_stored(self):
        r = self.save(ok=False)
        self.assertEqual(r.status_code, 422)
        self.assertFalse(os.path.exists(self.key_file()))
        self.assertNotIn(KEY, r.text)

    def test_tries_are_rate_limited(self):  # [4]
        codes = [self.save(ok=False).status_code for _ in range(6)]
        self.assertEqual(codes, [422] * 5 + [429])

    def test_remove_and_account_delete_drop_the_file(self):  # [1]
        self.save()
        self.assertEqual(self.c.delete("/api/account/own-key").json(), {"removed": True})
        self.assertFalse(os.path.exists(self.key_file()))
        self.save()
        from api import auth
        auth.delete_user(USER)
        self.assertFalse(os.path.exists(self.key_file()))


class TestUsingTheKey(OwnKeyCase):
    def test_new_client_uses_the_key_and_the_own_key_bucket(self):  # [10][14]
        self.save()
        from api import deps, state
        with state.as_user(USER):
            c = deps.new_client()
        self.assertEqual((c.api_key, c.own_user, c.ledger.bucket, c.ledger.user),
                         (KEY, USER, "own_key", USER))
        with state.as_user("owner-a"):
            self.assertEqual(deps.new_client().api_key, "app-key")  # no leak across users

    def test_own_key_skips_the_daily_cap_but_not_the_pause_switch(self):  # [13]
        with mock.patch.dict(os.environ, {"ARYA_DAILY_BUDGET_USD": "0"}):
            r = self.c.post("/decode/text", json={"text": "x"})
            self.assertEqual(r.status_code, 503)
            self.assertEqual(r.headers.get("X-Arya-Offer"), "own-key")  # the cap offers it
            self.save()
            from api import deps, state, site_flags
            with state.as_user(USER):
                deps._budget_guard()  # no raise: their own money
                with mock.patch.object(site_flags, "ai_paused", return_value=True):
                    with self.assertRaises(Exception):
                        deps._budget_guard()

    def test_no_offer_without_the_vault(self):
        with mock.patch.dict(os.environ, {"ARYA_DAILY_BUDGET_USD": "0", "ARYA_KEY_VAULT_SECRET": ""}):
            r = self.c.post("/decode/text", json={"text": "x"})
        self.assertEqual(r.status_code, 503)
        self.assertIsNone(r.headers.get("X-Arya-Offer"))

    def test_own_key_spend_is_counted_apart(self):  # [14]
        from api.cost_ledger import CostLedger
        CostLedger(self.deps._LEDGER, bucket="own_key", user=USER).record("standard", "m", cost_usd=2.0)
        CostLedger(self.deps._LEDGER, bucket="app", user=USER).record("standard", "m", cost_usd=0.5)
        u = self.c.get("/api/usage").json()
        self.assertEqual((u["month_usd"], u["own_key_month_usd"]), (0.5, 2.0))
        self.assertEqual(CostLedger(self.deps._LEDGER).spent_today("app"), 0.5)


def answering(status, payload):
    seen = {}

    def t(method, url, headers, body):
        seen["auth"] = headers.get("Authorization")
        return status, payload(headers) if callable(payload) else payload
    return t, seen


class TestFailures(OwnKeyCase):
    def client(self, status, payload):
        from api.meta_client import MetaClient
        t, seen = answering(status, payload)
        return MetaClient(api_key=KEY, transport=t, own_user=USER), seen

    def status(self):
        from api import own_key
        return own_key.status(USER)["status"]

    def test_rejected_key_fails_the_read_and_needs_attention(self):  # [17][18]
        self.save()
        from api import own_key
        c, seen = self.client(401, lambda h: {"error": "bad token " + h["Authorization"]})
        with self.assertRaises(own_key.OwnKeyFailed) as e:
            c.chat([{"role": "user", "content": "hi"}])
        self.assertNotIn(KEY, str(e.exception))
        self.assertEqual(self.status(), "needs_attention")
        self.assertEqual(seen["auth"], "Bearer " + KEY)  # one call, no app-key retry
        from api import deps, state
        with state.as_user(USER):
            self.assertEqual(deps.new_client().api_key, "app-key")  # next read: the normal path

    def test_out_of_credit_is_a_key_failure(self):
        self.save()
        from api import own_key
        c, _ = self.client(402, {"error": "insufficient credit"})
        with self.assertRaises(own_key.OwnKeyFailed):
            c.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(self.status(), "needs_attention")

    def test_rate_limits_and_server_errors_are_not_the_key(self):
        self.save()
        with mock.patch("api.meta_client.MAX_RETRIES", 0):
            for code in (429, 500, 503):
                c, _ = self.client(code, {"error": "busy"})
                with self.assertRaises(RuntimeError):
                    c.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(self.status(), "ok")

    def test_a_wonder_403_is_model_access_not_the_key(self):  # [20]
        self.save()
        c, _ = self.client(403, {"error": "model not available in your region"})
        with self.assertRaises(RuntimeError):
            c.chat([{"role": "user", "content": "hi"}], mode="wonder")
        self.assertEqual(self.status(), "ok")

    def test_the_key_is_scrubbed_from_every_error(self):  # [7]
        self.save()
        with mock.patch("api.meta_client.MAX_RETRIES", 0):
            c, _ = self.client(500, lambda h: {"error": "echo " + h["Authorization"]})
            with self.assertRaises(RuntimeError) as e:
                c.chat([{"role": "user", "content": "hi"}])
        self.assertNotIn(KEY, str(e.exception))
        self.assertIn("[key]", str(e.exception))

    def test_a_failed_read_carries_the_fix_offer(self):
        self.save()
        from api import own_key

        class Failing:
            def __init__(self, **kw):
                pass

            def chat(self, *a, **k):
                raise own_key.OwnKeyFailed()

        with mock.patch.object(self.deps, "MetaClient", Failing):
            r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json()["detail"], own_key.FAILED_MSG)
        self.assertEqual(r.headers.get("X-Arya-Offer"), "own-key-fix")

    def test_a_receipt_job_pauses_on_a_failed_key(self):  # [19]
        self.save()
        from fastapi import HTTPException
        from api import own_key, receiptjobs, state
        with state.as_user(USER), \
                mock.patch("api.decode.service.decode_photo", side_effect=own_key.OwnKeyFailed()), \
                mock.patch.object(self.deps, "MetaClient", lambda **kw: object()):
            with self.assertRaises(HTTPException) as e:
                receiptjobs.file_one(b"img", "image/jpeg")
        self.assertEqual(e.exception.status_code, 503)
        self.assertIn(e.exception.status_code, receiptjobs.SYSTEMIC)


class TestCheckCall(unittest.TestCase):
    def test_check_is_one_small_spark_call(self):
        from api import own_key
        seen = []

        def t(method, url, headers, body):
            seen.append(body)
            return 200, {"choices": [{"message": {"content": "ok"}}]}
        self.assertTrue(own_key.check(KEY, transport=t))
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0]["model"], "muse-spark-1.3")
        self.assertFalse(own_key.check(KEY, transport=lambda *a: (401, {"error": "bad"})))
        with self.assertRaises(RuntimeError):
            own_key.check(KEY, transport=lambda *a: (503, {"error": "busy"}))


class TestKeyLimits(OwnKeyCase):
    def test_one_key_backs_at_most_three_accounts(self):  # review 2, 3
        from api import auth, own_key
        for n in range(3):
            auth.create_user(f"u{n}@test.arya", "pw-123456")
            own_key.save(f"u{n}@test.arya", KEY)
        r = self.save()
        self.assertEqual(r.status_code, 409)
        self.assertFalse(os.path.exists(self.key_file()))

    def test_hourly_load_guard_still_fires_on_an_own_key(self):  # review 2, 6
        self.save()
        from api.cost_ledger import CostLedger
        CostLedger(self.deps._LEDGER, bucket="own_key", user=USER).record("sam", "m", cost_usd=6.0)
        from fastapi import HTTPException
        from api import state
        with state.as_user(USER):
            with self.assertRaises(HTTPException) as e:
                self.deps._budget_guard()
        self.assertEqual(e.exception.status_code, 429)


class SignupCase(OwnKeyCase):
    EMAIL = "new@test.arya"

    def setUp(self):
        super().setUp()
        from api import own_key
        for b in (own_key._start_ip, own_key._start_email, own_key._create_ip):
            b.clear()
        self.sent = []
        self.patches = [mock.patch("api.supabase_auth.configured", return_value=True),
                        mock.patch("api.supabase_auth.send_code", side_effect=self.sent.append),
                        mock.patch("api.supabase_auth.verify_code",
                                   side_effect=lambda e, c: e if c == "123456" else (_ for _ in ()).throw(
                                       __import__("api.supabase_auth", fromlist=["x"]).AuthError("bad")))]
        for p in self.patches:
            p.start()
        self.c.post("/auth/logout")

    def tearDown(self):
        for p in self.patches:
            p.stop()
        super().tearDown()

    def start(self, ok=True, **body):
        b = {"email": self.EMAIL, "key": KEY, "accept": True, **body}
        with mock.patch("api.own_key.check", return_value=ok):
            return self.c.post("/auth/own-key/start", json=b)

    def verify(self, code="123456"):
        return self.c.post("/auth/own-key/verify", json={"email": self.EMAIL, "code": code})


class TestSignup(SignupCase):
    def test_door_shows_on_status(self):
        self.assertTrue(self.c.get("/auth/status").json()["own_key_signup"])
        with mock.patch.dict(os.environ, {"ARYA_KEY_VAULT_SECRET": ""}):
            self.assertFalse(self.c.get("/auth/status").json()["own_key_signup"])

    def test_key_then_code_makes_an_own_key_account(self):
        r = self.start()
        self.assertEqual(r.json(), {"sent": True, "ends": "WXYZ"})
        self.assertEqual(self.sent, [self.EMAIL])
        from api import auth, own_key
        self.assertNotIn(self.EMAIL, auth.users())  # no account from a key alone [1]
        self.assertEqual(self.verify("000000").status_code, 401)
        r = self.verify()
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["user"], self.EMAIL)
        self.assertEqual(auth.users()[self.EMAIL]["key_mode"], "own")
        self.assertEqual(own_key.status(self.EMAIL)["ends"], "WXYZ")
        g = self.c.get("/api/account/own-key").json()
        self.assertEqual((g["set"], g["required"]), (True, True))
        self.assertEqual(os.listdir(own_key._pending_dir()), [])

    def test_a_rejected_key_sends_no_email(self):
        self.assertEqual(self.start(ok=False).status_code, 422)
        self.assertEqual(self.sent, [])
        self.assertEqual(self.verify().status_code, 410)

    def test_refusals(self):
        self.assertEqual(self.start(accept=False).status_code, 400)
        self.assertEqual(self.start(key="sk-other").status_code, 400)
        self.assertEqual(self.start(email=USER).status_code, 409)  # has an account
        self.assertEqual(self.sent, [])

    def test_throttled_per_ip(self):  # review 2, 2
        codes = [self.start(email=f"a{n}@test.arya").status_code for n in range(4)]
        self.assertEqual(codes, [200, 200, 200, 429])

    def test_ops_switch_and_daily_cap_close_the_door(self):  # review 2, 2 and 4
        from api import own_key
        own_key.set_door(False)
        self.assertEqual(self.start().status_code, 503)
        self.assertFalse(self.c.get("/auth/status").json()["own_key_signup"])
        own_key.set_door(True)
        with mock.patch.dict(os.environ, {"ARYA_OWN_KEY_SIGNUPS_PER_DAY": "1"}):
            own_key.count_signup()
            self.assertEqual(self.start().status_code, 503)

    def test_the_demo_cap_links_to_the_door(self):  # owner 2026-11-01
        from fastapi import HTTPException
        from api import state
        with state.as_user(state.DEMO_USER), \
                mock.patch.dict(os.environ, {"ARYA_DEMO_DAILY_BUDGET_USD": "0.5"}), \
                mock.patch("api.cost_ledger.CostLedger.spent_today", return_value=9.0), \
                mock.patch("api.site_flags.demo_live", return_value=True):
            with self.assertRaises(HTTPException) as e:
                self.deps._budget_guard(demo=True)
        self.assertEqual(e.exception.headers, {"X-Arya-Offer": "own-key-signup"})

    def test_held_keys_expire(self):
        self.start()
        from api import own_key
        own_key.sweep_pending(now=__import__("time").time() + 16 * 60)
        self.assertEqual(self.verify().status_code, 410)


class TestOwnKeyAccountNeverFallsBack(SignupCase):
    def setUp(self):
        super().setUp()
        self.start()
        self.verify()

    def test_no_key_means_402_never_the_app_key(self):  # review 2, 5 and 8
        from fastapi import HTTPException
        from api import own_key, state
        self.assertEqual(self.c.delete("/api/account/own-key").json(), {"removed": True})
        with state.as_user(self.EMAIL):
            self.assertFalse(own_key.model_ready())
            for fn in (self.deps.new_client, self.deps._budget_guard):
                with self.assertRaises(HTTPException) as e:
                    fn()
                self.assertEqual(e.exception.status_code, 402)
        r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 402)
        self.assertEqual(r.headers.get("X-Arya-Offer"), "own-key-fix")
        self.assertEqual(self.c.get("/api/lists").status_code, 200)  # lists keep working
        from api import auth
        self.assertEqual(auth.users()[self.EMAIL]["key_mode"], "own")  # removing keeps the mode

    def test_a_rejected_key_stays_off_the_app_key(self):
        from api import own_key, state
        own_key.mark_needs_attention(self.EMAIL)
        from fastapi import HTTPException
        with state.as_user(self.EMAIL):
            with self.assertRaises(HTTPException) as e:
                self.deps.new_client()
        self.assertEqual(e.exception.status_code, 402)

    def test_saving_a_key_resumes_paused_receipt_jobs(self):
        from api import own_key, receiptjobs, state
        with state.as_user(self.EMAIL), mock.patch.object(receiptjobs, "resume_job") as rj, \
                mock.patch.object(receiptjobs, "_load", return_value={"jobs": [{"id": "j1", "status": "paused"},
                                                                             {"id": "j2", "status": "ready"}]}):
            own_key.save(self.EMAIL, KEY)
        rj.assert_called_once_with("j1")

    def test_no_second_seat_and_capped_store_lookups(self):  # review 2, 7
        with mock.patch("api.open_client.OpenClient") as oc, \
                mock.patch("api.state.judgments", return_value={"x": {"class": "STAPLE"}}):
            oc.return_value.api_key = "baseten"
            r = self.c.post("/api/judge/second-seat")
        self.assertEqual(r.json().get("provisioned"), False)
        from api import places
        with mock.patch.object(places, "provisioned", return_value=True), \
                mock.patch.object(places, "autocomplete", return_value=[]) as ac, \
                mock.patch.dict(os.environ, {"ARYA_PLACES_DAILY_LOOKUPS": "5"}):
            for _ in range(7):
                self.c.get("/api/stores/places?q=costco")
        self.assertEqual(ac.call_count, 5)


if __name__ == "__main__":
    unittest.main()
