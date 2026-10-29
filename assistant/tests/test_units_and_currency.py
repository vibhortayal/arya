"""Free-text units next to a quantity, and the per-account currency
(owner, 2026-10-29). No conversion and no exchange rates."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
from fastapi.testclient import TestClient  # noqa: E402

from api.list.intake import piece_qty_unit, split_list_items_units, split_list_items  # noqa: E402
from tests.test_list_pass import FakeClient  # noqa: E402


class TestParse(unittest.TestCase):
    def test_unit_forms(self):
        for text, want in (("milk 2 L", ("milk", 2, "L")),
                           ("2 kg rice", ("rice", 2, "kg")),
                           ("rice x 2 kg", ("rice", 2, "kg")),
                           ("eggs 1 dozen", ("eggs", 1, "dozen")),
                           ("eggs x 2", ("eggs", 2, "")),
                           ("2 x eggs", ("eggs", 2, "")),
                           ("eggs", ("eggs", 1, ""))):
            self.assertEqual(split_list_items_units(text), [want], text)

    def test_names_with_numbers_are_kept(self):
        self.assertEqual(split_list_items_units("2 percent milk"), [("2 percent milk", 1, "")])
        self.assertEqual(piece_qty_unit("7 up"), (1, ""))

    def test_pairs_api_is_unchanged(self):
        self.assertEqual(split_list_items("milk 2 L, eggs x 3"), [("milk", 2), ("eggs", 3)])


class TestRoutes(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})

    def items(self):
        return {i["name"]: i for i in self.c.get("/api/home").json()["list"]["items"]}

    def test_typed_unit_shows_on_the_row(self):
        self.c.post("/api/list/add", json={"name": "milk 2 L"})
        self.c.post("/api/list/from-text", json={"text": "rice x 1 kg"})
        it = self.items()
        self.assertEqual((it["milk"]["qty"], it["milk"]["unit"]), (2, "L"))
        self.assertEqual(it["rice"]["unit"], "kg")

    def test_qty_route_sets_and_clears_unit(self):
        iid = self.c.post("/api/list/add", json={"name": "oil"}).json()["item_id"]
        self.c.post("/api/list/qty", json={"item_id": iid, "qty": 3, "unit": "  bottles "})
        self.assertEqual(self.items()["oil"]["unit"], "bottles")
        self.c.post("/api/list/qty", json={"item_id": iid, "qty": 3, "unit": ""})
        self.assertNotIn("unit", self.items()["oil"])

    def test_currency_default_set_and_reject(self):
        self.assertEqual(self.c.get("/api/settings").json()["symbol"], "$")
        r = self.c.post("/api/settings", json={"currency": "inr"})
        self.assertEqual((r.status_code, r.json()["symbol"]), (200, "₹"))
        self.assertEqual(self.c.get("/api/settings").json()["currency"], "INR")
        self.assertEqual(self.c.post("/api/settings", json={"currency": "XXX"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
