"""Scripts run from files only (codebase map 2026-10-29). The Caddy CSP
refuses every inline script; the app (web/, React) has none. These
tests stop inline scripts or inline event handlers from creeping
back."""
import base64, hashlib, os, re, unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PWA = os.path.join(ROOT, "pwa")  # the static folder
WEB = os.path.join(ROOT, "web")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class TestCsp(unittest.TestCase):
    def csp(self):
        return re.search(r'Content-Security-Policy "([^"]+)"',
                         read("deploy", "Caddyfile")).group(1)

    def test_no_unsafe_inline_script(self):
        script = re.search(r"script-src ([^;]+)", self.csp()).group(1)
        self.assertNotIn("unsafe-inline", script)
        self.assertNotIn("unsafe-eval", script)

    def test_no_inline_script_and_csp_allows_none(self):
        html = read("web", "index.html")
        tags = re.findall(r"<script\b([^>]*)>(.*?)</script>", html, re.S)
        self.assertTrue(tags)
        for attrs, body in tags:
            self.assertIn("src=", attrs)
            self.assertEqual(body.strip(), "", "put new code in a file")
        script = re.search(r"script-src ([^;]+)", self.csp()).group(1)
        self.assertEqual(script.strip(), "'self'")

    def test_no_inline_event_handlers(self):
        pages = [os.path.join(WEB, "index.html")] + [
            os.path.join(PWA, n) for n in os.listdir(PWA) if n.endswith((".js", ".html"))]
        for path in pages:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
            self.assertIsNone(re.search(r"<[a-zA-Z][^<>]*\son[a-z]+\s*=\s*[\"']", text),
                              f"inline on...= handler in {path}")
        # React sets handlers as properties; raw HTML it injects (the
        # icon SVGs) must not carry one either.
        for root, _, files in os.walk(os.path.join(WEB, "src")):
            for n in files:
                if n.endswith((".ts", ".tsx")):
                    with open(os.path.join(root, n), encoding="utf-8") as fh:
                        self.assertNotRegex(fh.read(), r"\son[a-z]+=\\?[\"']", n)

    def test_auth_callback_loads_a_file(self):
        from fastapi.testclient import TestClient
        from api.main import app
        html = TestClient(app).get("/auth/callback").text
        self.assertIn('<script src="/auth-callback.js"></script>', html)
        self.assertNotRegex(html, r"<script>")
        self.assertTrue(os.path.isfile(os.path.join(PWA, "auth-callback.js")))


class TestDemoSessionsInMemory(unittest.TestCase):
    def setUp(self):
        import tempfile
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import auth
        self.auth = auth

    def test_demo_session_never_written(self):
        tok = self.auth.new_session("demo", demo=True)
        self.assertEqual(self.auth._load("sessions.json", {}), {})
        self.assertEqual(self.auth.session_info(tok), {"user": "demo", "demo": True})
        self.auth.drop_session(tok)
        self.assertIsNone(self.auth.session_info(tok))

    def test_demo_sessions_are_capped(self):
        old = self.auth.DEMO_SESSIONS_MAX
        self.auth.DEMO_SESSIONS_MAX = 3
        try:
            toks = [self.auth.new_session("demo", demo=True) for _ in range(5)]
            self.assertIsNone(self.auth.session_info(toks[0]))
            self.assertIsNotNone(self.auth.session_info(toks[-1]))
        finally:
            self.auth.DEMO_SESSIONS_MAX = old


class TestHealthAndBuckets(unittest.TestCase):
    def test_health_is_liveness_only(self):
        from fastapi.testclient import TestClient
        from api.main import app
        self.assertEqual(TestClient(app).get("/health").json(),
                         {"status": "ok", "service": "arya-api", "stage": 3})

    def test_rate_buckets_drop_idle_ips(self):
        import time
        from api import deps as main
        old = main.RATE_BUCKET_MAX
        main.RATE_BUCKET_MAX = 2
        try:
            b = {"a": [time.time() - 5000], "b": [time.time() - 5000], "c": [time.time()]}
            main._prune(b, 900)
            self.assertEqual(list(b), ["c"])
        finally:
            main.RATE_BUCKET_MAX = old


if __name__ == "__main__":
    unittest.main()
