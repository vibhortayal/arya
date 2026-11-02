from tests.conftest import one_list
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient


class TypedItemPageTest(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/setup", json={"username": "typist", "password": "correct horse"})
        one_list(self.c)

    def test_typed_item_has_a_page_not_a_404(self):
        self.c.post("/api/list/from-text", json={"text": "eggs x 2"})
        d = self.c.get("/api/items/manual-eggs")
        self.assertEqual(d.status_code, 200)
        self.assertEqual(d.json()["entry"]["canonical_name"], "eggs")

    def test_unknown_item_is_still_404(self):
        self.assertEqual(self.c.get("/api/items/manual-nothing").status_code, 404)


if __name__ == "__main__":
    unittest.main()
