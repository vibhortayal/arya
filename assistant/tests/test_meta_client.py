import unittest
import os
from unittest import mock
import api.meta_client as mc
from api.meta_client import MetaClient, estimate_cost


def fake_transport(capture):
    def t(method, url, headers, body):
        capture.update(method=method, url=url, headers=headers, body=body)
        return 200, {"choices": [{"message": {"content": "{}"}}],
                     "usage": {"prompt_tokens": 1000, "completion_tokens": 200,
                               "prompt_tokens_details": {"cached_tokens": 400}}}
    return t


class TestMetaClient(unittest.TestCase):
    def test_request_shape_and_mode_mapping(self):
        cap = {}
        c = MetaClient(api_key="test-key", transport=fake_transport(cap))
        text, usage, cost = c.chat([{"role": "user", "content": "hi"}], mode="standard", personal=True)
        self.assertTrue(cap["url"].endswith("/v1/chat/completions"))
        self.assertEqual(cap["headers"]["Authorization"], "Bearer test-key")
        # Spark runs on Standard by default (live confirmed 2026-11-01).
        self.assertEqual(cap["body"]["model"], "muse-spark-1.3")
        self.assertEqual(cap["body"]["reasoning_effort"], "low")
        self.assertEqual(usage["cached_tokens"], 400)
        self.assertAlmostEqual(cost, estimate_cost("standard", 1000, 400, 200), places=9)

    def test_spark_tier_contributor_switch(self):
        cap = {}
        with mock.patch.dict(os.environ, {"ARYA_SPARK_TIER": "contributor"}):
            c = MetaClient(api_key="k", transport=fake_transport(cap))
            _t, _u, cost = c.chat([{"role": "user", "content": "hi"}], mode="standard", personal=True)
        self.assertEqual(cap["body"]["model"], "muse-spark-1.3-contributor")
        self.assertAlmostEqual(cost, estimate_cost("contributor", 1000, 400, 200), places=9)

    def test_wonder_ignores_spark_tier(self):
        cap = {}
        c = MetaClient(api_key="k", transport=fake_transport(cap))
        c.chat([], mode="wonder", personal=True)
        self.assertEqual(cap["body"]["model"], "muse-wonder-1.0")

    def test_gate_waits_then_fails_fast(self):
        now = [0.0]
        slept = []
        g = mc._RateGate(limit=2, window=60, max_wait=20,
                         clock=lambda: now[0], sleep=slept.append)
        g.acquire(); g.acquire()
        now[0] = 45.0
        g.acquire()                       # waits 15 s for the oldest slot
        self.assertEqual(slept, [15.0])
        g = mc._RateGate(limit=1, window=60, max_wait=5,
                         clock=lambda: now[0], sleep=slept.append)
        g.acquire()
        now[0] += 1
        with self.assertRaises(RuntimeError):
            g.acquire()                   # next slot is 59 s away > max_wait

    def test_personal_contributor_refused(self):
        c = MetaClient(api_key="k", transport=fake_transport({}))
        with self.assertRaises(ValueError):
            c.chat([], mode="contributor", personal=True)

    def test_wonder_shape_no_reasoning_effort(self):
        # Wonder's production configuration (WONDER-EVAL): the
        # reasoning_effort key is not sent at all.
        cap = {}
        c = MetaClient(api_key="test-key", transport=fake_transport(cap))
        text, usage, cost = c.chat([{"role": "user", "content": "hi"}],
                                   mode="wonder", personal=True,
                                   reasoning_effort=None, timeout=90)
        self.assertEqual(cap["body"]["model"], "muse-wonder-1.0")
        self.assertNotIn("reasoning_effort", cap["body"])
        self.assertAlmostEqual(cost, estimate_cost("wonder", 1000, 400, 200), places=9)

    def test_timeout_reaches_urlopen(self):
        import io, json as _json, urllib.request
        from unittest import mock
        import api.meta_client as mc

        class Resp:
            status = 200

            def read(self):
                return _json.dumps(
                    {"choices": [{"message": {"content": "{}"}}],
                     "usage": {"prompt_tokens": 1, "completion_tokens": 1}}).encode()

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        seen = {}

        def fake_urlopen(req, timeout=None):
            seen["timeout"] = timeout
            return Resp()

        c = MetaClient(api_key="k")
        with mock.patch.object(urllib.request, "urlopen", fake_urlopen):
            c.chat([{"role": "user", "content": "hi"}], timeout=90)
            self.assertEqual(seen["timeout"], 90)
            c.chat([{"role": "user", "content": "hi"}])
            self.assertEqual(seen["timeout"], 120)  # unchanged default

    def test_generate_image_shape_and_cost(self):
        import base64
        cap = {}
        def t(method, url, headers, body):
            cap.update(method=method, url=url, headers=headers, body=body)
            return 200, {"data": [{"b64_json": base64.b64encode(b"WEBPDATA").decode()}],
                         "usage": {"images_generated": 1}}
        c = MetaClient(api_key="<redacted>", transport=t)
        img, usage, cost = c.generate_image("a mascot")
        self.assertTrue(cap["url"].endswith("/v1/images/generations"))
        self.assertEqual(cap["body"]["model"], "muse-image-1.0")
        self.assertEqual(cap["body"]["prompt"], "a mascot")
        self.assertEqual(img, b"WEBPDATA")
        self.assertEqual(usage, {"images_generated": 1})
        self.assertAlmostEqual(cost, 0.01, places=9)

    def test_gateway_html_error_is_runtime_error(self):
        # A 502 from the gateway carries an HTML page, not JSON
        # (review H3): the caller must see RuntimeError, and the
        # HTTP code must survive in the message.
        def t(method, url, headers, body):
            return 502, "<html><title>Bad Gateway</title></html>"
        c = MetaClient(api_key="k", transport=t)
        with self.assertRaises(RuntimeError) as cm:
            c.chat([{"role": "user", "content": "hi"}])
        self.assertIn("502", str(cm.exception))

    def test_transport_timeout_is_runtime_error(self):
        import urllib.error
        def t(method, url, headers, body):
            raise TimeoutError("timed out")
        c = MetaClient(api_key="k", transport=t)
        with self.assertRaises(RuntimeError):
            c.chat([{"role": "user", "content": "hi"}])
        def t2(method, url, headers, body):
            raise urllib.error.URLError("connection reset")
        c2 = MetaClient(api_key="k", transport=t2)
        with self.assertRaises(RuntimeError):
            c2.transcribe(b"wav", 3.0)

    def test_unexpected_200_shape_is_runtime_error(self):
        def t(method, url, headers, body):
            return 200, {"status": "ok"}  # no choices at all
        c = MetaClient(api_key="k", transport=t)
        with self.assertRaises(RuntimeError):
            c.chat([{"role": "user", "content": "hi"}])

    def test_urlopen_html_error_page_is_runtime_error(self):
        # The real transport: an HTTPError whose body is a gateway
        # HTML page must not raise JSONDecodeError out of _send.
        import io, urllib.error, urllib.request
        from unittest import mock

        def fake_urlopen(req, timeout=None):
            raise urllib.error.HTTPError(
                req.full_url, 504, "Gateway Timeout", {},
                io.BytesIO(b"<html>gateway timeout</html>"))

        c = MetaClient(api_key="k")
        with mock.patch.object(urllib.request, "urlopen", fake_urlopen):
            with self.assertRaises(RuntimeError) as cm:
                c.chat([{"role": "user", "content": "hi"}])
        self.assertIn("504", str(cm.exception))

    def test_urlopen_timeout_is_runtime_error(self):
        import urllib.error, urllib.request
        from unittest import mock

        def fake_urlopen(req, timeout=None):
            raise urllib.error.URLError("timed out")

        c = MetaClient(api_key="k")
        with mock.patch.object(urllib.request, "urlopen", fake_urlopen):
            with self.assertRaises(RuntimeError):
                c.chat([{"role": "user", "content": "hi"}])

    def test_cost_math(self):
        self.assertAlmostEqual(estimate_cost("standard", 1_000_000), 1.25, places=6)
        self.assertAlmostEqual(estimate_cost("standard", 1_000_000, cached_tokens=1_000_000), 0.15, places=6)
        self.assertAlmostEqual(estimate_cost("contributor", 1_000_000, output_tokens=1_000_000), 0.30, places=6)
        self.assertAlmostEqual(estimate_cost("wonder", 0, output_tokens=1_000_000), 20.00, places=6)


class TestRouteErrorMapping(unittest.TestCase):
    """A Meta failure inside a route answers 502, never a bare 500."""

    def test_photo_decode_timeout_is_502(self):
        from api import deps
        import os, tempfile
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["ARYA_INSECURE_COOKIE"] = "1"
        os.environ["MODEL_API_KEY"] = "test-key"
        from fastapi.testclient import TestClient
        import api.main as main

        class WrappingClient:
            """Routes build MetaClient directly; this stand-in runs
            the real client's error mapping over a transport that
            times out, so the route sees the mapped RuntimeError."""

            def __init__(self, *a, **k):
                self._inner = MetaClient(
                    api_key="k",
                    transport=lambda *a: (_ for _ in ()).throw(
                        TimeoutError("timed out")))

            def chat(self, messages, **kw):
                return self._inner.chat(messages, **kw)

        deps.MetaClient = WrappingClient
        try:
            c = TestClient(main.app)
            c.post("/auth/setup", json={"username": "t@example.com",
                                        "password": "pw-test"})
            r = c.post("/decode/photo", content=b"\xff\xd8\xff fake",
                       headers={"Content-Type": "image/jpeg"})
            self.assertEqual(r.status_code, 502, r.text)
        finally:
            deps.MetaClient = MetaClient


if __name__ == "__main__":
    unittest.main()


class TestStructuredAndRetry(unittest.TestCase):
    def setUp(self):
        import api.meta_client as mc
        self.mc = mc
        self._sleep = mc.time.sleep
        mc.time.sleep = lambda s: None

    def tearDown(self):
        self.mc.time.sleep = self._sleep

    def test_schema_and_cache_key_in_body(self):
        cap = {}
        c = MetaClient(api_key="k", transport=fake_transport(cap))
        c.chat([{"role": "user", "content": "x"}], schema=("S", {"type": "object"}),
               cache_key="arya-test")
        self.assertEqual(cap["body"]["prompt_cache_key"], "arya-test")
        rf = cap["body"]["response_format"]
        self.assertEqual(rf["type"], "json_schema")
        self.assertEqual(rf["json_schema"]["name"], "S")

    def test_schema_refused_falls_back_without_it(self):
        bodies = []

        def t(method, url, headers, body):
            bodies.append(dict(body))
            if "response_format" in body:
                return 400, {"error": "unsupported response_format"}
            return 200, {"choices": [{"message": {"content": "{}"}}], "usage": {}}
        c = MetaClient(api_key="k", transport=t)
        c.chat([], schema=("S", {}))
        self.assertEqual(len(bodies), 2)
        self.assertNotIn("response_format", bodies[1])

    def test_retries_429_then_succeeds(self):
        calls = []

        def t(method, url, headers, body):
            calls.append(1)
            if len(calls) < 3:
                return 429, {"error": "slow down"}
            return 200, {"choices": [{"message": {"content": "ok"}}], "usage": {}}
        c = MetaClient(api_key="k", transport=t)
        text, _u, _c = c.chat([])
        self.assertEqual((text, len(calls)), ("ok", 3))

    def test_gives_up_after_bounded_retries(self):
        calls = []

        def t(method, url, headers, body):
            calls.append(1)
            return 503, {"error": "overloaded"}
        c = MetaClient(api_key="k", transport=t)
        with self.assertRaises(RuntimeError):
            c.chat([])
        self.assertEqual(len(calls), self.mc.MAX_RETRIES + 1)

    def test_other_4xx_not_retried(self):
        calls = []

        def t(method, url, headers, body):
            calls.append(1)
            return 401, {"error": "bad key"}
        c = MetaClient(api_key="k", transport=t)
        with self.assertRaises(RuntimeError):
            c.chat([])
        self.assertEqual(len(calls), 1)
