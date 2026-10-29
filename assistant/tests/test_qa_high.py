"""QA pass 2026-10-28, High findings: typed quantities land, the
prepared cart names hand-added items, and a hunt survives a demo
sandbox reset."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

from tests.frontend import src  # noqa: E402


class TestTypedQuantity(unittest.TestCase):
    def test_piece_qty(self):
        from api.list.intake import piece_qty, split_list_items
        self.assertEqual(piece_qty("eggs x 2"), 2)
        self.assertEqual(piece_qty("oat milk ×3"), 3)
        self.assertEqual(piece_qty("2 x eggs"), 2)
        self.assertEqual(piece_qty("eggs"), 1)
        self.assertEqual(split_list_items("eggs x 2, oat milk x 3, pears"),
                         [("eggs", 2), ("oat milk", 3), ("pears", 1)])

    def test_cart_names_and_quantities(self):
        prev = os.environ.get("ARYA_DATA_DIR")
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        self.addCleanup(lambda: os.environ.__setitem__("ARYA_DATA_DIR", prev)
                        if prev else os.environ.pop("ARYA_DATA_DIR", None))
        from api import main
        from api import deps
        deps._login_fails.clear()
        c = TestClient(main.app)
        r = c.post("/auth/setup", json={"username": "t@x.y",
                                        "password": "long-password"})
        self.assertEqual(r.status_code, 200, r.text)
        r = c.post("/api/list/from-text",
                   json={"text": "eggs x 2\noat milk x 3"})
        self.assertEqual(r.status_code, 200, r.text)
        items = {i["name"]: i["qty"]
                 for i in c.get("/api/home").json()["list"]["items"]}
        self.assertEqual(items.get("eggs"), 2)
        self.assertEqual(items.get("oat milk"), 3)
        cart = c.get("/api/home").json()["cart"]
        names = {i["name"]: i["qty"] for i in cart["items"]}
        self.assertEqual(names.get("oat milk"), 3)
        self.assertFalse(any(n.startswith("manual-") for n in names))


class TestHuntSurvivesReset(unittest.TestCase):
    def test_client_rebuilds_a_lost_session(self):
        js = src("screens/hunt/model.ts")
        self.assertIn("export async function qRevive(sess: Session)", js)
        body = js.split("export async function qSetState(")[1].split("\n}")[0]
        self.assertIn("await qRevive(sess);", body)
        self.assertIn("Q_GONE", body)
        check = js.split("export async function qCheck(")[1].split("\n}")[0]
        self.assertIn("qSessionGone(e)", check)
        self.assertIn("await qRevive(sess);", check)
