"""List overhaul (owner, 2026-10-29; wireframe v1): a list shows only
what the household put on it. Arya's due staples are suggestions
(on_list false) with the facts for a one-line reason. "I'm out" is the
user's own word and goes straight on; an expired item stays a
suggestion. The demo opens on Costco and Trader Joe's lists, and the
Prepared cart is gone from the List."""
import os, tempfile, unittest
import importlib.util

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient  # noqa: E402

HERE = os.path.dirname(__file__)
PWA = os.path.join(HERE, "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as f:
        return f.read()


class TestOnListInTheDemo(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        spec = importlib.util.spec_from_file_location(
            "demo_gen", os.path.join(HERE, "..", "harness", "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/demo")

    def items(self):
        return {i["name"]: i for i in self.c.get("/api/home").json()["list"]["items"]}

    def test_demo_ships_two_lists_with_items_on_them(self):
        home = self.c.get("/api/home").json()
        self.assertEqual([l["name"] for l in home["lists"]], ["Costco", "Trader Joe's"])
        got = self.items()
        self.assertTrue(got["Hummus"]["on_list"])
        self.assertEqual(got["Hummus"]["list"], "l-demo-tj")
        self.assertTrue(got["Paper Towels 6 ct"]["on_list"])
        self.assertEqual(got["Paper Towels 6 ct"]["list"], "l-demo-costco")
        self.assertTrue(got["Basil"]["on_list"])
        self.assertNotIn("list", got["Basil"])

    def test_due_staples_are_suggestions_with_reason_facts(self):
        milk = self.items()["Whole Milk 1 gal"]
        self.assertFalse(milk["on_list"])
        self.assertEqual(milk["source"], "pattern")
        self.assertEqual(milk["every_days"], 7)
        self.assertGreaterEqual(milk["days_since"], 7)
        # Bought at Trader Joe's and Safeway: the client files the
        # suggestion under the list linked to Trader Joe's.
        pbs = self.c.get("/api/home").json()["price_by_store"]
        self.assertIn("Trader Joe's", pbs["demo-milk"])

    def test_adding_a_suggestion_puts_it_on_that_list(self):
        r = self.c.post("/api/list/add", json={"item_id": "demo-milk", "list_id": "l-demo-tj"})
        self.assertEqual(r.status_code, 200)
        milk = self.items()["Whole Milk 1 gal"]
        self.assertTrue(milk["on_list"])
        self.assertEqual(milk["list"], "l-demo-tj")
        # Undo turns it back into a suggestion, not a dismissal.
        self.c.post("/api/items/demo-milk/flag", json={"manual": False, "list": None})
        milk = self.items()["Whole Milk 1 gal"]
        self.assertFalse(milk["on_list"])

    def test_im_out_goes_on_the_list_and_expired_stays_a_suggestion(self):
        today = self.c.get("/api/home").json()["as_of"]
        self.c.post("/api/items/demo-coffee/flag", json={"out": today})
        self.c.post("/api/items/demo-spinach/expired")
        got = self.items()
        self.assertTrue(got["Coffee Beans 12 oz"]["on_list"])
        spinach = got["Baby Spinach 16 oz"]
        self.assertFalse(spinach["on_list"])
        self.assertIn("expired_on", spinach)

    def test_not_now_hides_a_suggestion_for_this_cycle(self):
        self.c.post("/api/list/remove", json={"item_id": "demo-milk"})
        self.assertNotIn("Whole Milk 1 gal", self.items())

    def test_hunt_plan_rows_say_whether_they_are_on_the_list(self):
        plan = {i["name"]: i for i in self.c.get("/api/quest/plan").json()["list"]}
        self.assertTrue(plan["Hummus"]["on_list"])
        self.assertFalse(plan["Whole Milk 1 gal"]["on_list"])


class TestListsClient(unittest.TestCase):
    def test_lists_home_and_list_page_hooks(self):
        html = read("index.html")
        for el in ("lists-home", "list-cards", "list-new", "list-page", "list-back",
                   "lp-title", "lp-select", "lp-menu", "smart-list", "list-suggest",
                   "list-done", "list-hunt", "list-selbar", "ls-move", "ls-remove",
                   "today-checks"):
            self.assertIn(f'id="{el}"', html)
        self.assertNotIn('id="store-filter"', html)
        self.assertNotIn('id="list-notes"', html)

    def test_suggestions_have_a_reason_and_a_why_sheet(self):
        js, ls = read("app.js"), read("lists.js")
        self.assertIn("function suggestWhy(i)", js)
        self.assertIn("due now", js)
        self.assertIn("Suggested for", js)
        self.assertIn("async function openWhy(itemId)", ls)
        self.assertIn("Never suggest this", ls)
        self.assertIn("Last 8 weeks", ls)

    def test_swipe_shows_move_and_remove_instead_of_removing(self):
        js = read("app.js")
        self.assertIn('data-act="move"', js)
        self.assertIn('data-act="remove"', js)
        self.assertNotIn("dx < -90) removeListItem", js)
        self.assertIn("startSelect(id)", js)

    def test_move_sheet_moves_several_with_undo(self):
        ls = read("lists.js")
        self.assertIn("function openMove(ids)", ls)
        self.assertIn("here now", ls)
        self.assertIn("+ New list…", ls)
        self.assertIn('"/api/list/move"', ls)
        self.assertIn('action: "Undo"', ls)

    def test_pencil_on_the_name_renames_in_place(self):
        # Owner, 2026-10-29: no second copy of the name in a sheet; the
        # pencil sits on the title and the title becomes the field.
        js, ls = read("app.js"), read("lists.js")
        self.assertIn('id="lp-pen"', js)
        self.assertIn('listRenaming ? "Save"', js)
        self.assertIn("function startRename()", ls)
        self.assertIn('id="lp-name-input"', ls)
        self.assertNotIn('data-ls="rename"', ls)
        self.assertNotIn("Rename list", ls)


if __name__ == "__main__":
    unittest.main()


class TestStartShopping(unittest.TestCase):
    """Start shopping (owner, 2026-10-29): one bar above the tabs on an
    open list; it leads to the store, the plan, then Quest or Express."""

    def test_bar_markup_and_wiring(self):
        html, js, css = read("index.html"), read("app.js"), read("styles.css")
        self.assertIn('id="list-startbar"', html)
        self.assertIn('id="list-hunt" class="btn primary wide"', html)
        self.assertNotIn("Shopping now?", html)
        self.assertIn("Start shopping · ${open.length} item", js)
        self.assertIn("startHuntFromList(lensList() || null)", js)
        self.assertIn(".startbar {", css)
        self.assertNotIn(".huntline", css)
