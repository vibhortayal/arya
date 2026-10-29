"""Scripts run from files only (codebase map 2026-10-29). The Caddy CSP
refuses inline script except the one theme line in index.html, which
it allows by hash; these tests keep that hash in step and stop new
inline scripts or inline event handlers from creeping back."""
import base64, hashlib, os, re, unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PWA = os.path.join(ROOT, "pwa")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class TestCsp(unittest.TestCase):
    def csp(self):
        # The app's policy is the one carrying worker-src. The /p/*
        # concept-pages path has its own relaxed policy (inline
        # scripts in single-file mockups); it is pinned separately
        # below and must stay scoped to that handle.
        for policy in re.findall(r'Content-Security-Policy "([^"]+)"',
                                 read("deploy", "Caddyfile")):
            if "worker-src" in policy:
                return policy
        self.fail("app CSP not found in the Caddyfile")

    def test_pages_override_stays_scoped(self):
        text = read("deploy", "Caddyfile")
        self.assertIn("handle_path /p/*", text)
        relaxed = [p for p in re.findall(r'Content-Security-Policy "([^"]+)"', text)
                   if "worker-src" not in p]
        self.assertEqual(len(relaxed), 1, "exactly one scoped /p override")

    def test_no_unsafe_inline_script(self):
        script = re.search(r"script-src ([^;]+)", self.csp()).group(1)
        self.assertNotIn("unsafe-inline", script)
        self.assertNotIn("unsafe-eval", script)

    def test_inline_theme_script_hash_matches(self):
        inline = re.findall(r"<script>(.*?)</script>", read("pwa", "index.html"), re.S)
        self.assertEqual(len(inline), 1, "one inline script only; put new code in a file")
        digest = base64.b64encode(hashlib.sha256(inline[0].encode()).digest()).decode()
        self.assertIn(f"'sha256-{digest}'", self.csp())

    def test_no_inline_event_handlers(self):
        for name in os.listdir(PWA):
            if name.endswith((".js", ".html")):
                text = read("pwa", name)
                self.assertIsNone(re.search(r"<[a-zA-Z][^<>]*\son[a-z]+\s*=\s*[\"']", text),
                                  f"inline on...= handler in {name}")

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
