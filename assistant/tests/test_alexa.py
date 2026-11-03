"""Alexa skill behind ARYA_ALEXA (owner, 2026-11-03): off means 404
everywhere; account linking (authorization code); Amazon's request
checks; adds that resolve at once, adds Spark reads in the background,
and the unclear ones kept for a look in the app."""
import base64, datetime, json, os, tempfile, unittest
from urllib.parse import parse_qs, urlparse

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

from tests.test_ask_in_list import seed_owner  # noqa: E402

REDIRECT = "https://pitangui.amazon.com/api/skill/link/TESTVENDOR"
ENV = {"ARYA_ALEXA": "1", "ARYA_ALEXA_CLIENT_ID": "alexa-client",
       "ARYA_ALEXA_CLIENT_SECRET": "s3cret", "ARYA_ALEXA_SKILL_ID": "amzn1.ask.skill.test",
       "ARYA_ALEXA_REDIRECTS": REDIRECT + ",https://layla.amazon.com/api/skill/link/TESTVENDOR",
       "ARYA_ALEXA_SYNC_JOBS": "1"}


class Spark:
    """Stands in for the Meta client in the background job."""
    answer = None
    fail = False
    calls = 0

    def __init__(self, *a, **k):
        pass

    def chat(self, messages, **k):
        Spark.calls += 1
        if Spark.fail:
            raise RuntimeError("model down")
        return json.dumps(Spark.answer), {}, 0.001


def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class AlexaBase(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        seed_owner(base)
        for k, v in ENV.items():
            os.environ[k] = v
        from api import main, deps, alexa_verify, alexa_brain
        from api.routes import alexa as routes
        deps.MetaClient = Spark
        deps._login_fails.clear()
        alexa_brain._model_hits.clear()
        routes._seen.clear()
        Spark.answer, Spark.fail, Spark.calls = None, False, 0
        self._verify = alexa_verify.verify
        alexa_verify.verify = lambda headers, body, now=None: None
        self.app = main.app
        self.c = TestClient(main.app)
        assert self.c.post("/auth/setup", json={"username": "owner", "password": "pw"}).status_code == 200
        self.n = 0

    def tearDown(self):
        from api import alexa_verify
        alexa_verify.verify = self._verify
        for k in ENV:
            os.environ.pop(k, None)

    # account linking, end to end
    def link(self):
        r = self.c.get("/alexa/authorize", params={
            "client_id": "alexa-client", "redirect_uri": REDIRECT, "state": "xyz",
            "response_type": "code", "scope": "lists"}, follow_redirects=False)
        self.assertEqual(r.status_code, 200, r.text)
        link = r.text.split('name="link" value="')[1].split('"')[0]
        r = self.c.post("/alexa/authorize", data={"link": link, "decision": "allow"},
                        follow_redirects=False)
        self.assertEqual(r.status_code, 302, r.text)
        q = parse_qs(urlparse(r.headers["location"]).query)
        self.assertEqual(q["state"], ["xyz"])
        r = TestClient(self.app).post("/alexa/token", data={
            "grant_type": "authorization_code", "code": q["code"][0], "redirect_uri": REDIRECT,
            "client_id": "alexa-client", "client_secret": "s3cret"})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def say(self, intent=None, slots=None, token=None, kind="IntentRequest", attrs=None, rid=None):
        self.n += 1
        req = {"type": kind, "requestId": rid or f"req-{self.n}", "timestamp": _now()}
        if intent:
            req["intent"] = {"name": intent, "slots": {k: {"name": k, "value": v} for k, v in (slots or {}).items()}}
        body = {"version": "1.0",
                "session": {"application": {"applicationId": "amzn1.ask.skill.test"},
                            "attributes": attrs or {}},
                "context": {"System": {"application": {"applicationId": "amzn1.ask.skill.test"},
                                       "user": {"accessToken": token} if token else {}}},
                "request": req}
        r = TestClient(self.app).post("/alexa/skill", content=json.dumps(body),
                                      headers={"SignatureCertChainUrl": "x", "Signature-256": "x"})
        return r

    def speech(self, r):
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["response"]["outputSpeech"]["text"]

    def rows(self):
        return {i["name"]: i for i in self.c.get("/api/home").json()["list"]["items"]}


class TestFlagOff(AlexaBase):
    def test_everything_is_404_with_the_flag_off(self):
        os.environ.pop("ARYA_ALEXA")
        for method, path in [("get", "/alexa/authorize"), ("get", "/alexa/authorize/resume"),
                             ("post", "/alexa/authorize"), ("post", "/alexa/token"),
                             ("post", "/alexa/skill"), ("get", "/api/alexa/review"),
                             ("post", "/api/alexa/review/abc/confirm")]:
            r = getattr(self.c, method)(path)
            self.assertEqual(r.status_code, 404, (path, r.text))


class TestLinking(AlexaBase):
    def test_link_gives_tokens_and_refresh_works(self):
        tok = self.link()
        self.assertEqual(tok["token_type"], "bearer")
        self.assertEqual(tok["expires_in"], 3600)
        basic = base64.b64encode(b"alexa-client:s3cret").decode()
        r = TestClient(self.app).post("/alexa/token", data={
            "grant_type": "refresh_token", "refresh_token": tok["refresh_token"]},
            headers={"Authorization": "Basic " + basic})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotEqual(r.json()["access_token"], tok["access_token"])
        self.assertEqual(r.headers["cache-control"], "no-store")

    def test_a_code_works_once_and_needs_the_secret(self):
        r = self.c.get("/alexa/authorize", params={
            "client_id": "alexa-client", "redirect_uri": REDIRECT, "state": "s",
            "response_type": "code"})
        link = r.text.split('name="link" value="')[1].split('"')[0]
        r = self.c.post("/alexa/authorize", data={"link": link, "decision": "allow"}, follow_redirects=False)
        code = parse_qs(urlparse(r.headers["location"]).query)["code"][0]
        t = TestClient(self.app)
        bad = t.post("/alexa/token", data={"grant_type": "authorization_code", "code": code,
                                           "client_id": "alexa-client", "client_secret": "nope"})
        self.assertEqual(bad.status_code, 401)
        ok = t.post("/alexa/token", data={"grant_type": "authorization_code", "code": code,
                                          "client_id": "alexa-client", "client_secret": "s3cret"})
        self.assertEqual(ok.status_code, 200)
        again = t.post("/alexa/token", data={"grant_type": "authorization_code", "code": code,
                                             "client_id": "alexa-client", "client_secret": "s3cret"})
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.json()["error"], "invalid_grant")

    def test_unknown_redirect_or_client_never_redirects(self):
        for params in [{"redirect_uri": "https://evil.example/cb"}, {"client_id": "other"},
                       {"response_type": "token"}]:
            q = {"client_id": "alexa-client", "redirect_uri": REDIRECT, "state": "s",
                 "response_type": "code", **params}
            r = self.c.get("/alexa/authorize", params=q, follow_redirects=False)
            self.assertEqual(r.status_code, 400, params)
            self.assertIn("expired", r.text)

    def test_cancel_returns_access_denied(self):
        r = self.c.get("/alexa/authorize", params={
            "client_id": "alexa-client", "redirect_uri": REDIRECT, "state": "s", "response_type": "code"})
        link = r.text.split('name="link" value="')[1].split('"')[0]
        r = self.c.post("/alexa/authorize", data={"link": link, "decision": "cancel"}, follow_redirects=False)
        q = parse_qs(urlparse(r.headers["location"]).query)
        self.assertEqual(q["error"], ["access_denied"])
        self.assertNotIn("code", q)

    def test_signed_out_goes_to_sign_in_and_comes_back(self):
        fresh = TestClient(self.app)
        r = fresh.get("/alexa/authorize", params={
            "client_id": "alexa-client", "redirect_uri": REDIRECT, "state": "s", "response_type": "code"},
            follow_redirects=False)
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers["location"], "/?alexa=1")
        self.assertIn("arya_alexa_link", r.headers["set-cookie"])
        cookie = r.cookies.get("arya_alexa_link")
        assert fresh.post("/auth/login", json={"username": "owner", "password": "pw"}).status_code == 200
        fresh.cookies.set("arya_alexa_link", cookie, path="/alexa")
        r = fresh.get("/alexa/authorize/resume")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Allow", r.text)
        self.assertIn("owner", r.text)

    def test_the_demo_cannot_link(self):
        demo = TestClient(self.app)
        r = demo.post("/auth/demo")
        if r.status_code != 200:
            self.skipTest("no demo door in this build")
        r = demo.get("/alexa/authorize", params={
            "client_id": "alexa-client", "redirect_uri": REDIRECT, "state": "s", "response_type": "code"})
        self.assertEqual(r.status_code, 403)
        self.assertIn("not the demo", r.text)

    def test_deleting_the_account_unlinks(self):
        tok = self.link()
        from api import alexa_link, auth
        self.assertEqual(alexa_link.user_for(tok["access_token"]), "owner")
        alexa_link.revoke("owner")
        self.assertIsNone(alexa_link.user_for(tok["access_token"]))
        self.assertIsNone(alexa_link.refresh(tok["refresh_token"]))
        self.assertTrue(hasattr(auth, "delete_user"))


class TestSkill(AlexaBase):
    def setUp(self):
        super().setUp()
        self.tok = self.link()["access_token"]

    def test_no_token_asks_to_link(self):
        r = self.say("AddItemIntent", {"item": "pasta"})
        self.assertEqual(r.json()["response"]["card"], {"type": "LinkAccount"})

    def test_wrong_skill_or_stale_time_is_refused(self):
        os.environ["ARYA_ALEXA_SKILL_ID"] = "amzn1.ask.skill.other"
        self.assertEqual(self.say("AddItemIntent", {"item": "pasta"}, self.tok).status_code, 400)
        os.environ["ARYA_ALEXA_SKILL_ID"] = "amzn1.ask.skill.test"
        from api import alexa_verify
        self.assertFalse(alexa_verify.fresh("2020-01-01T00:00:00Z"))

    def test_known_item_adds_now_and_says_so(self):
        text = self.speech(self.say("AddItemIntent", {"item": "pasta"}, self.tok))
        self.assertIn("Added", text)
        self.assertIn("Trader Joe's", text)
        self.assertEqual(Spark.calls, 0)

    def test_named_list_by_sound_adds_now(self):
        text = self.speech(self.say("AddItemIntent", {"item": "bananas", "list": "cost co"}, self.tok))
        self.assertIn("Added Bananas to Costco", text)
        self.assertEqual(self.rows()["Bananas"]["list"], "l-demo-costco")
        self.assertEqual(Spark.calls, 0)

    def test_two_lists_and_no_list_said_asks_then_adds(self):
        r = self.say("AddItemIntent", {"item": "bananas"}, self.tok)
        body = r.json()
        self.assertFalse(body["response"]["shouldEndSession"])
        self.assertIn("Which list", body["response"]["outputSpeech"]["text"])
        r = self.say("ListAnswerIntent", {"list": "trader joes"}, self.tok, attrs=body["sessionAttributes"])
        self.assertIn("Trader Joe's", self.speech(r))
        self.assertEqual(self.rows()["Bananas"]["list"], "l-demo-tj")

    def test_unclear_add_goes_to_spark_and_lands(self):
        Spark.answer = {"item": "naan", "list": "Costco", "sure": True}
        text = self.speech(self.say("AddItemIntent", {"item": "nan bread", "list": "cost so"}, self.tok))
        self.assertEqual(text, "Sent to Arya.")
        self.assertEqual(Spark.calls, 1)
        self.assertEqual(self.rows()["naan"]["list"], "l-demo-costco")
        self.assertEqual(self.c.get("/api/alexa/review").json()["items"], [])

    def test_spark_picks_only_real_lists_and_unsure_is_kept_for_review(self):
        Spark.answer = {"item": "naan", "list": "Walmart", "sure": True}
        self.speech(self.say("AddItemIntent", {"item": "nan", "list": "walmart"}, self.tok))
        self.assertIn("naan", self.rows())
        items = self.c.get("/api/alexa/review").json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["heard"], "nan")
        self.assertEqual(items[0]["kind"], "guess")

    def test_spark_down_adds_as_heard_and_keeps_it_for_review(self):
        Spark.fail = True
        text = self.speech(self.say("AddItemIntent", {"item": "dragon fruit", "list": "trader jos"}, self.tok))
        self.assertEqual(text, "Sent to Arya.")
        self.assertIn("dragon fruit", self.rows())
        row = self.c.get("/api/alexa/review").json()["items"][0]
        self.assertEqual(row["kind"], "unchecked")
        self.assertEqual(row["name"], "dragon fruit")

    def test_over_the_hourly_cap_skips_spark_but_still_adds(self):
        import time
        from api import alexa_brain
        os.environ["ARYA_ALEXA_MODEL_RATE"] = "1"
        alexa_brain._model_hits["owner"] = [time.time()]
        try:
            self.speech(self.say("AddItemIntent", {"item": "dragon fruit", "list": "costco"}, self.tok))
        finally:
            os.environ.pop("ARYA_ALEXA_MODEL_RATE")
        self.assertEqual(Spark.calls, 0)
        self.assertEqual(self.rows()["dragon fruit"]["list"], "l-demo-costco")

    def test_a_retry_adds_once(self):
        Spark.answer = {"item": "naan", "list": "Costco", "sure": True}
        a = self.say("AddItemIntent", {"item": "nan", "list": "costco"}, self.tok, rid="same")
        b = self.say("AddItemIntent", {"item": "nan", "list": "costco"}, self.tok, rid="same")
        self.assertEqual(a.json(), b.json())
        self.assertEqual(Spark.calls, 1)

    def test_launch_help_and_stop(self):
        self.assertIn("What should I add", self.speech(self.say(kind="LaunchRequest", token=self.tok)))
        self.assertIn("add milk", self.speech(self.say("AMAZON.HelpIntent", token=self.tok)))
        self.assertEqual(self.speech(self.say("AMAZON.StopIntent", token=self.tok)), "Okay.")

    def test_review_confirm_move_rename_remove(self):
        Spark.fail = True
        for item in ("dragon fruit", "star fruit", "jack fruit", "kiwano"):
            self.say("AddItemIntent", {"item": item, "list": "costco"}, self.tok)
        rows = {r["heard"]: r for r in self.c.get("/api/alexa/review").json()["items"]}
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows["kiwano"]["kind"], "unchecked")
        self.assertEqual(rows["kiwano"]["list_name"], "Costco")
        self.assertEqual(rows["kiwano"]["name"], "kiwano")
        ok = lambda rid, action, **b: self.c.post(f"/api/alexa/review/{rid}/{action}", json=b)
        r = ok(rows["dragon fruit"]["id"], "confirm")
        self.assertEqual(len(r.json()["items"]), 3)
        self.assertEqual(len(ok(rows["dragon fruit"]["id"], "reopen").json()["items"]), 4)
        self.assertEqual(ok(rows["dragon fruit"]["id"], "confirm").status_code, 200)
        self.assertEqual(ok(rows["star fruit"]["id"], "move", list_id="l-demo-tj").status_code, 200)
        self.assertEqual(ok(rows["star fruit"]["id"], "reopen").status_code, 404)  # only a confirm undoes
        self.assertEqual(ok(rows["jack fruit"]["id"], "rename", name="jackfruit").status_code, 200)
        self.assertEqual(ok(rows["kiwano"]["id"], "remove").status_code, 200)
        self.assertEqual(ok(rows["kiwano"]["id"], "remove").status_code, 404)
        self.assertEqual(ok(rows["dragon fruit"]["id"], "explode").status_code, 404)
        self.assertEqual(self.c.get("/api/alexa/review").json()["items"], [])
        names = self.rows()
        self.assertEqual(names["star fruit"]["list"], "l-demo-tj")
        self.assertIn("jackfruit", names)
        self.assertNotIn("kiwano", names)

    def test_rows_older_than_a_week_drop_off(self):
        Spark.fail = True
        self.say("AddItemIntent", {"item": "kiwano", "list": "costco"}, self.tok)
        from api import alexa_review, state
        with state.as_user("owner"):
            rows = state._load("alexa_review.json", [])
            rows[0]["at"] -= 8 * 86400
            state._save("alexa_review.json", rows)
        self.assertEqual(self.c.get("/api/alexa/review").json()["items"], [])

    def test_an_api_token_cannot_reach_review(self):
        h = {"Authorization": "Bearer " + self.c.post("/auth/token").json()["token"]}
        r = TestClient(self.app).get("/api/alexa/review", headers=h)
        self.assertEqual(r.status_code, 403)


class TestAmazonSignature(unittest.TestCase):
    """The real check, against a certificate authority made here."""

    def setUp(self):
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
        from cryptography.x509.verification import Store
        from api import alexa_verify
        now = datetime.datetime.now(datetime.timezone.utc)
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test Root")])
        ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
              .public_key(ca_key.public_key()).serial_number(1)
              .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=30))
              .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
              .add_extension(x509.KeyUsage(digital_signature=True, key_cert_sign=True, crl_sign=True,
                                           content_commitment=False, key_encipherment=False,
                                           data_encipherment=False, key_agreement=False,
                                           encipher_only=False, decipher_only=False), critical=True)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
              .sign(ca_key, hashes.SHA256()))

        def leaf(san):
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            cert = (x509.CertificateBuilder()
                    .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, san)]))
                    .issuer_name(ca_name).public_key(key.public_key()).serial_number(2)
                    .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=10))
                    .add_extension(x509.SubjectAlternativeName([x509.DNSName(san)]), critical=False)
                    .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                    .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
                    .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
                    .sign(ca_key, hashes.SHA256()))
            return key, cert.public_bytes(serialization.Encoding.PEM)

        self.key, good = leaf("echo-api.amazon.com")
        self.other_key, wrong = leaf("evil.example.com")
        self.pems = {"https://s3.amazonaws.com/echo.api/good.pem": good,
                     "https://s3.amazonaws.com/echo.api/wrong.pem": wrong}
        self._fetch, self._store = alexa_verify.fetch, alexa_verify.trust_store
        alexa_verify.fetch = lambda url: self.pems[url]
        alexa_verify.trust_store = lambda: Store([ca])
        alexa_verify._cache.clear()

    def tearDown(self):
        from api import alexa_verify
        alexa_verify.fetch, alexa_verify.trust_store = self._fetch, self._store
        alexa_verify._cache.clear()

    def sign(self, key, body):
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding
        return base64.b64encode(key.sign(body, padding.PKCS1v15(), hashes.SHA256())).decode()

    def check(self, url, sig, body):
        from api import alexa_verify
        alexa_verify.verify({"signaturecertchainurl": url, "signature-256": sig}, body)

    def test_amazon_signed_body_passes(self):
        body = b'{"request":{}}'
        self.check("https://s3.amazonaws.com/echo.api/good.pem", self.sign(self.key, body), body)

    def test_changed_body_wrong_cert_or_bad_url_fail(self):
        from api import alexa_verify
        body = b'{"request":{}}'
        with self.assertRaises(alexa_verify.Refused):
            self.check("https://s3.amazonaws.com/echo.api/good.pem", self.sign(self.key, body), body + b" ")
        with self.assertRaises(alexa_verify.Refused):
            self.check("https://s3.amazonaws.com/echo.api/wrong.pem", self.sign(self.other_key, body), body)
        with self.assertRaises(alexa_verify.Refused):
            self.check("", "", body)

    def test_certificate_url_rules(self):
        from api.alexa_verify import cert_url_ok
        self.assertTrue(cert_url_ok("https://s3.amazonaws.com/echo.api/echo-api-cert.pem"))
        self.assertTrue(cert_url_ok("HTTPS://s3.AmazonAWS.com/echo.api/../echo.api/echo-api-cert.pem"))
        self.assertTrue(cert_url_ok("https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem"))
        self.assertFalse(cert_url_ok("http://s3.amazonaws.com/echo.api/echo-api-cert.pem"))
        self.assertFalse(cert_url_ok("https://notamazon.com/echo.api/echo-api-cert.pem"))
        self.assertFalse(cert_url_ok("https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem"))
        self.assertFalse(cert_url_ok("https://s3.amazonaws.com/invalid.path/echo-api-cert.pem"))
        self.assertFalse(cert_url_ok("https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem"))
        self.assertFalse(cert_url_ok("https://s3.amazonaws.com/echo.api/../evil/cert.pem"))

    def test_timestamp_window(self):
        from api.alexa_verify import fresh
        import time
        self.assertTrue(fresh(_now()))
        old = datetime.datetime.fromtimestamp(time.time() - 200, datetime.timezone.utc)
        self.assertFalse(fresh(old.strftime("%Y-%m-%dT%H:%M:%SZ")))
        self.assertFalse(fresh("garbage"))


if __name__ == "__main__":
    unittest.main()
