"""Pack slice, server side: item extras (C2), the plan facts and
carry-over (C3, C4, C14), list/add with qty and by, and variants.
Deterministic, no model call: the FakeClient seam covers the one
route that builds a session."""
import datetime, json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

USER = "o@x.y"


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        return json.dumps({"verdicts": []}), {}, 0.0


def line(item_id, sku, qty, total, name):
    return {"item_id": item_id, "sku": sku, "qty": qty, "line_type": "item",
            "line_total": total, "status": "auto", "decoded_name": name}


def receipt(rid, merchant, day, lines):
    total = round(sum(l["line_total"] for l in lines), 2)
    return {"receipt_id": rid, "merchant": merchant, "purchased_at": day,
            "source_type": "grocery", "lines": lines, "subtotal": total,
            "tax": 0, "total": total, "totals_reconcile": True,
            "image_ref": None}


def seed_history():
    from api import state
    state._save("dictionary.json", {"entries": [
        {"item_id": "sku-eggs", "sku": "111", "canonical_name": "Pasture Eggs 12 ct"},
        {"item_id": "sku-milk", "sku": "222", "canonical_name": "Whole Milk 1 gal"},
        {"item_id": "sku-oat", "sku": "333", "canonical_name": "Oat Milk 1 L"},
        {"item_id": "sku-free", "sku": "444", "canonical_name": "Free Sample"}]})
    state._save("receipts.json", [
        # eggs: Costco 2 for 12.00 (6.00 each) and 1 for 8.00; TJ 1 for 4.00
        receipt("r1", "Costco", "2026-08-01", [
            line("sku-eggs", "111", 2, 12.0, "Pasture Eggs 12 ct"),
            line("sku-milk", "222", 1, 5.0, "Whole Milk 1 gal"),
            line("sku-free", "444", 1, 0.0, "Free Sample")]),
        receipt("r2", "Costco", "2026-08-15", [
            line("sku-eggs", "111", 1, 8.0, "Pasture Eggs 12 ct"),
            line("sku-oat", "333", 1, 4.5, "Oat Milk 1 L")]),
        receipt("r3", "Trader Joe's", "2026-09-01", [
            line("sku-eggs", "111", 1, 4.0, "Pasture Eggs 12 ct"),
            line("sku-milk", "222", 1, 3.0, "Whole Milk 1 gal")]),
    ])


class PackBase(unittest.TestCase):
    seed = True

    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, state
        main.MetaClient = FakeClient
        main._login_fails.clear()
        self.main, self.state = main, state
        self.c = TestClient(main.app)
        if self.seed:
            seed_history()  # seeded at the root; the first account adopts it
        r = self.c.post("/auth/setup", json={"username": USER, "password": "long-password"})
        assert r.status_code == 200, r.text

    def as_user(self):
        """Direct store access as the logged-in account. Not set
        globally: the login session lives in the root store."""
        from api import quest
        return quest._as_user(USER)

    def flags(self):
        with self.as_user():
            return self.state.flags()

    def plan(self):
        r = self.c.get("/api/quest/plan")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def make_session(self, items, store="Costco", st="finished", days_ago=1):
        from api import quest
        when = (datetime.datetime.now() - datetime.timedelta(days=days_ago)).isoformat(timespec="seconds")

        def fn(s):
            s["state"] = st
            s["created_at"] = when
        with self.as_user():
            sess = quest.create_session(store, "quest", items)
            quest._mutate(sess["id"], fn)
        return sess["id"]

    def leave(self, sid, entries):
        from api import quest

        def fn(s):
            s["left"] = entries
        with self.as_user():
            quest._mutate(sid, fn)


class TestItemMeta(unittest.TestCase):
    def test_clean_and_cap(self):
        from api.itemmeta import clean_extras, EXTRA_KEYS
        self.assertEqual(EXTRA_KEYS, ("note", "variant", "by", "src", "aisle", "unit"))
        out = clean_extras({"note": "  12 ct  ", "variant": "x" * 90, "by": "M" * 40,
                            "aisle": "", "src": "typed", "checked": True, "qty": 3})
        self.assertEqual(out["note"], "12 ct")
        self.assertEqual(len(out["variant"]), 60)
        self.assertEqual(len(out["by"]), 24)
        self.assertEqual(out["src"], "typed")
        self.assertNotIn("aisle", out)
        self.assertEqual(set(out), {"note", "variant", "by", "src"})

    def test_bad_src_and_types_dropped(self):
        from api.itemmeta import clean_extras
        self.assertEqual(clean_extras({"src": "hacked", "note": 5, "by": None, "aisle": ["x"]}), {})
        self.assertEqual(clean_extras("nope"), {})
        self.assertEqual(clean_extras(None), {})

    def test_every_allowed_src(self):
        from api.itemmeta import clean_extras
        for s in ("list", "typed", "starter", "usual", "due", "carried", "queued", "added"):
            self.assertEqual(clean_extras({"src": s}), {"src": s})

    def test_apply_first_non_empty_wins(self):
        from api.itemmeta import apply_extras
        line = {"name": "Eggs", "note": "a dozen"}
        apply_extras(line, {"note": "other", "variant": "Pasture", "by": " "})
        self.assertEqual(line["note"], "a dozen")
        self.assertEqual(line["variant"], "Pasture")
        self.assertNotIn("by", line)
        self.assertIs(apply_extras(line, None), line)


class TestExtrasThroughTheEngine(PackBase):
    seed = False

    def test_make_items_passthrough(self):
        from api import quest
        items = quest.make_items([
            {"name": "Salsa", "qty": 2, "note": "16 oz", "src": "typed", "aisle": "Pantry", "by": "Mia"},
            {"name": "Bread", "variant": "Sourdough", "src": "nope"},
            "Milk"])
        by = {i["name"]: i for i in items}
        self.assertEqual(by["Salsa"]["note"], "16 oz")
        self.assertEqual(by["Salsa"]["by"], "Mia")
        self.assertEqual(by["Salsa"]["aisle"], "Pantry")
        self.assertEqual(by["Bread"]["variant"], "Sourdough")
        self.assertNotIn("src", by["Bread"])
        self.assertNotIn("note", by["Milk"])

    def test_same_group_merge_fills_only_empty_extras(self):
        from api import quest
        items = quest.make_items([
            {"name": "Salsa", "note": "mild"},
            {"name": "salsa", "qty": 2, "note": "hot", "variant": "Chunky"}])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["qty"], 3)
        self.assertEqual(items[0]["note"], "mild")
        self.assertEqual(items[0]["variant"], "Chunky")

    def test_optimizer_passthrough_and_merge_fills_empty_extras(self):
        from api.optimizer import optimize
        out = optimize([
            {"name": "Salsa", "qty": 1, "note": "mild", "src": "typed"},
            {"name": "salsa", "qty": 2, "note": "hot", "variant": "Chunky"},
            {"name": "Tortillas", "by": "Mia", "aisle": "Bakery"}])
        by = {i["name"].lower(): i for i in out["items"]}
        self.assertEqual(by["salsa"]["qty"], 3)
        self.assertEqual(by["salsa"]["note"], "mild")
        self.assertEqual(by["salsa"]["src"], "typed")
        # a merged line fills only what the first line lacks
        self.assertEqual(by["salsa"]["variant"], "Chunky")
        self.assertEqual(by["tortillas"]["by"], "Mia")
        self.assertEqual(by["tortillas"]["aisle"], "Bakery")

    def test_optimizer_merge_keeps_a_later_note_and_variant(self):
        from api.optimizer import optimize
        out = optimize([{"name": "zzzfoo", "src": "list"},
                        {"name": "zzzfoo", "qty": 2, "note": "ripe", "variant": "Brand X"}])
        self.assertEqual(len(out["items"]), 1)
        it = out["items"][0]
        self.assertEqual(it["qty"], 3)
        self.assertEqual(it["note"], "ripe")
        self.assertEqual(it["variant"], "Brand X")
        self.assertEqual(it["src"], "list")

    def test_optimizer_and_quest_merge_agree(self):
        from api import quest
        from api.optimizer import optimize
        raw = [{"name": "zzzfoo", "src": "list"},
               {"name": "zzzfoo", "qty": 2, "note": "ripe", "variant": "Brand X", "by": "Mia"}]
        a = optimize(raw)["items"][0]
        b = quest.make_items(raw)[0]
        for k in ("qty", "note", "variant", "by", "src"):
            self.assertEqual(a.get(k), b.get(k), k)

    def test_optimizer_keeps_extras_on_resolved_items(self):
        seed_history()
        from api.optimizer import optimize
        out = optimize([{"name": "Pasture Eggs 12 ct", "qty": 2, "note": "brown", "src": "usual"}])
        self.assertEqual(out["items"][0]["note"], "brown")
        self.assertEqual(out["items"][0]["src"], "usual")

    def test_create_session_keeps_extras_for_a_mapped_store(self):
        # Trader Joe's has a shelf graph: items are annotated and
        # reordered, and their extras must survive that.
        from api import quest
        sess = quest.create_session("Trader Joe's", "quest", [
            {"name": "Salsa", "note": "16 oz", "src": "typed", "aisle": "Pantry"},
            {"name": "Bread", "by": "Mia", "variant": "Sourdough"}])
        by = {i["name"].lower(): i for i in sess["items"]}
        self.assertEqual(by["salsa"]["note"], "16 oz")
        self.assertEqual(by["salsa"]["src"], "typed")
        self.assertEqual(by["bread"]["by"], "Mia")
        self.assertEqual(by["bread"]["variant"], "Sourdough")
        stored = quest.get_session(sess["id"])
        self.assertEqual({i["name"].lower(): i.get("note") for i in stored["items"]}["salsa"], "16 oz")

    def test_route_carries_extras_into_the_session(self):
        r = self.c.post("/api/quest/sessions", json={
            "store": "Costco", "mode": "quest", "driver": "strip",
            "items": [{"name": "Salsa", "qty": 2, "note": "16 oz", "by": "Mia", "src": "typed"}]})
        self.assertEqual(r.status_code, 200, r.text)
        it = r.json()["items"][0]
        self.assertEqual((it["note"], it["by"], it["src"], it["qty"]), ("16 oz", "Mia", "typed", 2))


class TestPlanFacts(PackBase):
    def test_old_keys_stay_and_new_keys_arrive(self):
        p = self.plan()
        for k in ("list", "items", "has_history", "carried", "queued"):
            self.assertIn(k, p)
        self.assertTrue(p["has_history"])
        it = p["items"][0]
        for k in ("item_id", "name", "stores", "every_days", "days_since", "due",
                  "typical_qty", "price", "prices"):
            self.assertIn(k, it)

    def test_unit_price_is_price_over_qty_with_medians(self):
        items = {i["name"]: i for i in self.plan()["items"]}
        eggs = items["Pasture Eggs 12 ct"]
        # unit prices: Costco 6.00 and 8.00, TJ 4.00 -> overall median 6.00
        self.assertEqual(eggs["price"], 6.0)
        self.assertEqual(eggs["prices"], {"Costco": 7.0, "Trader Joe's": 4.0})

    def test_non_positive_prices_are_ignored(self):
        items = {i["name"]: i for i in self.plan()["items"]}
        free = items["Free Sample"]
        self.assertIsNone(free["price"])
        self.assertEqual(free["prices"], {})

    def test_typical_qty_comes_from_the_pattern(self):
        items = {i["name"]: i for i in self.plan()["items"]}
        self.assertEqual(items["Pasture Eggs 12 ct"]["typical_qty"], 1)
        self.assertEqual(items["Whole Milk 1 gal"]["typical_qty"], 1)

    def test_list_rows_gain_reason_source_added_by(self):
        r = self.c.post("/api/list/add", json={"name": "Tortillas", "by": "Mia"})
        self.assertEqual(r.status_code, 200)
        rows = {x["name"]: x for x in self.plan()["list"]}
        t = rows["Tortillas"]
        self.assertEqual(t["added_by"], "Mia")
        self.assertEqual(t["source"], "user")
        self.assertEqual(t["reason"], "Added by Mia")
        for row in rows.values():
            for k in ("reason", "source", "added_by"):
                self.assertIn(k, row)

    def test_empty_account_has_no_history(self):
        # a fresh account with nothing filed
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        c = TestClient(self.main.app)
        r = c.post("/auth/setup", json={"username": "new@x.y", "password": "long-password"})
        self.assertEqual(r.status_code, 200, r.text)
        p = c.get("/api/quest/plan").json()
        self.assertFalse(p["has_history"])
        self.assertEqual((p["items"], p["carried"], p["queued"]), ([], [], []))

    def test_queued_is_empty_when_the_haul_module_is_absent(self):
        import importlib.util
        if importlib.util.find_spec("api.haul") is None:
            self.assertEqual(self.plan()["queued"], [])
        else:  # the HAUL slice is merged: the key still exists
            self.assertIsInstance(self.plan()["queued"], list)

    def test_queued_rows_pass_through_a_guarded_import(self):
        import sys, types
        mod = types.ModuleType("api.haul")
        mod.queued_list = lambda: [{"id": "q1", "name": "Hummus", "qty": 1, "from": "priya"}, "junk"]
        sys.modules["api.haul"] = mod
        try:
            import api
            api.haul = mod
            q = self.plan()["queued"]
        finally:
            sys.modules.pop("api.haul", None)
            if hasattr(api, "haul"):
                del api.haul
        self.assertEqual([r["id"] for r in q], ["q1"])

    def test_a_broken_haul_module_does_not_break_the_plan(self):
        import sys, types
        mod = types.ModuleType("api.haul")

        def boom():
            raise RuntimeError("nope")
        mod.queued_list = boom
        sys.modules["api.haul"] = mod
        try:
            import api
            api.haul = mod
            q = self.plan()["queued"]
        finally:
            sys.modules.pop("api.haul", None)
            if hasattr(api, "haul"):
                del api.haul
        self.assertEqual(q, [])


class TestCarried(PackBase):
    def left(self, name, group=None, how="saved", **kw):
        e = {"name": name, "qty": 1, "group": group or "name:" + name.lower(),
             "how": how, "idx": 0, "at": datetime.datetime.now().isoformat(timespec="seconds")}
        e.update(kw)
        return e

    def test_saved_item_is_carried_with_its_extras(self):
        sid = self.make_session(["Tortillas"])
        self.leave(sid, [self.left("Tortillas", qty=2, note="large", variant="Corn", by="Mia", aisle="Bakery")])
        c = self.plan()["carried"]
        self.assertEqual(len(c), 1)
        self.assertEqual(c[0]["name"], "Tortillas")
        self.assertEqual(c[0]["qty"], 2)
        self.assertEqual((c[0]["note"], c[0]["variant"], c[0]["by"], c[0]["aisle"]),
                         ("large", "Corn", "Mia", "Bakery"))
        self.assertEqual(c[0]["from_session"], sid)
        self.assertEqual(c[0]["group"], "name:tortillas")

    def test_dropped_is_never_carried(self):
        sid = self.make_session(["Tortillas"])
        self.leave(sid, [self.left("Tortillas", how="dropped")])
        self.assertEqual(self.plan()["carried"], [])

    def test_open_hunts_and_placeholders_are_ignored(self):
        a = self.make_session(["Tortillas"], st="playing")
        self.leave(a, [self.left("Tortillas")])
        b = self.make_session(["Salsa"], st="not_started")
        self.leave(b, [self.left("Salsa")])
        c = self.make_session(["Hummus"])
        self.leave(c, [self.left("Hummus")])
        from api import quest

        def fn(s):
            s["placeholder"] = True
        with self.as_user():
            quest._mutate(c, fn)
        self.assertEqual(self.plan()["carried"], [])

    def test_done_hunts_count_too(self):
        sid = self.make_session(["Tortillas"], st="done")
        self.leave(sid, [self.left("Tortillas")])
        self.assertEqual([c["name"] for c in self.plan()["carried"]], ["Tortillas"])

    def test_consumed_by_a_later_session_with_the_group(self):
        a = self.make_session(["Tortillas"], days_ago=5)
        self.leave(a, [self.left("Tortillas")])
        self.assertEqual(len(self.plan()["carried"]), 1)
        # a later hunt that has the item on its items consumes it
        self.make_session(["Tortillas", "Bread"], st="playing", days_ago=2)
        self.assertEqual(self.plan()["carried"], [])

    def test_an_earlier_session_with_the_group_does_not_consume(self):
        self.make_session(["Tortillas"], days_ago=9)
        a = self.make_session(["Salsa"], days_ago=5)
        self.leave(a, [self.left("Tortillas")])
        self.assertEqual(len(self.plan()["carried"]), 1)

    def test_skipped_when_the_list_has_it(self):
        self.c.post("/api/list/add", json={"name": "Tortillas"})
        sid = self.make_session(["Tortillas"])
        self.leave(sid, [self.left("Tortillas", group="name:other"), self.left("Salsa")])
        names = [c["name"] for c in self.plan()["carried"]]
        self.assertEqual(names, ["Salsa"])

    def test_dedupes_by_group_newest_first(self):
        old = self.make_session(["Tortillas"], days_ago=8)
        self.leave(old, [self.left("Tortillas", note="old")])
        new = self.make_session(["Tortillas"], days_ago=3)
        # the newer hunt ALSO left it (it was on that hunt's items before leaving)
        self.leave(new, [self.left("Tortillas", note="new")])
        c = self.plan()["carried"]
        self.assertEqual(len(c), 1)
        self.assertEqual(c[0]["note"], "new")

    def test_thirty_day_limit(self):
        old = self.make_session(["Tortillas"], days_ago=31)
        self.leave(old, [self.left("Tortillas")])
        fresh = self.make_session(["Salsa"], days_ago=29)
        self.leave(fresh, [self.left("Salsa")])
        self.assertEqual([c["name"] for c in self.plan()["carried"]], ["Salsa"])

    def test_cap_of_eight(self):
        sid = self.make_session(["Tortillas"])
        self.leave(sid, [self.left(f"Thing {i}") for i in range(12)])
        self.assertEqual(len(self.plan()["carried"]), 8)

    def test_old_sessions_without_left_keys_work(self):
        self.make_session(["Tortillas"])
        self.assertEqual(self.plan()["carried"], [])

    def test_a_swap_original_is_carried(self):
        sid = self.make_session(["Tortillas"])
        self.leave(sid, [self.left("Tortillas", swapped_for="Corn tortillas")])
        self.assertEqual([c["name"] for c in self.plan()["carried"]], ["Tortillas"])


class TestListAddExtras(PackBase):
    def test_qty_and_by_set_flags_and_show_on_the_smart_list(self):
        r = self.c.post("/api/list/add", json={"name": "Tortillas", "qty": 3, "by": "Mia"})
        self.assertEqual(r.status_code, 200)
        iid = r.json()["item_id"]
        self.assertEqual(list(r.json()), ["item_id"])
        flag = self.flags()[iid]
        self.assertEqual(flag["qty_override"], 3)
        self.assertEqual(flag["added_by"], "Mia")
        row = next(i for i in self.c.get("/api/home").json()["list"]["items"] if i["item_id"] == iid)
        self.assertEqual(row["due_reason"], "Added by Mia")
        self.assertEqual(row["added_by"], "Mia")
        self.assertEqual(row["qty"], 3)

    def test_plain_add_still_says_added_by_you(self):
        r = self.c.post("/api/list/add", json={"name": "Tortillas"})
        row = next(i for i in self.c.get("/api/home").json()["list"]["items"]
                   if i["item_id"] == r.json()["item_id"])
        self.assertEqual(row["due_reason"], "Added by you")
        self.assertNotIn("added_by", row)

    def test_a_later_add_without_a_by_key_keeps_the_name(self):
        # The Undo of a list-row removal posts only {item_id}.
        r = self.c.post("/api/list/add", json={"name": "Tortillas", "by": "Mia"})
        iid = r.json()["item_id"]
        self.c.post("/api/list/add", json={"item_id": iid})
        self.assertEqual(self.flags()[iid]["added_by"], "Mia")
        row = next(i for i in self.c.get("/api/home").json()["list"]["items"] if i["item_id"] == iid)
        self.assertEqual(row["due_reason"], "Added by Mia")

    def test_an_explicit_empty_by_clears_the_name(self):
        r = self.c.post("/api/list/add", json={"name": "Tortillas", "by": "Mia", "approved": True})
        iid = r.json()["item_id"]
        self.c.post("/api/list/add", json={"item_id": iid, "by": ""})
        self.assertNotIn("added_by", self.flags()[iid])
        self.assertNotIn("approved", self.flags()[iid])
        row = next(i for i in self.c.get("/api/home").json()["list"]["items"] if i["item_id"] == iid)
        self.assertEqual(row["due_reason"], "Added by you")

    def test_a_bad_qty_writes_nothing(self):
        before = dict(self.flags())
        bad = self.c.post("/api/list/add", json={"name": "Zucchini boats", "qty": "lots"})
        self.assertEqual(bad.status_code, 400)
        bad2 = self.c.post("/api/list/add", json={"item_id": "sku-never", "qty": "x"})
        self.assertEqual(bad2.status_code, 400)
        self.assertEqual(self.flags(), before)

    def test_approved_rides_the_flag_and_reaches_the_plan(self):
        r = self.c.post("/api/list/add", json={"name": "Tortillas", "by": "Mia"})
        iid = r.json()["item_id"]
        plan = self.plan()
        row = next(i for i in plan["list"] if i["item_id"] == iid)
        self.assertEqual((row["added_by"], row["approved"]), ("Mia", False))
        self.c.post("/api/list/add", json={"item_id": iid, "approved": True})
        self.assertIs(self.flags()[iid]["approved"], True)
        self.assertEqual(self.flags()[iid]["added_by"], "Mia")
        row = next(i for i in self.plan()["list"] if i["item_id"] == iid)
        self.assertEqual((row["added_by"], row["approved"]), ("Mia", True))
        # a new add by someone else asks for approval again
        self.c.post("/api/list/add", json={"item_id": iid, "by": "Sam"})
        row = next(i for i in self.plan()["list"] if i["item_id"] == iid)
        self.assertEqual((row["added_by"], row["approved"]), ("Sam", False))

    def test_by_is_capped_and_qty_validated(self):
        r = self.c.post("/api/list/add", json={"name": "Tortillas", "by": "M" * 50})
        self.assertEqual(len(self.flags()[r.json()["item_id"]]["added_by"]), 24)
        bad = self.c.post("/api/list/add", json={"name": "Tortillas", "qty": "lots"})
        self.assertEqual(bad.status_code, 400)

    def test_item_id_path_takes_extras_too(self):
        r = self.c.post("/api/list/add", json={"item_id": "sku-milk", "qty": 2, "by": "Dev"})
        self.assertEqual(r.json(), {"item_id": "sku-milk"})
        self.assertEqual(self.flags()["sku-milk"]["qty_override"], 2)

    def test_missing_name_and_id_is_still_400(self):
        self.assertEqual(self.c.post("/api/list/add", json={"qty": 2}).status_code, 400)


class TestVariants(PackBase):
    def test_returns_dictionary_candidates_with_counts_and_last_price(self):
        r = self.c.get("/api/pack/variants", params={"name": "milk"})
        self.assertEqual(r.status_code, 200)
        v = {x["name"]: x for x in r.json()["variants"]}
        self.assertEqual(set(v), {"Whole Milk 1 gal", "Oat Milk 1 L"})
        self.assertEqual(v["Whole Milk 1 gal"]["count"], 2)
        self.assertEqual(v["Whole Milk 1 gal"]["last_price"], 3.0)
        self.assertEqual(v["Oat Milk 1 L"]["last_price"], 4.5)
        names = [x["name"] for x in r.json()["variants"]]
        self.assertEqual(names[0], "Whole Milk 1 gal")  # most bought first

    def test_empty_and_unknown_names(self):
        self.assertEqual(self.c.get("/api/pack/variants").json(), {"variants": []})
        self.assertEqual(self.c.get("/api/pack/variants", params={"name": "zzzz qqq"}).json(),
                         {"variants": []})

    def test_needs_login(self):
        c = TestClient(self.main.app)
        self.assertEqual(c.get("/api/pack/variants", params={"name": "milk"}).status_code, 401)


class TestDemoHousehold(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness", "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        self.base = base
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/demo")

    def _disk(self):
        out = {}
        for root, _d, files in os.walk(self.base):
            for f in files:
                p = os.path.join(root, f)
                with open(p, "rb") as fh:
                    out[p] = fh.read()
        return out

    def test_demo_has_history_and_prices(self):
        p = self.c.get("/api/quest/plan").json()
        self.assertTrue(p["has_history"])
        priced = [i for i in p["items"] if i["price"]]
        self.assertTrue(priced)
        self.assertIsInstance(p["queued"], list)
        self.assertIsInstance(p["carried"], list)

    def test_demo_add_with_qty_and_by_stays_in_the_overlay(self):
        before = self._disk()
        r = self.c.post("/api/list/add", json={"name": "Hummus", "qty": 2, "by": "Mia"})
        self.assertEqual(r.status_code, 200, r.text)
        rows = {i["name"]: i for i in self.c.get("/api/quest/plan").json()["list"]}
        self.assertEqual(rows["Hummus"]["added_by"], "Mia")
        self.assertEqual(self._disk(), before)

    def test_demo_variants_work(self):
        r = self.c.get("/api/pack/variants", params={"name": "milk"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["variants"])


if __name__ == "__main__":
    unittest.main()
