"""Price intelligence (owner, 2026-10-29): prices from the household's
own receipts only — per-store compare, trend, own inflation, split
smarter, food waste, similar items — plus the Powers page, the daily
card and the opt-in choice. Deterministic, no model call."""
import importlib.util, os, re, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
from fastapi.testclient import TestClient  # noqa: E402

from api import prices  # noqa: E402

from tests.frontend import src  # noqa: E402


def buy(iid, store, day, price, qty=1, alloc="HOUSEHOLD"):
    return {"item_id": iid, "store_id": store, "date": day, "qty": qty, "price": price,
            "event_type": "purchase", "allocation": alloc}


def ledger(*entries):
    return {"entries": sorted(entries, key=lambda e: e["date"])}


class TestItemPrices(unittest.TestCase):
    def test_unit_price_is_net_total_over_qty(self):
        d = ledger(buy("m", "Costco", "2026-08-01", 8.0, qty=2))
        self.assertEqual(prices.item_prices("m", d)["stores"]["Costco"]["last"], 4.0)

    def test_cheaper_store_against_the_list_store(self):
        d = ledger(buy("m", "TJ", "2026-08-01", 4.79), buy("m", "TJ", "2026-08-08", 4.79),
                   buy("m", "Costco", "2026-08-10", 3.89))
        c = prices.item_prices("m", d, at="TJ")["cheaper"]
        self.assertEqual((c["store"], c["price"], c["vs_store"], c["vs_price"]), ("Costco", 3.89, "TJ", 4.79))

    def test_small_gap_is_not_news(self):
        d = ledger(buy("m", "TJ", "2026-08-01", 4.29), buy("m", "Costco", "2026-08-10", 4.19))
        self.assertIsNone(prices.item_prices("m", d, at="TJ")["cheaper"])

    def test_trend_needs_three_buys_over_four_weeks(self):
        d = ledger(buy("e", "Costco", "2026-05-01", 5.0), buy("e", "Costco", "2026-06-01", 5.5),
                   buy("e", "Costco", "2026-07-01", 6.0))
        t = prices.item_prices("e", d)["trend"]
        self.assertEqual((t["pct"], t["since_month"], t["store"]), (20.0, "May", "Costco"))
        short = ledger(buy("e", "Costco", "2026-05-01", 5.0), buy("e", "Costco", "2026-05-08", 6.0))
        self.assertIsNone(prices.item_prices("e", short)["trend"])

    def test_tiny_moves_read_as_steady(self):
        d = ledger(buy("e", "C", "2026-05-01", 5.0), buy("e", "C", "2026-06-01", 5.0),
                   buy("e", "C", "2026-07-01", 5.05))
        self.assertIsNone(prices.item_prices("e", d)["trend"])

    def test_gifts_for_others_are_not_household_prices(self):
        d = ledger(buy("g", "C", "2026-05-01", 25.0, alloc="FOR-OTHERS"))
        self.assertEqual(prices.item_prices("g", d)["stores"], {})


class TestInsights(unittest.TestCase):
    def basket(self):
        rows = []
        for iid, then, now in (("a", 2.0, 2.2), ("b", 4.0, 4.4), ("c", 10.0, 10.0)):
            rows += [buy(iid, "S", "2026-07-15", then), buy(iid, "S", "2026-10-20", now)]
        return ledger(*rows)

    def test_basket_change_compares_the_same_items(self):
        b = prices.basket_change(self.basket(), {"a": "A", "b": "B", "c": "C"}, today="2026-10-25")
        self.assertEqual(b["items"], 3)
        self.assertEqual(b["pct"], 3.8)            # 16.0 -> 16.6
        self.assertEqual([m["name"] for m in b["movers"]], ["A", "B"])

    def test_basket_needs_three_items(self):
        d = ledger(buy("a", "S", "2026-06-15", 2.0), buy("a", "S", "2026-10-20", 2.2))
        self.assertIsNone(prices.basket_change(d, today="2026-10-25"))

    def test_split_smarter_names_the_cheaper_store_and_saving(self):
        rows = [buy("m", "TJ", f"2026-{mo:02d}-{dd:02d}", 4.80) for mo in (8, 9, 10) for dd in (3, 17)]
        rows.append(buy("m", "Safeway", "2026-10-10", 4.20))
        s = prices.split_smarter(ledger(*rows), {"m": "Milk"}, today="2026-10-25")
        self.assertEqual(s["moves"][0]["to"], "Safeway")
        self.assertEqual(s["moves"][0]["from"], "TJ")
        self.assertGreater(s["month_dollars"], 1)

    def test_split_is_quiet_without_a_real_gap(self):
        rows = [buy("m", "TJ", "2026-10-01", 4.80), buy("m", "Safeway", "2026-10-10", 4.70)]
        self.assertIsNone(prices.split_smarter(ledger(*rows), today="2026-10-25"))

    def test_food_waste_counts_this_month_at_last_price(self):
        d = ledger(buy("s", "TJ", "2026-10-01", 3.99))
        flags = {"s": {"expired": "2026-10-20"}, "x": {"expired": "2026-09-01"}}
        w = prices.food_waste(flags, d, {"s": "Baby Spinach"}, today="2026-10-28")
        self.assertEqual((w["dollars"], w["items"][0]["name"], w["month"]), (3.99, "Baby Spinach", "October"))
        self.assertIsNone(prices.food_waste({}, d, today="2026-10-28"))

    def test_similar_items_are_own_receipts_of_the_same_kind(self):
        names = {"w": "Whole Milk 1 gal", "o": "Organic Milk 0.5 gal", "b": "Sourdough Loaf"}
        d = ledger(buy("w", "TJ", "2026-10-01", 4.80), buy("o", "Costco", "2026-10-02", 4.00),
                   buy("b", "TJ", "2026-10-01", 5.0))
        sim = prices.similar_items("w", d, names)
        self.assertEqual([s["item_id"] for s in sim], ["o"])
        self.assertEqual((sim[0]["per"], sim[0]["per_price"]), ("oz", 0.062))

    def test_size_and_kind_parsing(self):
        self.assertEqual(prices.size_of("Whole Milk 1 gal"), ("oz", 128.0))
        self.assertEqual(prices.size_of("Pasture Eggs 12 ct"), ("each", 12.0))
        self.assertIsNone(prices.size_of("Bananas"))
        self.assertEqual(prices.head_word("Pasture Eggs 12 ct"), "egg")
        self.assertEqual(prices.head_word("Whole Milk 1 gal"), "milk")


def load_demo(base):
    spec = importlib.util.spec_from_file_location(
        "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness", "make_demo_household.py"))
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    gen.main(base)


class TestDemoRoutes(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        load_demo(base)
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/demo")

    def test_item_prices_route_has_trend_cheaper_and_similar(self):
        r = self.c.get("/api/prices/item/demo-milk", params={"at": "Trader Joe's"}).json()
        self.assertGreater(r["trend"]["pct"], 0)
        self.assertEqual(r["cheaper"]["store"], "Safeway")
        self.assertTrue(any("Organic" in s["name"] for s in r["similar"]))
        self.assertEqual(r["per"], "oz")

    def test_insights_route(self):
        r = self.c.get("/api/prices/insights").json()
        self.assertIsNotNone(r["basket"])
        self.assertIsNotNone(r["split"])
        self.assertIn("waste", r)

    def test_powers_facts_and_opt_in(self):
        p = self.c.get("/api/powers").json()
        self.assertGreaterEqual(p["stores"], 2)
        self.assertFalse(p["share_prices"])
        self.assertTrue(self.c.post("/api/powers/share", json={"on": True}).json()["share_prices"])
        self.assertTrue(self.c.get("/api/powers").json()["share_prices"])

    def test_ask_snapshot_carries_price_facts(self):
        from api import chat_service, state
        state.set_current_user("demo")
        try:
            snap = chat_service.snapshot()
        finally:
            state.set_current_user(None)
        milk = snap["prices"]["Whole Milk 1 gal"]
        self.assertIn("Trader Joe's", milk["stores"])
        self.assertIsNotNone(milk["trend"])


class TestClientWiring(unittest.TestCase):
    """Over the React app: Powers.tsx (the port of powers.js), the Info
    sheet (ui/Info.tsx), Today's tip, Analysis's prices."""

    def test_powers_page_daily_card_and_analysis_are_wired(self):
        self.assertIn('"powers"', src("app/views.ts"))
        self.assertIn("  powers: Powers,", src("screens/registry.tsx"))
        self.assertIn('id="btn-powers" view="powers"', src("screens/Profile.tsx"))
        self.assertIn('id="today-tip"', src("screens/Today.tsx"))
        self.assertIn('id="an-prices"', src("screens/Analysis.tsx"))
        self.assertIn('id="info-sheet"', src("ui/Info.tsx"))

    def test_quest_is_not_a_power_and_caveats_sit_behind_info(self):
        js = src("screens/Powers.tsx")
        self.assertNotIn("Quest", re.sub(r"/\*.*?\*/", "", js, flags=re.S))
        info = src("ui/Info.tsx")
        for key in ("trend", "cheaper", "similar", "basket", "split", "waste"):
            self.assertIn(f"  {key}: {{", info)

    def test_no_line_graphs(self):
        # Powers draws one icon (the lock); the Why sheet only its row
        # icons (WHY_ICONS). Neither draws a chart.
        pw = src("screens/Powers.tsx")
        self.assertEqual(pw.count("<svg"), 1)
        self.assertIn('<svg className="pwlock"', pw)
        ls = src("screens/lists/ListSheets.tsx")
        self.assertNotIn("<svg", ls.split("const WHY_ICONS")[0] + ls.split("const Ic = ")[1])
        for text in (pw, ls):
            self.assertNotIn("<polyline", text)

    def test_prompt_forbids_outside_prices(self):
        p = open(os.path.join(os.path.dirname(__file__), "..", "prompts", "chat_v1.md")).read()
        self.assertIn("never use outside prices", p)


if __name__ == "__main__":
    unittest.main()


class TestPowersPlainWords(unittest.TestCase):
    """Owner 2026-10-29: Working for you first and folded, each power
    explained in one plain line, locked ones say what turns them on."""

    def test_groups_order_and_fold(self):
        js = src("screens/Powers.tsx")
        a = js.index('group("Working for you')
        b = js.index('group("Turns on as you add receipts"')
        c = js.index('group("You choose to turn on"')
        self.assertLess(a, b)
        self.assertLess(b, c)
        self.assertIn("working, false)", js)
        self.assertIn('className="pwneed"', js)
        self.assertIn('name: "Spending"', js)
        self.assertNotIn('name: "Patterns"', js)

    def test_turn_on_is_a_button(self):
        # Owner bug 2026-10-29: "nothing happened when I click turn on".
        js = src("screens/Powers.tsx")
        self.assertIn('<button className="pwneed" type="button" data-pw-act="share" onClick={() => setSheet({ kind: "share" })}>', js)
        # Arya Shoppers has no opt-in yet, so it says so instead of "Turn on".
        self.assertIn('name: "Arya shoppers", sub: "See how busy a store is right now.", need: "Coming soon"', js)


class TestReadableNames(unittest.TestCase):
    def test_label_never_returns_a_raw_id(self):
        self.assertEqual(prices._label({"costco-1": "Milk"}, "costco-1"), "Milk")
        self.assertEqual(prices._label({}, "costco-96716"), "an item")
        self.assertEqual(prices._label({"costco-9": "costco-9"}, "costco-9"), "an item")


class TestReceiptSavings(unittest.TestCase):
    def test_discount_lines_and_photo_discounts_count_as_savings(self):
        from api.ledger.build import receipt_savings
        r = {"lines": [{"line_type": "item", "line_total": 10.0},
                       {"line_type": "discount", "line_total": -4.0},
                       {"line_type": "item", "line_total": 5.0, "discount_amount": 1.5},
                       {"line_type": "return", "line_total": -3.0}]}
        self.assertEqual(receipt_savings(r), 5.5)
        self.assertEqual(receipt_savings({"lines": []}), 0)
