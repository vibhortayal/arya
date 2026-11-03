"""Long lists group by department (owner, 2026-10-30). The server tags
list items with their department; a household's own pick wins and is
remembered."""
from tests.conftest import one_list
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


def fresh(case):
    os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
    from api import main
    from api import deps
    deps._login_fails.clear()
    case.c = TestClient(main.app)
    r = case.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
    assert r.status_code == 200, r.text
    one_list(case.c)


def rows(c):
    return {i["name"]: i for i in c.get("/api/home").json()["list"]["items"]}


class TestListAisle(unittest.TestCase):
    def setUp(self):
        fresh(self)
        self.c.post("/api/list/from-text", json={"text": "Milk; Bananas; Zorblax gizmo"})

    def test_items_carry_their_department(self):
        r = rows(self.c)
        self.assertEqual(r["Milk"]["aisle"], "Dairy")
        self.assertEqual(r["Bananas"]["aisle"], "Produce")
        self.assertNotIn("aisle", r["Zorblax gizmo"])

    def test_household_pick_wins_and_can_be_cleared(self):
        mid = rows(self.c)["Milk"]["item_id"]
        self.assertEqual(self.c.post("/api/list/aisle", json={"item_id": mid, "aisle": "Pantry"}).status_code, 200)
        self.assertEqual(rows(self.c)["Milk"]["aisle"], "Pantry")
        self.c.post("/api/list/aisle", json={"item_id": mid, "aisle": "Other"})
        self.assertEqual(rows(self.c)["Milk"]["aisle"], "Other")
        self.c.post("/api/list/aisle", json={"item_id": mid, "aisle": None})
        self.assertEqual(rows(self.c)["Milk"]["aisle"], "Dairy")

    def test_rejects_unknown_department_and_missing_item(self):
        mid = rows(self.c)["Milk"]["item_id"]
        self.assertEqual(self.c.post("/api/list/aisle", json={"item_id": mid, "aisle": "Moon"}).status_code, 400)
        self.assertEqual(self.c.post("/api/list/aisle", json={"aisle": "Dairy"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
