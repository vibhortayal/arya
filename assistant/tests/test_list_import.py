"""Paste-in import (owner, 2026-10-30): any paste reads into a preview;
adding is a second step."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ.pop("MODEL_API_KEY", None)
from fastapi.testclient import TestClient  # noqa: E402

from api.list.importer import parse_paste  # noqa: E402


def fresh(case):
    os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
    from api import main
    from api import deps
    deps._login_fails.clear()
    case.c = TestClient(main.app)
    r = case.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
    assert r.status_code == 200, r.text


class TestParse(unittest.TestCase):
    def names(self, text):
        items, src = parse_paste(text)
        return [i["name"] for i in items], src

    def test_plain_lines_bullets_and_checkboxes(self):
        n, src = self.names("- [ ] Oat milk\n- [x] Eggs\n• Butter\n2 lemons")
        self.assertEqual(n, ["Oat milk", "Eggs", "Butter", "lemons"])
        self.assertEqual(src, "split")

    def test_a_heading_line_is_not_an_item(self):
        n, _ = self.names("Groceries\n- 2 lbs chicken thighs\n[ ] oat milk\n1. rice 5kg")
        self.assertEqual(n, ["chicken thighs", "oat milk", "rice"])
        n, _ = self.names("Costco:\nMilk\nEggs")
        self.assertEqual(n, ["Milk", "Eggs"])

    def test_bare_lines_stay_items(self):
        n, _ = self.names("Milk\nEggs\nBread")
        self.assertEqual(n, ["Milk", "Eggs", "Bread"])

    def test_units_come_through_for_the_preview(self):
        items, _ = parse_paste("- 2 lbs chicken thighs\n1. rice 5kg")
        self.assertEqual([(i["qty"], i["unit"]) for i in items], [(2, "lbs"), (5, "kg")])

    def test_csv_with_known_columns(self):
        items, src = parse_paste("name,qty,unit,checked,department\nMilk,2,gal,no,Dairy\nBread,1,,yes,Bakery")
        self.assertEqual(src, "csv")
        self.assertEqual([(i["name"], i["qty"], i["unit"], i["checked"], i["aisle"]) for i in items],
                         [("Milk", 2, "gal", False, "Dairy"), ("Bread", 1, "", True, "Bakery")])

    def test_csv_with_other_column_names(self):
        items, _ = parse_paste("Item\tCount\nApples\t4")
        self.assertEqual((items[0]["name"], items[0]["qty"]), ("Apples", 4))

    def test_json_of_another_app(self):
        items, src = parse_paste('{"items": [{"title": "Tea", "quantity": 3}, "Honey", {"nothing": 1}]}')
        self.assertEqual(src, "json")
        self.assertEqual([(i["name"], i["qty"]) for i in items], [("Tea", 3), ("Honey", 1)])

    def test_list_of_lists_json(self):
        items, _ = parse_paste('[{"name": "Groceries", "items": ["Rice", "Beans"]}]')
        self.assertEqual([i["name"] for i in items], ["Rice", "Beans"])

    def test_caps_and_empty(self):
        items, _ = parse_paste("\n".join(f"item{i}" for i in range(500)))
        self.assertEqual(len(items), 200)
        self.assertEqual(parse_paste("   ")[0], [])

    def test_model_may_only_return_what_the_paste_holds(self):
        items, src = parse_paste("???", lambda t: ["Invented thing", "??? stuff"])
        self.assertEqual(src, "model")
        self.assertEqual([i["name"] for i in items], ["??? stuff"])


class TestRoutes(unittest.TestCase):
    def setUp(self):
        fresh(self)
        self.lid = self.c.post("/api/lists", json={"name": "Costco", "stores": ["Costco"]}).json()["id"]
        self.other = self.c.post("/api/lists", json={"name": "Corner", "stores": []}).json()["id"]

    def test_preview_adds_nothing_and_marks_other_lists(self):
        self.c.post("/api/list/add", json={"name": "Milk", "list_id": self.other})
        r = self.c.post("/api/list/import-preview", json={"text": "Milk\nEggs", "list_id": self.lid}).json()
        by = {i["name"]: i for i in r["items"]}
        self.assertEqual(by["Milk"]["other_list"], "Corner")
        self.assertEqual(by["Eggs"]["other_list"], "")
        rows = [i["name"] for i in self.c.get("/api/home").json()["list"]["items"] if i.get("on_list")]
        self.assertNotIn("Eggs", rows)

    def test_import_adds_to_the_list_and_counts(self):
        r = self.c.post("/api/list/import", json={"list_id": self.lid, "items": [
            {"name": "Eggs", "qty": 2}, {"name": "Rice", "aisle": "Pantry"}, {"name": ""}]}).json()
        self.assertEqual((r["added"], r["already"]), (2, 0))
        again = self.c.post("/api/list/import", json={"list_id": self.lid, "items": [{"name": "Eggs"}]}).json()
        self.assertEqual((again["added"], again["already"]), (0, 1))

    def test_bad_requests(self):
        self.assertEqual(self.c.post("/api/list/import-preview", json={"text": " "}).status_code, 400)
        self.assertEqual(self.c.post("/api/list/import", json={"items": []}).status_code, 400)
        self.assertEqual(self.c.post("/api/list/import", json={"list_id": "nope", "items": [{"name": "x"}]}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
