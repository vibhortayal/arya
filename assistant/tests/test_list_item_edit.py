"""Edit a list item (owner, 2026-10-31): name, amount, unit and note in
one call, and the demo household's items carry a clean name with the
pack size stored as amount and unit."""
import importlib.util, os, tempfile, unittest
os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient

HERE = os.path.dirname(__file__)


class TestListItemEdit(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        os.environ.pop("ARYA_DEMO_TOWN", None)
        spec = importlib.util.spec_from_file_location("gen", os.path.join(HERE, "..", "harness", "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/demo")

    def rows(self):
        items = self.c.get("/api/home").json()["list"]["items"]
        return {i["item_id"]: i for i in items if i.get("on_list")}

    def test_demo_list_items_have_clean_names_and_separate_amounts(self):
        rows = self.rows()
        want = {"demo-papertowel": ("Paper Towels", 6, "ct"), "demo-rice": ("Jasmine Rice", 10, "lb"),
                "demo-avocado": ("Avocados", 4, "ct"), "demo-pasta": ("Pasta", 2, "lb"),
                "manual-hummus": ("Hummus", 10, "oz"), "manual-basil": ("Basil", 1, "bunch")}
        for iid, (name, qty, unit) in want.items():
            self.assertEqual((rows[iid]["name"], rows[iid]["qty"], rows[iid]["unit"]), (name, qty, unit), iid)

    def test_edit_changes_name_amount_unit_and_note(self):
        r = self.c.post("/api/list/edit", json={"item_id": "demo-rice", "name": "Basmati Rice", "qty": 2.5,
                                                "unit": "kg", "note": "the big bag"})
        self.assertEqual(r.status_code, 200)
        row = self.rows()["demo-rice"]
        self.assertEqual((row["name"], row["qty"], row["unit"], row["note"]), ("Basmati Rice", 2.5, "kg", "the big bag"))
        # clearing the unit and note works; a bare count is whole
        self.c.post("/api/list/edit", json={"item_id": "demo-rice", "qty": 3, "unit": "", "note": ""})
        row = self.rows()["demo-rice"]
        self.assertEqual((row["qty"], row.get("unit"), row.get("note")), (3, None, None))

    def test_edit_refuses_an_empty_name_and_a_missing_item(self):
        self.assertEqual(self.c.post("/api/list/edit", json={"item_id": "demo-rice", "name": "  "}).status_code, 400)
        self.assertEqual(self.c.post("/api/list/edit", json={"name": "x"}).status_code, 400)
        self.assertEqual(self.rows()["demo-rice"]["name"], "Jasmine Rice")

    def test_demo_edit_is_private_to_the_visitor(self):
        self.c.post("/api/list/edit", json={"item_id": "demo-rice", "name": "Mine"})
        other = TestClient(self.c.app)
        other.post("/auth/demo")
        items = other.get("/api/home").json()["list"]["items"]
        self.assertEqual([i["name"] for i in items if i["item_id"] == "demo-rice"], ["Jasmine Rice"])


if __name__ == "__main__":
    unittest.main()
