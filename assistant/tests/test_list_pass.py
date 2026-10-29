"""List pass — review 2026-10-28, M9/U1/U2.

/api/home ships price_by_store for the list items, so the List
view paints with no per-item requests; the All lens carries no
per-store tags; the store filter is one scrolling row; Ask and
Eyes have real empty states instead of blanks.
"""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
from fastapi.testclient import TestClient  # noqa: E402

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        return json.dumps({"verdicts": []}), {}, 0.0


def seed_receipt(c, merchant, date, lines, rid):
    body = {"merchant": merchant, "purchased_at": date, "receipt_id": rid,
            "lines": [{"decoded_name": n, "sku": sku, "line_total": amt,
                       "qty": 1, "confidence": 0.95}
                      for n, sku, amt in lines],
            "subtotal": sum(a for _, _, a in lines), "tax": 0,
            "total": sum(a for _, _, a in lines)}
    r = c.post("/api/intake/structured", json=body)
    assert r.status_code == 200, r.text


class TestHomePriceByStore(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        main.MetaClient = FakeClient
        main._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={
            "username": "t@x.y", "password": "long-password"})
        assert r.status_code == 200, r.text
        for d in ("2026-09-05", "2026-09-26", "2026-10-17"):
            seed_receipt(self.c, "Costco", d,
                         [("KS Almonds", "1001", 12.99),
                          ("Organic Eggs", "1002", 8.49)], f"r-{d}")
        seed_receipt(self.c, "Trader Joe's", "2026-10-20",
                     [("Organic Eggs", "1002", 6.99),
                      ("Mandarins", "1003", 4.49)], "r-tj")

    def test_home_ships_price_by_store_for_list_items_only(self):
        self.c.post("/api/list/add", json={"item_id": "costco-1002"})
        home = self.c.get("/api/home").json()
        pbs = home["price_by_store"]
        self.assertEqual(sorted(pbs["costco-1002"]),
                         ["Costco", "Trader Joe's"])
        self.assertEqual(pbs["costco-1002"]["Costco"]["count"], 3)
        self.assertEqual(pbs["costco-1002"]["Costco"]["median"], 8.49)
        self.assertEqual(pbs["costco-1002"]["Trader Joe's"]["count"], 1)
        # Not on the list -> not shipped.
        self.assertNotIn("costco-1003", pbs)
        self.assertNotIn("costco-1001", pbs)


class TestListClientPins(unittest.TestCase):
    def test_no_per_item_requests_for_the_list(self):
        js = read("app.js")
        # One /api/home call paints the list and its named lists.
        render = js.split("async function renderList()")[1].split("\n}\n")[0]
        self.assertNotIn("/api/items/", render)
        self.assertEqual(render.count("api("), 1)

    def test_loading_state_and_list_rows(self):
        js = read("app.js")
        self.assertIn('empty("Loading your list…")', js)
        self.assertIn("groceries.map(listRow)", js)

    def test_ask_and_eyes_empty_states(self):
        js = read("app.js")
        self.assertIn("paintChatEmpty", js)
        self.assertIn("What's running low?", js)
        self.assertIn("chat-empty", js)
        # Eyes on the List page (owner wireframe, 2026-10-28): the
        # section renders only while a sighting is pending.
        self.assertIn("wrap.hidden = !pending", js)
        self.assertNotIn("No sightings yet.", js)
        self.assertIn("#chat-form input { flex: 1; min-width: 0;",
                      read("styles.css"))


if __name__ == "__main__":
    unittest.main()
