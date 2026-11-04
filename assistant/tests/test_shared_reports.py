"""Shared "Not here" reports (owner, 2026-11-03): other shoppers see a
report only past the quorum, only for items on their list at stores
they use, folded per store and item, never their own, and an alert
shows once until a newer report arrives."""
import os
import tempfile
import unittest
from unittest import mock

from fastapi.testclient import TestClient


class Base(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ.pop("ARYA_REPORT_QUORUM", None)
        from api import quest, shared_reports, state
        self.q, self.sr, self.state = quest, shared_reports, state
        self.addCleanup(state.set_current_user, None)

    def as_(self, user):
        self.state.set_current_user(user)

    def loc(self, store):
        """A test store location: one directory id per store family, so
        "Costco" and "COSTCO WHSE #0423" are the same branch here."""
        return "loc-" + self.sr.store_key(store)

    def report(self, user, item="Oat Milk", store="Costco"):
        self.as_(user)
        return self.sr.add(store, item, "name:" + item.lower(), "empty_shelf",
                           store_id=self.loc(store))

    def news_for(self, user, wanted=("Oat milk",), stores=("Costco",)):
        self.as_(user)
        names = {self.q._match_name(n): n for n in wanted}
        places = {self.loc(s): {"id": self.loc(s), "name": s, "street": "1 Main St", "city": "Town"}
                  for s in stores}
        with mock.patch.object(self.q, "_my_list_names", return_value=names), \
                mock.patch.object(self.q, "_my_store_names", return_value=list(stores)), \
                mock.patch.object(self.q, "_my_store_places", return_value=places):
            return self.q.store_news()["news"]


class TestQuorum(Base):
    def test_two_shoppers_are_hidden_three_are_shown(self):
        self.report("a@x.com")
        self.report("b@x.com")
        self.assertEqual(self.news_for("me@x.com"), [])
        self.report("c@x.com")
        news = self.news_for("me@x.com")
        self.assertEqual(len(news), 1)
        self.assertEqual(news[0]["count"], 3)
        self.assertEqual(news[0]["item"], "Oat milk")        # my own words, not the reporter's

    def test_one_account_reporting_three_times_is_hidden(self):
        for _ in range(3):
            self.report("a@x.com")
        self.as_("a@x.com")
        self.report("a@x.com", store="COSTCO WHSE #0423")   # same store family
        self.assertEqual(len(self.sr._load()["@loc-costco"]), 1)
        self.assertEqual(self.news_for("me@x.com"), [])

    def test_quorum_is_a_setting(self):
        os.environ["ARYA_REPORT_QUORUM"] = "2"
        self.addCleanup(os.environ.pop, "ARYA_REPORT_QUORUM", None)
        self.report("a@x.com")
        self.report("b@x.com")
        self.assertEqual(self.news_for("me@x.com")[0]["count"], 2)

    def test_count_is_distinct_shoppers_including_a_reporter_who_reads(self):
        for u in ("a@x.com", "b@x.com", "me@x.com"):
            self.report(u)
        # Quorum met with me in it; the alert is about the others, but
        # the number is the honest total of distinct shoppers.
        news = self.news_for("me@x.com")
        self.assertEqual(news[0]["count"], 3)


class TestRelevance(Base):
    def setUp(self):
        super().setUp()
        for u in ("a@x.com", "b@x.com", "c@x.com"):
            self.report(u)

    def test_only_items_on_my_list(self):
        self.assertEqual(self.news_for("me@x.com", wanted=["Eggs"]), [])
        self.assertEqual(self.news_for("me@x.com", wanted=[]), [])

    def test_names_match_across_accounts(self):
        # Reported as "Oat Milk" at "Costco"; on my list as "oat-milks",
        # my store saved as "Costco Wholesale #12".
        news = self.news_for("me@x.com", wanted=["oat-milks"], stores=["Costco Wholesale #12"])
        self.assertEqual([(n["item"], n["store"]) for n in news], [("oat-milks", "Costco Wholesale #12")])

    def test_only_stores_i_use(self):
        self.assertEqual(self.news_for("me@x.com", stores=["Trader Joe's"]), [])
        self.assertEqual(len(self.news_for("me@x.com", stores=["COSTCO"])), 1)

    def test_my_own_report_never_alerts_me(self):
        self.report("solo@x.com", item="Eggs")
        self.report("solo@x.com", item="Eggs", store="costco")
        self.assertEqual(self.news_for("solo@x.com", wanted=["Eggs"]), [])

    def test_shown_once_until_a_newer_report(self):
        self.assertEqual(len(self.news_for("me@x.com")), 1)
        self.assertEqual(len(self.news_for("me@x.com")), 1)     # same window
        doc = self.state._load(self.q.NEWS_SEEN, {})
        for v in doc.values():
            v["first"] = "2000-01-01T00:00:00Z"
        self.state._save(self.q.NEWS_SEEN, doc)
        self.assertEqual(self.news_for("me@x.com"), [])          # quiet now
        with mock.patch.object(self.sr, "_now", return_value=self.sr._now().replace(microsecond=0)
                               + __import__("datetime").timedelta(seconds=5)):
            self.report("d@x.com")
        news = self.news_for("me@x.com")
        self.assertEqual(len(news), 1)                           # a newer report
        self.assertEqual(news[0]["count"], 4)

    def test_rows_carry_no_account_detail(self):
        self.as_("me@x.com")
        names = {"oat milk": "Oat milk"}
        with mock.patch.object(self.q, "_my_list_names", return_value=names):
            out = self.q.store_reports("Costco", store_id="loc-costco")["reports"]
        self.assertEqual(len(out), 1)
        self.assertEqual(set(out[0]), {"store", "item", "kind", "state", "reported_at", "shared", "count"})
        self.assertEqual(out[0]["count"], 3)
        with mock.patch.object(self.q, "_my_list_names", return_value={}):
            self.assertEqual(self.q.store_reports("Costco", store_id="loc-costco")["count"], 0)
        news = self.news_for("me@x.com")
        self.assertEqual(set(news[0]), {"store", "item", "kind", "count", "reported_at", "shared", "id",
                                         "store_id", "store_city"})
        self.assertEqual(news[0]["id"], "@loc-costco|oat milk")      # store and item keys, no account
        raw = self.sr._load()["@loc-costco"][0]
        self.assertEqual(set(raw), {"store_key", "item_key", "kind", "at", "by", "chain"})
        self.assertNotIn("@", raw["by"])


class TestHide(Base):
    """✕ on a store alert (owner, 2026-11-03): hidden for this account
    only, while that report is open; Undo brings it back."""
    def setUp(self):
        super().setUp()
        for u in ("a@x.com", "b@x.com", "c@x.com"):
            self.report(u)
        self.id = "@loc-costco|oat milk"

    def hide(self, user, hide=True):
        self.as_(user)
        return self.q.hide_news(self.id, hide)

    def fresh_window(self, user):
        # Past the 12-hour window, so only the hide decides what shows.
        self.as_(user)
        self.state._save(self.q.NEWS_SEEN, {})

    def test_hidden_for_me_only(self):
        self.assertTrue(self.hide("me@x.com"))
        self.assertEqual(self.news_for("me@x.com"), [])
        self.assertEqual(len(self.news_for("you@x.com")), 1)        # other shoppers still see it
        self.as_("me@x.com")
        self.assertEqual(len(self.sr._load()["@loc-costco"]), 3)          # the report itself is untouched

    def test_stays_hidden_as_more_shoppers_report(self):
        self.hide("me@x.com")
        import datetime
        with mock.patch.object(self.sr, "_now", return_value=self.sr._now() + datetime.timedelta(seconds=5)):
            self.report("d@x.com")
        self.fresh_window("me@x.com")
        self.assertEqual(self.news_for("me@x.com"), [])

    def test_undo_brings_it_back(self):
        self.hide("me@x.com")
        self.assertTrue(self.hide("me@x.com", hide=False))
        self.fresh_window("me@x.com")
        self.assertEqual(len(self.news_for("me@x.com")), 1)

    def test_forgotten_when_the_report_clears(self):
        self.hide("me@x.com")
        self.as_("me@x.com")
        self.sr.found("Costco", "Oat Milk", None, store_id="loc-costco")
        self.news_for("me@x.com")                                    # cleared: the hide is dropped
        self.assertEqual(self.state._load(self.q.NEWS_HIDDEN, {}), {})
        import datetime
        with mock.patch.object(self.sr, "_now", return_value=self.sr._now() + datetime.timedelta(seconds=5)):
            for u in ("a@x.com", "b@x.com", "c@x.com"):
                self.report(u)
        self.assertEqual(len(self.news_for("me@x.com")), 1)          # a fresh report shows again

    def test_a_report_reopened_after_a_quiet_clear_shows_again(self):
        # The report cleared and came back while I never opened Today:
        # every entry is newer than my hide, so it shows.
        import datetime
        self.hide("me@x.com")
        later = self.sr._now() + datetime.timedelta(days=4)
        with mock.patch.object(self.sr, "_now", return_value=later):
            for u in ("a@x.com", "b@x.com", "c@x.com"):
                self.report(u)
            self.fresh_window("me@x.com")
            self.assertEqual(len(self.news_for("me@x.com")), 1)

    def test_only_an_open_report_can_be_hidden(self):
        self.as_("me@x.com")
        self.assertFalse(self.q.hide_news("@loc-costco|eggs"))
        self.assertEqual(self.state._load(self.q.NEWS_HIDDEN, {}), {})

    def test_routes(self):
        from api import main, deps
        from tests.test_hunt_ops import FakeClient
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        c = TestClient(main.app)
        r = c.post("/auth/setup", json={"username": "owner@example.com", "password": "long-password"})
        self.assertEqual(r.status_code, 200, r.text)
        for u in ("a@x.com", "b@x.com", "c@x.com"):     # importing the app moved the data dir
            self.report(u)
        r = c.post("/api/quest/news/hide", json={"id": self.id})
        self.assertEqual(r.status_code, 200, r.text)
        f = os.path.join(self.state.user_dir("owner@example.com"), self.q.NEWS_HIDDEN)
        import json
        self.assertIn(self.id, json.load(open(f)))
        self.assertEqual(c.post("/api/quest/news/unhide", json={"id": self.id}).status_code, 200)
        self.assertEqual(json.load(open(f)), {})
        self.assertEqual(c.post("/api/quest/news/hide", json={"id": "@loc-costco|eggs"}).status_code, 404)
        self.assertEqual(c.post("/api/quest/news/hide", json={}).status_code, 422)


class TestLifetime(Base):
    def setUp(self):
        super().setUp()
        for u in ("a@x.com", "b@x.com", "c@x.com"):
            self.report(u)

    def test_expires_after_three_days(self):
        import datetime
        later = self.sr._now() + datetime.timedelta(days=3, seconds=1)
        with mock.patch.object(self.sr, "_now", return_value=later):
            self.as_("me@x.com")
            self.assertEqual(self.sr.groups("Costco", store_id="loc-costco"), [])

    def test_found_clears_for_everyone(self):
        self.as_("me@x.com")
        self.sr.found("costco", "oat milk", None, store_id="loc-costco")
        self.assertEqual(self.sr.groups("Costco", store_id="loc-costco"), [])

    def test_take_back_drops_only_mine_and_quorum_falls(self):
        self.as_("a@x.com")
        self.sr.take_back("Costco", "Oat Milk", "name:oat milk", store_id="loc-costco")
        self.assertEqual(len(self.sr._load()["@loc-costco"]), 2)
        self.as_("me@x.com")
        self.assertEqual(self.sr.groups("Costco", store_id="loc-costco"), [])

    def test_two_accounts_writing_both_survive(self):
        import threading
        def go(u):
            self.state.set_current_user(u)
            self.sr.add("Target", "Eggs", None, "empty_shelf", store_id="loc-target")
        ts = [threading.Thread(target=go, args=(f"t{i}@x.com",)) for i in range(8)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertEqual(len(self.sr._load()["@loc-target"]), 8)

    def test_daily_cap(self):
        self.as_("busy@x.com")
        for i in range(self.sr.PER_DAY):
            self.assertIsNotNone(self.sr.add("Costco", f"Item {i}", None, "empty_shelf", store_id="loc-costco"))
        self.assertIsNone(self.sr.add("Costco", "One more", None, "empty_shelf", store_id="loc-costco"))


class TestDemoSandbox(Base):
    def test_a_demo_visitors_report_stays_in_the_sandbox(self):
        for u in ("a@x.com", "b@x.com"):
            self.report(u)
        tok = self.state._overlay.set({})
        try:
            self.report("demo-visitor")
            self.assertEqual(len(self.sr._load()["@loc-costco"]), 3)   # the visit sees its own write
        finally:
            self.state._overlay.reset(tok)
        self.assertEqual(len(self.sr._load()["@loc-costco"]), 2)       # the real file never changed

    def test_a_demo_visitors_find_clears_nothing_on_disk(self):
        for u in ("a@x.com", "b@x.com", "c@x.com"):
            self.report(u)
        tok = self.state._overlay.set({})
        try:
            self.as_("demo-visitor")
            self.sr.found("Costco", "Oat Milk", None, store_id="loc-costco")
        finally:
            self.state._overlay.reset(tok)
        self.assertEqual(len(self.sr._load()["@loc-costco"]), 3)


class TestMatchName(Base):
    def test_normalized_with_plural_last_word(self):
        m = self.q._match_name
        self.assertEqual(m("Bananas"), m("banana"))
        self.assertEqual(m("Berries"), m("berry"))
        self.assertEqual(m("  OAT-milk "), m("oat milk"))
        self.assertEqual(m("Peaches"), m("peach"))
        self.assertNotEqual(m("Greek Yogurt 32 oz"), m("Greek Yogurt"))

    def test_list_filter_reads_unchecked_on_list_items(self):
        d = {"smart_list": {"items": [
            {"name": "Bananas", "on_list": True},
            {"name": "Eggs", "on_list": True, "checked": True},
            {"name": "Milk", "on_list": False}]}}
        with mock.patch.object(self.state, "derived", return_value=d):
            self.assertEqual(self.q._my_list_names(), {"banana": "Bananas"})


class TestThroughTheApp(unittest.TestCase):
    """A real trip's Not here lands in the shared file, a check-off
    clears it."""
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps, shelfmatch
        from tests.test_hunt_ops import FakeClient
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "owner@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text
        p = mock.patch.object(shelfmatch, "model_match", side_effect=AssertionError("no model call"))
        p.start()
        self.addCleanup(p.stop)

    def test_report_shares_and_check_off_clears(self):
        from api import shared_reports
        sid = self.c.post("/api/quest/sessions", json={
            "store_id": "seed-trader-joes-91709", "mode": "quest", "items": ["Bread"]}).json()["id"]
        r = self.c.post(f"/api/quest/sessions/{sid}/report-missing",
                        json={"item": "Bread", "kind": "empty_shelf"})
        self.assertEqual(r.status_code, 200, r.text)
        key = "@seed-trader-joes-91709"
        self.assertEqual(len(shared_reports._load().get(key, [])), 1)
        r = self.c.post(f"/api/quest/sessions/{sid}/check", json={"item": "Bread", "checked": True})
        self.assertEqual(shared_reports._load().get(key), None)

    def test_a_typed_store_is_not_shared(self):
        # No directory store, no location: the report stays in this
        # account only (owner, 2026-11-04: store specific only).
        from api import shared_reports
        sid = self.c.post("/api/quest/sessions", json={
            "store": "Corner Shop", "mode": "quest", "items": ["Bread"]}).json()["id"]
        r = self.c.post(f"/api/quest/sessions/{sid}/report-missing",
                        json={"item": "Bread", "kind": "empty_shelf"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(shared_reports._load(), {})


if __name__ == "__main__":
    unittest.main()
