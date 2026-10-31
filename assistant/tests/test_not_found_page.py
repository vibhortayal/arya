"""An unknown address shows a page with a way home, not raw JSON
(retest 2026-10-31 #12). API paths and non-browser clients keep JSON."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ.setdefault("ARYA_DATA_DIR", tempfile.mkdtemp())
from fastapi.testclient import TestClient  # noqa: E402

from api.main import app  # noqa: E402


class TestNotFoundPage(unittest.TestCase):
    def setUp(self):
        self.c = TestClient(app)

    def test_browser_gets_a_page_with_a_way_home(self):
        r = self.c.get("/this-page-does-not-exist", headers={"accept": "text/html"})
        self.assertEqual(r.status_code, 404)
        self.assertIn('href="/"', r.text)

    def test_other_clients_keep_json(self):
        r = self.c.get("/this-page-does-not-exist")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json(), {"detail": "Not Found"})


if __name__ == "__main__":
    unittest.main()
