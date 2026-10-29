"""List overhaul (owner, 2026-10-29; wireframe v1): a list shows only
what the household put on it. Arya's due staples are suggestions
(on_list false) with the facts for a one-line reason. "I'm out" is the
user's own word and goes straight on; an expired item stays a
suggestion. The demo opens on Costco and Trader Joe's lists, and the
Prepared cart is gone from the List.

The client pins read the React screens: web/src/screens/Lists.tsx,
lists/ListSheets.tsx and lists/model.ts (the port of app.js renderList
and pwa/lists.js)."""
import os, tempfile, unittest
import importlib.util

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient  # noqa: E402

from tests.frontend import css, src  # noqa: E402

HERE = os.path.dirname(__file__)


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
        js = src("screens/Lists.tsx")
        for el in ("lists-home", "list-cards", "list-new", "list-page", "list-back",
                   "lp-title", "lp-select", "lp-menu", "smart-list", "list-suggest",
                   "list-done", "list-hunt", "list-selbar", "ls-move", "ls-remove"):
            self.assertIn(f'id="{el}"', js)
        self.assertIn('id="today-checks"', src("screens/Today.tsx"))
        self.assertNotIn('id="store-filter"', js)
        self.assertNotIn('id="list-notes"', js)

    def test_suggestions_have_a_reason_and_a_why_sheet(self):
        model, ls, sheets = src("screens/lists/model.ts"), src("screens/Lists.tsx"), src("screens/lists/ListSheets.tsx")
        self.assertIn("export function suggestWhy(i: Item)", model)
        self.assertIn("due now", model)
        self.assertIn("Suggested for", ls)
        self.assertIn("function WhySheet(", sheets)
        self.assertIn("Never suggest this", sheets)
        self.assertIn("Last 8 weeks", sheets)

    def test_swipe_shows_move_and_remove_instead_of_removing(self):
        js = src("screens/Lists.tsx")
        self.assertIn('data-act="move"', js)
        self.assertIn('data-act="remove"', js)
        self.assertNotIn("removeListItem", js)
        self.assertIn("startSelect(id)", js)

    def test_move_sheet_moves_several_with_undo(self):
        js, sheets = src("screens/Lists.tsx"), src("screens/lists/ListSheets.tsx")
        self.assertIn("function MoveSheet(", sheets)
        self.assertIn("here now", sheets)
        self.assertIn("+ New list…", sheets)
        self.assertIn('post("/api/list/move"', js)
        self.assertIn('action: "Undo"', js)

    def test_pencil_on_the_name_renames_in_place(self):
        # Owner, 2026-10-29: no second copy of the name in a sheet; the
        # pencil sits on the title and the title becomes the field.
        js, sheets = src("screens/Lists.tsx"), src("screens/lists/ListSheets.tsx")
        self.assertIn('id="lp-pen"', js)
        self.assertIn('renaming ? "Save"', js)
        self.assertIn("const startRename = () => {", js)
        self.assertIn('id="lp-name-input"', js)
        self.assertNotIn('data-ls="rename"', js + sheets)
        self.assertNotIn("Rename list", js + sheets)


class TestStartShopping(unittest.TestCase):
    """Start shopping (owner, 2026-10-29): one bar above the tabs on an
    open list; it leads to the store, the plan, then Quest or Express."""

    def test_shop_sheet_picks_the_mode(self):
        # Design pass (2026-10-29): Start shopping opens one sheet with
        # Quest and Express; the pick goes straight to the trip.
        js = src("screens/Lists.tsx")
        self.assertIn('id="shop-sheet"', js)
        self.assertIn('data-shop="quest"', js)
        self.assertIn('data-shop="express"', js)
        self.assertIn('id="shop-sugg"', js)
        self.assertIn("data-shop-add", js)
        self.assertIn("fastMode: mode });", js)
        self.assertIn("const params = { store, storeId, fromList, fastMode };", src("screens/Store.tsx"))
        self.assertIn("if (D.fastMode && !D.fastDone) {", src("screens/NewList.tsx"))
        # The fast trip skips the bag and the mode screen, and a Quest
        # opens already playing.
        mode = src("screens/Mode.tsx")
        self.assertIn('if (D.fastMode && sess.mode === "quest" && sess.state === "not_started") {', mode)
        self.assertIn('{ state: "playing" }', mode)
        self.assertIn("create(D.fastMode);", mode)

    def test_bar_markup_and_wiring(self):
        js = src("screens/Lists.tsx")
        self.assertIn('<div id="list-startbar" className="startbar"', js)
        self.assertIn('<button id="list-hunt" className="btn primary wide"', js)
        self.assertNotIn("Shopping now?", js)
        self.assertIn("Start shopping · {{count}} item", js)
        self.assertIn(".startbar {", css())
        self.assertNotIn(".huntline", css())


if __name__ == "__main__":
    unittest.main()
