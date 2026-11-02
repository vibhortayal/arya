"""Lists usability test, 2026-10-30 (report artifact 4ctg1fogt5AdDytS1G7LmB):
ticks on an account with no receipts, adds into a list for items Arya
already knows, re-adding a ticked item, the toast's names, typed
amounts, quest grabs ticking the list, and the list's own photo add."""
from tests.conftest import one_list
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
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
    return case.c


def rows(c):
    return {i["name"]: i for i in c.get("/api/home").json()["list"]["items"] if i.get("on_list")}


class TestNoReceiptsYet(unittest.TestCase):
    """C1: a new account has no receipts, so as_of() is None; its
    ticks were saved as None and never showed."""

    def setUp(self):
        self.c = fresh(self)
        self.iid = self.c.post("/api/list/add", json={"name": "milk"}).json()["item_id"]

    def test_tick_and_untick_show(self):
        self.c.post("/api/list/check", json={"item_id": self.iid, "checked": True})
        self.assertTrue(rows(self.c)["milk"].get("checked"))
        self.c.post("/api/list/check", json={"item_id": self.iid, "checked": False})
        self.assertFalse(rows(self.c)["milk"].get("checked"))

    def test_cycle_stands_in_for_as_of(self):
        from api import state
        self.assertIsNone(state.as_of())
        self.assertEqual(state.cycle(), state.NO_RECEIPTS_CYCLE)


class TestAddIntoAList(unittest.TestCase):
    def setUp(self):
        self.c = fresh(self)
        # The account's one list (fresh() makes it) is Trader Joe's here.
        self.tj = self.c.get("/api/lists").json()["lists"][0]
        self.c.post("/api/lists/update", json={"id": self.tj["id"], "name": "Trader Joe's"})

    def add(self, text, list_id=None):
        body = {"text": text}
        if list_id:
            body["list_id"] = list_id
        r = self.c.post("/api/list/from-text", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_known_item_goes_to_the_list_it_was_typed_on(self):
        # H1: "bananas" typed on Trader Joe's went to Everything else.
        # Every item is on a list now (owner, 2026-11-02): a known item
        # that left the list comes back on the list it is typed on.
        costco = self.c.post("/api/lists", json={"name": "Costco", "stores": []}).json()
        iid = self.add("bananas", costco["id"])["all_item_ids"][0]
        self.c.post("/api/list/remove", json={"item_id": iid})
        r = self.add("bananas", self.tj["id"])
        self.assertEqual(rows(self.c)["bananas"]["list"], self.tj["id"])
        self.assertEqual(r["already"], 0)

    def test_second_list_names_the_list_it_is_also_on(self):
        # Owner, 2026-10-30 (option B): people decide, so it joins both
        # lists and the toast offers Move here (tests/test_list_also.py).
        costco = self.c.post("/api/lists", json={"name": "Costco", "stores": []}).json()
        self.add("eggs", costco["id"])
        r = self.add("eggs", self.tj["id"])
        self.assertEqual([(a["name"], a["list"]) for a in r["also"]], [("eggs", "Costco")])
        self.assertEqual(r["moved"], [])

    def test_re_adding_a_ticked_item_brings_it_back(self):
        # H2: it said "1 already on it" and stayed under Checked off.
        iid = self.c.post("/api/list/add", json={"name": "basil"}).json()["item_id"]
        self.c.post("/api/list/check", json={"item_id": iid, "checked": True})
        r = self.add("basil")
        self.assertFalse(rows(self.c)["basil"].get("checked"))
        self.assertEqual(r["back"], ["basil"])
        self.assertEqual(r["added"], 1)

    def test_already_on_it_names_where(self):
        self.add("milk", self.tj["id"])
        r = self.add("milk")  # no list named: stays on Trader Joe's
        self.assertEqual(r["already"], 1)
        self.assertEqual(r["already_names"], [{"name": "milk", "list": "Trader Joe's"}])
        self.assertEqual(rows(self.c)["milk"]["list"], self.tj["id"])
        r = self.add("milk", self.tj["id"])
        self.assertEqual(r["already_names"], [{"name": "milk", "list": "Trader Joe's"}])


class TestTypedAmounts(unittest.TestCase):
    """M2: "3 avocados" was an item named "3 avocados" next to a second
    avocado row from "avocados x3"; "1.5 lb salmon" lost its amount."""

    def test_split(self):
        from api.list.intake import split_list_items_units as f
        self.assertEqual(f("3 avocados"), [("avocados", 3, "")])
        self.assertEqual(f("add 3 avocados"), [("avocados", 3, "")])
        self.assertEqual(f("1.5 lb salmon"), [("salmon", 1.5, "lb")])
        self.assertEqual(f("salmon 1.5 lb"), [("salmon", 1.5, "lb")])
        self.assertEqual(f("0.5 kg rice"), [("rice", 0.5, "kg")])
        self.assertEqual(f("2 lb chicken thighs"), [("chicken thighs", 2, "lb")])
        # Names that start with a number stay names.
        self.assertEqual(f("2 percent milk"), [("2 percent milk", 1, "")])
        self.assertEqual(f("2% milk"), [("2% milk", 1, "")])
        self.assertEqual(f("7up"), [("7up", 1, "")])
        self.assertEqual(f("12 grain bread"), [("12 grain bread", 1, "")])
        self.assertEqual(f("1. eggs"), [("eggs", 1, "")])

    def test_one_row_and_decimal_amounts_on_the_list(self):
        c = fresh(self)
        c.post("/api/list/from-text", json={"text": "3 avocados"})
        c.post("/api/list/from-text", json={"text": "avocados x3"})
        c.post("/api/list/from-text", json={"text": "1.5 lb salmon"})
        got = rows(c)
        self.assertEqual([n for n in got if "avocado" in n], ["avocados"])
        self.assertEqual(got["avocados"]["qty"], 3)
        self.assertEqual((got["salmon"]["qty"], got["salmon"]["unit"]), (1.5, "lb"))

    def test_quantity_editor_keeps_a_decimal_only_with_a_unit(self):
        c = fresh(self)
        iid = c.post("/api/list/add", json={"name": "milk"}).json()["item_id"]
        c.post("/api/list/qty", json={"item_id": iid, "qty": 1.5, "unit": "gal"})
        self.assertEqual((rows(c)["milk"]["qty"], rows(c)["milk"]["unit"]), (1.5, "gal"))
        self.assertEqual(c.post("/api/list/qty", json={"item_id": iid, "qty": "lots", "unit": "gal"}).status_code, 400)
        c.post("/api/list/qty", json={"item_id": iid, "qty": 2, "unit": ""})
        self.assertEqual(rows(c)["milk"]["qty"], 2)
        self.assertEqual(c.post("/api/list/qty", json={"item_id": iid, "qty": "x"}).status_code, 400)


class TestQuestTicksTheList(unittest.TestCase):
    """H3: grabbing in a quest never ticked the list row."""

    def test_grab_ticks_and_put_back_unticks(self):
        c = fresh(self)
        c.post("/api/list/from-text", json={"text": "hummus, pasta"})
        sid = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest",
            "items": [{"name": "hummus", "qty": 1}, {"name": "pasta", "qty": 1}]}).json()["id"]
        r = c.post(f"/api/quest/sessions/{sid}/check", json={"item": "hummus", "checked": True})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(rows(c)["hummus"].get("checked"))
        self.assertFalse(rows(c)["pasta"].get("checked"))
        c.post(f"/api/quest/sessions/{sid}/check", json={"item": "hummus", "checked": False})
        self.assertFalse(rows(c)["hummus"].get("checked"))

    def test_grab_of_an_item_not_on_the_list_still_works(self):
        c = fresh(self)
        sid = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest", "items": [{"name": "kale", "qty": 1}]}).json()["id"]
        r = c.post(f"/api/quest/sessions/{sid}/check", json={"item": "kale", "checked": True})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn("kale", rows(c))


class TestPhotoAddUsesTheList(unittest.TestCase):
    """M6: a photo taken on a list's page filed its items nowhere."""

    def test_list_id_reaches_the_add(self):
        from unittest import mock
        had = os.environ.get("MODEL_API_KEY")
        os.environ["MODEL_API_KEY"] = "test-key"
        try:
            c = fresh(self)
            tj = c.post("/api/lists", json={"name": "Trader Joe's", "stores": []}).json()
            read = {"kind": "list", "items": ["oat milk", "figs"]}
            with mock.patch("api.list.intake.read_list_photo", return_value=read), \
                    mock.patch("api.routes.lists.new_client", return_value=object()):
                r = c.post(f"/api/list/from-photo?list_id={tj['id']}", content=b"jpeg",
                           headers={"content-type": "image/jpeg"})
            self.assertEqual(r.status_code, 200, r.text)
            got = rows(c)
            self.assertEqual(got["oat milk"]["list"], tj["id"])
            self.assertEqual(got["figs"]["list"], tj["id"])
            r = c.post("/api/list/from-photo?list_id=l-nope", content=b"jpeg",
                       headers={"content-type": "image/jpeg"})
            self.assertEqual(r.status_code, 404)
        finally:
            if had is None:
                os.environ.pop("MODEL_API_KEY", None)
            else:
                os.environ["MODEL_API_KEY"] = had


if __name__ == "__main__":
    unittest.main()
