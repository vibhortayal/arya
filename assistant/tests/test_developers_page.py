"""The public developer page: /developers answers the app shell with no
sign-in; the React app draws the page (web/src/screens/Developers.tsx)."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient  # noqa: E402


class TestDevelopersPage(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        self.main = main
        self.web = tempfile.mkdtemp()
        self.was = main._WEB
        main._WEB = self.web
        self.c = TestClient(main.app)

    def tearDown(self):
        self.main._WEB = self.was

    def test_serves_the_shell_without_signing_in(self):
        with open(os.path.join(self.web, "index.html"), "w") as fh:
            fh.write("<!doctype html><div id=root></div>")
        for path in ("/developers", "/developers/"):
            r = self.c.get(path, follow_redirects=True)
            assert r.status_code == 200, path
            assert 'id=root' in r.text
        assert r.headers["cache-control"] == "no-cache"

    def test_not_built_is_a_plain_404(self):
        assert self.c.get("/developers").status_code == 404


if __name__ == "__main__":
    unittest.main()
