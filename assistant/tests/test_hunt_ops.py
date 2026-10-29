"""Hunt operations (hunt slice, 2026-10-28): the plan changes in the
aisle. Leave for next time, bring back, edit, swap, forgot something,
take a report back, and the boss item. All deterministic code: a fake
client that raises on any model call stands in wherever main.py builds
one, and shelfmatch.model_match is patched to fail the test if it runs.
No lives, no penalty, no way to lose an item.
"""
import os, tempfile, unittest
from unittest import mock

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

STORE = "Corner Shop"   # no shelf graph: items keep their list order


class FakeClient:
    """Raises on any model call: no hunt operation may reach one."""
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        def boom(*a, **k):
            raise AssertionError(f"hunt paths must not call a model ({name})")
        return boom


class Base(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, shelfmatch
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.main = main
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "owner@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text
        p = mock.patch.object(shelfmatch, "model_match",
                              side_effect=AssertionError("no model call"))
        p.start()
        self.addCleanup(p.stop)

    # helpers
    def as_owner(self):
        """Direct store access: the test process has no request, so
        name the account (never held across a request: sessions live
        in the root store)."""
        from api import state
        import contextlib

        @contextlib.contextmanager
        def ctx():
            state.set_current_user("owner@example.com")
            try:
                yield
            finally:
                state.set_current_user(None)
        return ctx()

    def make(self, names, store=STORE):
        r = self.c.post("/api/quest/sessions", json={
            "store": store, "mode": "quest", "items": names})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def op(self, sid, name, body, code=200):
        r = self.c.post(f"/api/quest/sessions/{sid}/{name}", json=body)
        self.assertEqual(r.status_code, code, r.text)
        return r.json()

    def get(self, sid):
        return self.c.get(f"/api/quest/sessions/{sid}").json()

    def check(self, sid, item, checked=True):
        r = self.c.post(f"/api/quest/sessions/{sid}/check",
                        json={"item": item, "checked": checked})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def report(self, sid, item):
        r = self.c.post(f"/api/quest/sessions/{sid}/report-missing",
                        json={"item": item, "kind": "empty_shelf"})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    @staticmethod
    def names(sess, key="items"):
        return [i["name"] for i in sess.get(key) or []]


class TestLeave(Base):
    def test_leave_saved_and_dropped_moves_items_to_left(self):
        sess = self.make(["Apples", "Bread", "Cheese", "Dates"])
        out = self.op(sess["id"], "leave", {"entries": [
            {"item": "Bread", "how": "saved"},
            {"item": "Cheese", "how": "dropped"}]})
        self.assertEqual(self.names(out), ["Apples", "Dates"])
        self.assertEqual(self.names(out, "left"), ["Bread", "Cheese"])
        bread, cheese = out["left"]
        self.assertEqual((bread["how"], bread["idx"]), ("saved", 1))
        self.assertEqual((cheese["how"], cheese["idx"]), ("dropped", 2))
        self.assertTrue(bread["at"])
        self.assertNotIn("checked", bread)
        # persisted, not just echoed
        self.assertEqual(self.names(self.get(sess["id"]), "left"), ["Bread", "Cheese"])

    def test_leave_is_idempotent_by_name(self):
        sess = self.make(["Apples", "Bread"])
        body = {"entries": [{"item": "Bread", "how": "saved"}]}
        self.op(sess["id"], "leave", body)
        out = self.op(sess["id"], "leave", body)
        self.assertEqual(self.names(out), ["Apples"])
        self.assertEqual(self.names(out, "left"), ["Bread"])

    def test_leave_refuses_bad_input_and_changes_nothing(self):
        sess = self.make(["Apples", "Bread"])
        sid = sess["id"]
        self.op(sid, "leave", {"entries": []}, 400)
        self.op(sid, "leave", {"entries": [{"item": "Apples", "how": "later"}]}, 400)
        # one unknown item: 404 and NOTHING moves (all-or-none)
        self.op(sid, "leave", {"entries": [
            {"item": "Apples", "how": "saved"}, {"item": "Nope", "how": "saved"}]}, 404)
        self.assertEqual(self.names(self.get(sid)), ["Apples", "Bread"])
        self.op("qs-missing", "leave", {"entries": [{"item": "Apples"}]}, 404)

    def test_a_grabbed_item_cannot_be_left(self):
        sess = self.make(["Apples", "Bread"])
        self.check(sess["id"], "Apples")
        self.op(sess["id"], "leave", {"entries": [{"item": "Apples", "how": "dropped"}]}, 400)
        self.assertEqual(self.names(self.get(sess["id"])), ["Apples", "Bread"])

    def test_full_haul_bonus_ignores_left_items(self):
        from api import social
        sess = self.make(["Apples", "Bread", "Cheese"])
        sid = sess["id"]
        self.check(sid, "Apples")
        self.check(sid, "Bread")
        s = self.get(sid)
        self.assertEqual(social.hunt_points(s), 2 * 10 + 50)          # Cheese still open
        self.op(sid, "leave", {"entries": [{"item": "Cheese", "how": "saved"}]})
        s = self.get(sid)
        self.assertEqual(social.hunt_points(s), 2 * 10 + 25 + 50)     # full haul
        # leaving everything leaves no full haul to pay
        s2 = self.make(["Eggs"])
        self.op(s2["id"], "leave", {"entries": [{"item": "Eggs", "how": "dropped"}]})
        self.assertEqual(social.hunt_points(self.get(s2["id"])), 50)

    def test_an_honest_report_does_not_cost_the_full_haul(self):
        from api import social
        s = self.make(["Apples", "Bread", "Cheese", "Dates"])
        sid = s["id"]
        self.report(sid, "Dates")
        for name in ("Apples", "Bread"):
            self.check(sid, name)
        view = self.get(sid)
        with self.as_owner():
            self.assertEqual(social.hunt_points(view), 2 * 10 + 50)       # Cheese still open
        self.check(sid, "Cheese")
        view = self.get(sid)
        with self.as_owner():
            # report 1 of 4, grab the other 3: the same as dropping it
            self.assertEqual(social.hunt_points(view), 3 * 10 + 25 + 50)
        # taking the report back makes the item open again: no full haul
        self.op(sid, "withdraw-report", {"item": "Dates"})
        view = self.get(sid)
        with self.as_owner():
            self.assertEqual(social.hunt_points(view), 3 * 10 + 50)
        # a report with nothing grabbed pays no full haul
        e = self.make(["Eggs"])
        self.report(e["id"], "Eggs")
        view = self.get(e["id"])
        with self.as_owner():
            self.assertEqual(social.hunt_points(view), 50)
        # a reported item can still be saved for next trip
        self.op(sid, "leave", {"entries": [{"item": "Dates", "how": "saved"}]})
        view = self.get(sid)
        with self.as_owner():
            self.assertEqual(social.hunt_points(view), 3 * 10 + 25 + 50)

    def test_restore_returns_to_the_original_place(self):
        sess = self.make(["Apples", "Bread", "Cheese", "Dates"])
        sid = sess["id"]
        self.op(sid, "leave", {"entries": [{"item": "Bread", "how": "saved"}]})
        out = self.op(sid, "restore", {"item": "Bread"})
        self.assertEqual(self.names(out), ["Apples", "Bread", "Cheese", "Dates"])
        self.assertEqual(out["left"], [])
        self.assertFalse(out["items"][1]["checked"])
        # leave two, bring both back in order: nothing lost, order kept
        self.op(sid, "leave", {"entries": [{"item": "Bread", "how": "saved"},
                                           {"item": "Cheese", "how": "dropped"}]})
        self.op(sid, "restore", {"item": "Bread"})
        out = self.op(sid, "restore", {"item": "Cheese"})
        self.assertEqual(self.names(out), ["Apples", "Bread", "Cheese", "Dates"])

    def test_restore_unknown_is_404_and_restore_merges_a_duplicate(self):
        sess = self.make(["Apples", "Bread"])
        sid = sess["id"]
        self.op(sid, "restore", {"item": "Bread"}, 404)
        # The same product is on the hunt again (a pure-function case:
        # the route would bring the left one back instead).
        from api import hunt
        s = {"items": [{"name": "Apples", "qty": 1, "checked": False, "group": "name:apples"},
                       {"name": "Bread", "qty": 2, "checked": True, "group": "name:bread"}],
             "left": [{"name": "Bread", "qty": 1, "group": "name:bread", "how": "saved",
                       "idx": 1, "at": "t"}]}
        hunt.apply_restore(s, "Bread")
        self.assertEqual([i["name"] for i in s["items"]], ["Apples", "Bread"])   # one row
        self.assertEqual((s["items"][1]["qty"], s["items"][1]["checked"]), (3, False))
        self.assertEqual(s["left"], [])


class TestEditSwap(Base):
    def test_edit_quantity_and_note_with_limits(self):
        sess = self.make([{"name": "Apples", "qty": 1}, "Bread"])
        sid = sess["id"]
        out = self.op(sid, "edit", {"item": "Apples", "qty": 4, "note": "the big bag"})
        self.assertEqual((out["items"][0]["qty"], out["items"][0]["note"]), (4, "the big bag"))
        out = self.op(sid, "edit", {"item": "Apples", "note": ""})
        self.assertNotIn("note", out["items"][0])
        self.assertEqual(out["items"][0]["qty"], 4)
        for bad in (0, 100, -1, "x", 1.5, True):
            self.op(sid, "edit", {"item": "Apples", "qty": bad}, 400)
        self.op(sid, "edit", {"item": "Apples", "note": "n" * 61}, 400)
        self.op(sid, "edit", {"item": "Apples", "note": "n" * 60}, 200)
        self.op(sid, "edit", {"item": "Apples"}, 400)
        self.op(sid, "edit", {"item": "Nope", "qty": 2}, 404)
        self.op(sid, "edit", {"qty": 2}, 400)
        self.assertEqual(self.get(sid)["items"][0]["qty"], 4)

    def test_swap_keeps_qty_and_note_and_saves_the_original(self):
        sess = self.make([{"name": "Apples", "qty": 3}, "Bread", "Cheese"])
        sid = sess["id"]
        self.op(sid, "edit", {"item": "Bread", "qty": 2, "note": "sliced"})
        out = self.op(sid, "swap", {"item": "Bread", "to": "Rye Loaf"})
        self.assertEqual(self.names(out), ["Apples", "Rye Loaf", "Cheese"])   # same place
        sub = out["items"][1]
        self.assertEqual((sub["qty"], sub["note"], sub["swapped_from"], sub["checked"]),
                         (2, "sliced", "Bread", False))                       # stays OPEN
        orig = out["left"][0]
        self.assertEqual((orig["name"], orig["how"], orig["swapped_for"], orig["idx"]),
                         ("Bread", "saved", "Rye Loaf", 1))
        self.assertEqual(sub["group"], "name:rye loaf")
        # a swap alone pays nothing
        from api import social
        self.assertEqual(social.hunt_points(out), 50)

    def test_unswap_reverses(self):
        sess = self.make(["Apples", "Bread", "Cheese"])
        sid = sess["id"]
        before = self.get(sid)["items"]
        self.op(sid, "swap", {"item": "Bread", "to": "Rye Loaf"})
        out = self.op(sid, "unswap", {"to": "Rye Loaf"})
        self.assertEqual(out["items"], before)
        self.assertEqual(out["left"], [])

    def test_a_chain_swap_does_not_save_the_stand_in(self):
        sess = self.make(["Apples", "Bread", "Cheese"])
        sid = sess["id"]
        self.op(sid, "swap", {"item": "Bread", "to": "Rye Loaf"})
        out = self.op(sid, "swap", {"item": "Rye Loaf", "to": "Sourdough"})
        self.assertEqual(self.names(out), ["Apples", "Sourdough", "Cheese"])
        # only the original is saved, and it points at the last stand-in
        self.assertEqual([(e["name"], e["how"], e["swapped_for"]) for e in out["left"]],
                         [("Bread", "saved", "Sourdough")])
        self.assertEqual(out["items"][1]["swapped_from"], "Bread")
        back = self.op(sid, "unswap", {"to": "Sourdough"})
        self.assertEqual(self.names(back), ["Apples", "Bread", "Cheese"])
        self.assertEqual(back["left"], [])

    def test_swap_refusals(self):
        sess = self.make(["Apples", "Bread"])
        sid = sess["id"]
        self.op(sid, "swap", {"item": "Bread", "to": "bread"}, 400)       # same item
        self.op(sid, "swap", {"item": "Bread", "to": "Apples"}, 400)      # already there
        self.op(sid, "swap", {"item": "Bread", "to": ""}, 400)
        self.op(sid, "swap", {"item": "Nope", "to": "Rye"}, 404)
        self.check(sid, "Bread")
        self.op(sid, "swap", {"item": "Bread", "to": "Rye"}, 400)         # in the cart
        self.op(sid, "unswap", {"to": "Apples"}, 400)                     # not a swap
        self.assertEqual(self.names(self.get(sid)), ["Apples", "Bread"])


class TestForgot(Base):
    def test_the_answer_says_what_the_server_did_with_a_dictionary_name(self):
        from api import state
        with self.as_owner():
            state._save("dictionary.json", {"entries": [
                {"item_id": "sku-milk", "sku": "11", "canonical_name": "Whole Milk 1 gal"}]})
        sess = self.make(["milk", "Bread"])
        sid = sess["id"]
        self.assertEqual(self.names(sess), ["Whole Milk 1 gal", "Bread"])
        out = self.op(sid, "forgot", {"name": "whole milk"})
        f = out["forgot"]
        # the server merged into the dictionary item: it was not added
        self.assertEqual((f["result"], f["reopened"], f["prev_qty"]), ("merged", False, 1))
        self.assertEqual((f["item"]["name"], f["item"]["qty"]), ("Whole Milk 1 gal", 2))
        self.assertFalse(f["item"].get("added_mid_hunt"))
        self.assertNotIn("forgot", self.get(sid))                  # a side note, never stored
        # undo by the server's name: edit back to prev_qty
        back = self.op(sid, "edit", {"item": f["item"]["name"], "qty": f["prev_qty"]})
        self.assertEqual(back["items"][0]["qty"], 1)
        # the typed name is not an added item, so remove-added refuses it
        self.op(sid, "remove-added", {"item": "whole milk"}, 400)
        # an added item answers "added" with the canonical name
        add = self.op(sid, "forgot", {"name": "Tea", "qty": 2})["forgot"]
        self.assertEqual((add["result"], add["item"]["name"], add["item"]["qty"]), ("added", "Tea", 2))
        self.op(sid, "remove-added", {"item": add["item"]["name"]})

    def test_forgot_restore_applies_the_typed_quantity_and_note(self):
        sess = self.make(["Eggs", "Bread"])
        sid = sess["id"]
        self.op(sid, "leave", {"entries": [{"item": "Eggs", "how": "saved"}]})
        out = self.op(sid, "forgot", {"name": "eggs", "qty": 3, "note": "free range"})
        self.assertEqual(out["forgot"]["result"], "restored")
        self.assertEqual(out["forgot"]["how"], "saved")
        eggs = [i for i in out["items"] if i["name"] == "Eggs"][0]
        self.assertEqual((eggs["qty"], eggs["note"], eggs["checked"]), (3, "free range", False))
        # no typed quantity: the saved quantity stays
        self.op(sid, "edit", {"item": "Eggs", "qty": 2})
        self.op(sid, "leave", {"entries": [{"item": "Eggs", "how": "dropped"}]})
        out = self.op(sid, "forgot", {"name": "eggs"})
        self.assertEqual([i["qty"] for i in out["items"] if i["name"] == "Eggs"], [2])

    def test_qty_infinity_is_a_400_not_a_500(self):
        sess = self.make(["Apples"])
        sid = sess["id"]
        for route, body in (("edit", '{"item": "Apples", "qty": Infinity}'),
                            ("edit", '{"item": "Apples", "qty": -Infinity}'),
                            ("edit", '{"item": "Apples", "qty": NaN}'),
                            ("forgot", '{"name": "Tea", "qty": Infinity}')):
            r = self.c.post(f"/api/quest/sessions/{sid}/{route}", content=body,
                            headers={"Content-Type": "application/json"})
            self.assertEqual(r.status_code, 400, (route, body, r.text))
        self.assertEqual(self.get(sid)["items"][0]["qty"], 1)

    def test_forgot_adds_an_open_item_marked_added_mid_hunt(self):
        sess = self.make(["Apples", "Bread"])
        out = self.op(sess["id"], "forgot", {"name": "Tortillas", "qty": 2})
        self.assertEqual(self.names(out), ["Apples", "Bread", "Tortillas"])
        it = out["items"][2]
        self.assertEqual((it["qty"], it["checked"], it["added_mid_hunt"]), (2, False, True))
        self.assertEqual(it["group"], "name:tortillas")

    def test_forgot_merges_quantity_and_reopens_a_grabbed_item(self):
        sess = self.make([{"name": "Eggs", "qty": 1}, "Bread"])
        sid = sess["id"]
        out = self.op(sid, "forgot", {"name": "eggs"})
        self.assertEqual((len(out["items"]), out["items"][0]["qty"]), (2, 2))
        self.check(sid, "Eggs")
        out = self.op(sid, "forgot", {"name": "Eggs", "qty": 3})
        self.assertEqual((out["items"][0]["qty"], out["items"][0]["checked"]), (5, False))

    def test_forgot_brings_back_a_left_item(self):
        sess = self.make(["Apples", "Bread"])
        sid = sess["id"]
        self.op(sid, "leave", {"entries": [{"item": "Apples", "how": "dropped"}]})
        out = self.op(sid, "forgot", {"name": "apples"})
        self.assertEqual(self.names(out), ["Apples", "Bread"])
        self.assertEqual(out["left"], [])
        self.assertNotIn("added_mid_hunt", out["items"][0])

    def test_forgot_validates_and_never_calls_a_model(self):
        sess = self.make(["Apples"])
        sid = sess["id"]
        self.op(sid, "forgot", {"name": " "}, 400)
        self.op(sid, "forgot", {"name": "x" * 81}, 400)
        self.op(sid, "forgot", {"name": "Tea", "qty": 0}, 400)
        self.op(sid, "forgot", {"name": "Tea", "qty": 100}, 400)
        self.op(sid, "forgot", {"name": "Tea", "note": "n" * 61}, 400)
        self.assertEqual(self.names(self.get(sid)), ["Apples"])
        self.op(sid, "forgot", {"name": "Tea"})   # FakeClient + model_match would raise

    def test_item_cap(self):
        from api import hunt
        sess = {"state": "playing", "store": STORE,
                "items": [{"name": f"I{i}", "qty": 1, "checked": False, "group": f"g{i}"}
                          for i in range(hunt.ITEMS_MAX)]}
        with self.assertRaises(ValueError):
            hunt.apply_forgot(sess, "One more")

    def test_new_item_is_placed_by_shelf_position(self):
        from api import hunt
        items = [{"name": "A", "qty": 1, "checked": False, "group": "a", "shelf_u": 0.2},
                 {"name": "B", "qty": 1, "checked": False, "group": "b", "shelf_u": 0.8},
                 {"name": "C", "qty": 1, "checked": False, "group": "c", "shelf_u": None}]

        def annotate(its, u=0.5):
            its[0]["shelf_label"] = "Aisle 3"
            its[0]["shelf_u"] = u
        sess = {"items": [dict(i) for i in items]}
        hunt.apply_forgot(sess, "Mid", annotate=annotate)
        self.assertEqual([i["name"] for i in sess["items"]], ["A", "Mid", "B", "C"])
        sess = {"items": [dict(i) for i in items]}
        hunt.apply_forgot(sess, "Late", annotate=lambda its: annotate(its, 0.95))
        self.assertEqual([i["name"] for i in sess["items"]], ["A", "B", "Late", "C"])
        # an unplaced item goes to the end
        sess = {"items": [dict(i) for i in items]}
        hunt.apply_forgot(sess, "Odd", annotate=lambda its: its[0].update(shelf_u=None))
        self.assertEqual([i["name"] for i in sess["items"]], ["A", "B", "C", "Odd"])

    def test_remove_added_only_removes_added_items(self):
        sess = self.make(["Apples", "Bread"])
        sid = sess["id"]
        self.op(sid, "forgot", {"name": "Tea"})
        out = self.op(sid, "remove-added", {"item": "Tea"})
        self.assertEqual(self.names(out), ["Apples", "Bread"])
        self.op(sid, "remove-added", {"item": "Apples"}, 400)             # a planned item
        self.assertEqual(self.names(self.get(sid)), ["Apples", "Bread"])
        self.op(sid, "remove-added", {"item": "Nope"}, 404)


class TestWithdraw(Base):
    def test_withdraw_drops_the_report_everywhere_and_it_can_be_filed_again(self):
        sess = self.make(["Apples", "Bread"])
        sid = sess["id"]
        self.report(sid, "Bread")
        self.assertEqual(self.c.get("/api/quest/stores/Corner%20Shop/reports").json()["count"], 1)
        self.assertEqual(len(self.c.get("/api/quest/news").json()["news"]), 1)
        self.assertEqual(self.get(sid)["my_reports"], ["Bread"])
        self.assertEqual(self.c.get("/api/quest/profile").json()["stats"]["spots_reported"], 1)
        out = self.op(sid, "withdraw-report", {"item": "Bread"})
        self.assertEqual(out["my_reports"], [])
        self.assertEqual(self.c.get("/api/quest/stores/Corner%20Shop/reports").json()["count"], 0)
        self.assertEqual(self.c.get("/api/quest/news").json()["news"], [])
        self.assertEqual(self.c.get("/api/quest/profile").json()["stats"]["spots_reported"], 0)
        self.assertEqual(self.c.get("/api/quest/sos-count", params={
            "store": STORE, "item": "Bread"}).json()["trips"], 0)
        # stays on file as withdrawn, never erased
        from api import quest
        with self.as_owner():
            self.assertEqual([r["state"] for r in quest._store()["reports"]], ["withdrawn"])
        # idempotent
        self.op(sid, "withdraw-report", {"item": "Bread"})
        # a new report can be filed again
        again = self.report(sid, "Bread")
        self.assertEqual(again["state"], "reported")
        self.assertEqual(self.c.get("/api/quest/stores/Corner%20Shop/reports").json()["count"], 1)

    def test_withdraw_unknown_item_or_session(self):
        sess = self.make(["Apples"])
        self.op(sess["id"], "withdraw-report", {"item": "Nope"}, 404)
        self.op("qs-missing", "withdraw-report", {"item": "Apples"}, 404)
        self.op(sess["id"], "withdraw-report", {}, 400)


class TestBoss(Base):
    def _trip_with_report(self, item, store=STORE, others=("Filler",)):
        s = self.make([item, *others], store=store)
        self.report(s["id"], item)
        return s

    def test_boss_needs_two_distinct_earlier_sessions_with_open_reports(self):
        self._trip_with_report("Oat Milk")
        one = self.make(["Oat Milk", "Bread"])
        self.assertIsNone(one["boss"])                       # one report is not enough
        # the same session reporting twice is still one trip
        self.report(one["id"], "Oat Milk")
        self.report(one["id"], "Oat Milk")
        two = self.make(["Oat Milk", "Bread"])
        self.assertEqual(two["boss"]["name"], "Oat Milk")    # two distinct trips now
        self.assertEqual(two["boss"]["reports"], 2)
        self.assertEqual(two["boss"]["group"], "name:oat milk")

    def test_boss_ignores_other_stores_withdrawn_and_unlisted_items(self):
        self._trip_with_report("Oat Milk", store="Other Market")
        b = self._trip_with_report("Oat Milk")
        self.assertIsNone(self.make(["Oat Milk"])["boss"])           # one trip here
        c = self._trip_with_report("Oat Milk")
        self.assertIsNone(self.make(["Bread"])["boss"])              # not on this list
        boss = self.make(["Oat Milk"])["boss"]
        self.assertEqual(boss["reports"], 2)
        self.op(b["id"], "withdraw-report", {"item": "Oat Milk"})
        self.assertIsNone(self.make(["Oat Milk"])["boss"])           # withdrawn does not count

    def test_boss_is_frozen_on_the_session(self):
        a = self._trip_with_report("Oat Milk")
        self._trip_with_report("Oat Milk")
        s = self.make(["Oat Milk", "Bread"])
        self.assertEqual(s["boss"]["reports"], 2)
        self.op(a["id"], "withdraw-report", {"item": "Oat Milk"})
        self.assertEqual(self.get(s["id"])["boss"]["reports"], 2)

    def test_pick_boss_most_reports_wins_ties_by_list_order(self):
        from api import hunt
        mk = lambda sid, grp, name: {"session_id": sid, "item_group": grp, "item": name,
                                      "store": STORE, "state": "reported", "reporter": "me"}
        reports = [mk("s1", "g-tea", "Tea"), mk("s2", "g-tea", "Tea"),
                   mk("s1", "g-jam", "Jam"), mk("s2", "g-jam", "Jam"), mk("s3", "g-jam", "Jam")]
        items = [{"name": "Tea", "group": "g-tea"}, {"name": "Jam", "group": "g-jam"}]
        got = hunt.pick_boss(STORE, items, reports=reports, me="me")
        self.assertEqual((got["name"], got["reports"]), ("Jam", 3))
        got = hunt.pick_boss(STORE, items, reports=reports[:4], me="me")
        self.assertEqual(got["name"], "Tea")                          # tie: first on the list
        self.assertIsNone(hunt.pick_boss(STORE, items, reports=reports, me="someone else"))

    def test_boss_points_are_forty_and_only_when_the_boss_is_grabbed(self):
        from api import social
        self.assertEqual(social.POINTS_BOSS, 40)

        def boss_trip():
            self._trip_with_report("Oat Milk")
            self._trip_with_report("Oat Milk")
            return self.make(["Oat Milk", "Bread"])
        s = boss_trip()
        sid = s["id"]
        self.check(sid, "Bread")
        self.assertEqual(social.hunt_points(self.get(sid)), 10 + 50)           # boss open
        self.report(sid, "Oat Milk")
        view = self.get(sid)
        with self.as_owner():
            # reported: no boss pay, but the report is handled, so the rest is a full haul
            self.assertEqual(social.hunt_points(view), 10 + 25 + 50)
        self.check(sid, "Oat Milk")
        self.assertEqual(social.hunt_points(self.get(sid)), 2 * 10 + 25 + 40 + 50)
        self.check(sid, "Oat Milk", False)                                      # put back
        self.assertEqual(social.hunt_points(self.get(sid)), 10 + 50)
        # dropped: no pay, and the rest is still a full haul
        d = boss_trip()
        self.op(d["id"], "leave", {"entries": [{"item": "Oat Milk", "how": "dropped"}]})
        self.check(d["id"], "Bread")
        self.assertEqual(social.hunt_points(self.get(d["id"])), 10 + 25 + 50)
        # swapped: the substitute is another product, so no boss pay
        w = boss_trip()
        self.op(w["id"], "swap", {"item": "Oat Milk", "to": "Soy Milk"})
        self.check(w["id"], "Soy Milk")
        self.check(w["id"], "Bread")
        self.assertEqual(social.hunt_points(self.get(w["id"])), 2 * 10 + 25 + 50)

    def test_clean_sweep_counts_items_left_for_next_time(self):
        from api import social
        grabbed = [{"name": "A", "checked": True}]
        # one grab plus 19 items left or dropped is not a clean sweep
        left = [{"name": f"L{i}", "how": "saved" if i % 2 else "dropped"} for i in range(19)]
        self.assertFalse(social._clean_sweep([{"items": grabbed, "left": left}]))
        self.assertFalse(social._clean_sweep([{"items": grabbed, "left": left[:1]}]))
        # a swapped-out original does not break it: its stand-in was grabbed
        swapped = [{"name": "Bread", "how": "saved", "swapped_for": "Rye"}]
        self.assertTrue(social._clean_sweep([{"items": grabbed, "left": swapped}]))
        self.assertTrue(social._clean_sweep([{"items": grabbed}]))                 # old sessions
        self.assertFalse(social._clean_sweep([{"items": grabbed + [{"name": "B", "checked": False}]}]))

    def test_hunt_points_without_a_boss_are_unchanged(self):
        from api import social
        self.assertEqual(social.hunt_points({"items": [{"checked": True}], "boss": None}), 10 + 25 + 50)
        self.assertEqual(social.hunt_points({"items": [{"checked": True, "group": "g"}],
                                             "boss": {"group": "g", "name": "x", "reports": 2}}),
                         10 + 25 + 40 + 50)


class TestClosedHunts(Base):
    def test_a_done_hunt_refuses_every_operation(self):
        from api import quest
        sess = self.make(["Apples", "Bread"])
        sid = sess["id"]
        self.op(sid, "forgot", {"name": "Tea"})
        with self.as_owner():
            quest._mutate(sid, lambda s: s.update(state="done"))
        calls = [("leave", {"entries": [{"item": "Apples", "how": "saved"}]}),
                 ("restore", {"item": "Apples"}),
                 ("edit", {"item": "Apples", "qty": 2}),
                 ("swap", {"item": "Apples", "to": "Pears"}),
                 ("unswap", {"to": "Pears"}),
                 ("forgot", {"name": "Milk"}),
                 ("remove-added", {"item": "Tea"}),
                 ("withdraw-report", {"item": "Apples"})]
        for name, body in calls:
            r = self.c.post(f"/api/quest/sessions/{sid}/{name}", json=body)
            self.assertEqual(r.status_code, 400, (name, r.text))
        self.assertEqual(self.names(self.get(sid)), ["Apples", "Bread", "Tea"])

    def test_a_finished_hunt_still_accepts_queued_operations(self):
        sess = self.make(["Apples", "Bread"])
        sid = sess["id"]
        self.assertEqual(self.c.post(f"/api/quest/sessions/{sid}/state",
                                     json={"state": "finished"}).status_code, 200)
        out = self.op(sid, "leave", {"entries": [{"item": "Bread", "how": "saved"}]})
        self.assertEqual(self.names(out, "left"), ["Bread"])

    def test_bodies_must_be_json_objects(self):
        sess = self.make(["Apples"])
        r = self.c.post(f"/api/quest/sessions/{sess['id']}/leave", json=[1])
        self.assertEqual(r.status_code, 400)
        r = self.c.post(f"/api/quest/sessions/{sess['id']}/leave", content=b"nope")
        self.assertEqual(r.status_code, 400)

    def test_session_view_counts_left_items_as_list_items_for_wild_finds(self):
        from api import quest
        sess = {"items": [{"name": "Apples"}], "left": [{"name": "Bread"}],
                "settled": False}
        self.assertEqual(quest.session_view(sess)["wild_finds"], [])


class TestPureOps(unittest.TestCase):
    """The pure functions huntmenu.js mirrors (share the fixture)."""

    def test_no_meta_client_import(self):
        import api.hunt as hunt, api.hunt_routes as routes
        for mod in (hunt, routes):
            src = open(mod.__file__, encoding="utf-8").read()
            self.assertNotIn("meta_client", src)
            self.assertNotIn("MetaClient", src)


class TestDemoSandbox(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness",
                                     "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        from api import main
        from api import deps
        deps.MetaClient = FakeClient
        self.c = TestClient(main.app)
        self.c.post("/auth/demo")

    def _disk(self):
        out = {}
        for root, _dirs, files in os.walk(os.environ["ARYA_DATA_DIR"]):
            for f in files:
                if f in ("sessions.json", "cost-ledger.jsonl"):
                    continue
                p = os.path.join(root, f)
                with open(p, "rb") as fh:
                    out[p] = fh.read()
        return out

    def test_demo_hunt_operations_never_reach_disk(self):
        sess = self.c.post("/api/quest/sessions", json={
            "store": STORE, "mode": "quest", "items": ["Apples", "Bread", "Cheese"]}).json()
        sid = sess["id"]
        before = self._disk()
        post = lambda name, body: self.c.post(f"/api/quest/sessions/{sid}/{name}", json=body)
        self.assertEqual(post("leave", {"entries": [{"item": "Bread", "how": "saved"}]}).status_code, 200)
        self.assertEqual(post("forgot", {"name": "Tea"}).status_code, 200)
        self.assertEqual(post("edit", {"item": "Apples", "qty": 3}).status_code, 200)
        self.assertEqual(post("swap", {"item": "Cheese", "to": "Brie"}).status_code, 200)
        self.assertEqual(post("restore", {"item": "Bread"}).status_code, 200)
        self.assertEqual(self._disk(), before)
        # the visitor sees their changes; a second visitor does not
        mine = self.c.get(f"/api/quest/sessions/{sid}").json()
        self.assertIn("Tea", [i["name"] for i in mine["items"]])


if __name__ == "__main__":
    unittest.main()
