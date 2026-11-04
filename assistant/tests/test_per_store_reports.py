"""Not here is store specific (owner, 2026-11-04: ""Not here" should be
store specific only"): a shared report belongs to the store location
the trip started from (its directory id), so Trader Joe's Milpitas
being out of eggs says nothing about Trader Joe's Sunnyvale. Reports
filed before the change were keyed by chain; they keep matching every
branch of that chain until they expire (3 days), so open alerts stay."""
import datetime
import unittest
from unittest import mock

from tests.test_shared_reports import Base

MILPITAS = {"id": "gplace-milpitas", "name": "Trader Joe's", "street": "160 Ranch Dr", "city": "Milpitas"}
SUNNYVALE = {"id": "gplace-sunnyvale", "name": "Trader Joe's", "street": "727 Sunnyvale Saratoga Rd", "city": "Sunnyvale"}


class PerStore(Base):
    def at(self, user, place, item="Eggs"):
        self.as_(user)
        return self.sr.add(place["name"], item, None, "empty_shelf", store_id=place["id"])

    def three_at(self, place, item="Eggs"):
        for u in ("a@x.com", "b@x.com", "c@x.com"):
            self.at(u, place, item)

    def legacy(self, item="egg", users=("a@x.com", "b@x.com", "c@x.com"), age_s=0):
        """Rows as written before 2026-11-04: keyed by chain."""
        now = self.sr._now() - datetime.timedelta(seconds=age_s)
        with self.sr._locked():
            doc = self.sr._load()
            for u in users:
                self.as_(u)
                doc.setdefault("trader-joes", []).append(
                    {"store_key": "trader-joes", "item_key": item, "kind": "empty_shelf",
                     "at": self.sr._iso(now), "by": self.sr.who()})
            self.sr._save(doc)

    def news(self, places, wanted=("Eggs",), user="me@x.com"):
        self.as_(user)
        names = {self.q._match_name(n): n for n in wanted}
        with mock.patch.object(self.q, "_my_list_names", return_value=names), \
                mock.patch.object(self.q, "_my_store_names", return_value=[p["name"] for p in places]), \
                mock.patch.object(self.q, "_my_store_places", return_value={p["id"]: p for p in places}):
            return self.q.store_news()["news"]


class TestLocation(PerStore):
    def test_another_branch_of_the_chain_hears_nothing(self):
        self.three_at(MILPITAS)
        self.assertEqual(self.news([SUNNYVALE]), [])

    def test_the_same_branch_hears_it_with_its_address(self):
        self.three_at(MILPITAS)
        news = self.news([MILPITAS])
        self.assertEqual(len(news), 1)
        self.assertEqual(news[0]["store"], "Trader Joe's")
        self.assertEqual(news[0]["store_id"], "gplace-milpitas")
        self.assertEqual(news[0]["store_city"], "Milpitas")
        self.assertEqual(news[0]["id"], "@gplace-milpitas|egg")

    def test_two_of_my_branches_each_get_their_own_alert(self):
        self.three_at(MILPITAS)
        self.three_at(SUNNYVALE)
        news = self.news([MILPITAS, SUNNYVALE])
        self.assertEqual(sorted(n["store_id"] for n in news), ["gplace-milpitas", "gplace-sunnyvale"])

    def test_quorum_counts_per_branch(self):
        for u in ("a@x.com", "b@x.com"):
            self.at(u, MILPITAS)
        self.at("c@x.com", SUNNYVALE)
        self.assertEqual(self.news([MILPITAS, SUNNYVALE]), [])

    def test_a_hidden_branch_alert_stays_hidden(self):
        self.three_at(MILPITAS)
        self.as_("me@x.com")
        self.assertTrue(self.q.hide_news("@gplace-milpitas|egg"))
        self.state._save(self.q.NEWS_SEEN, {})
        self.assertEqual(self.news([MILPITAS]), [])

    def test_found_at_one_branch_clears_only_that_branch(self):
        self.three_at(MILPITAS)
        self.three_at(SUNNYVALE)
        self.as_("me@x.com")
        self.sr.found("Trader Joe's", "Eggs", None, store_id="gplace-milpitas")
        self.assertEqual(self.sr.groups("Trader Joe's", store_id="gplace-milpitas"), [])
        self.assertEqual(len(self.sr.groups("Trader Joe's", store_id="gplace-sunnyvale")), 1)

    def test_no_location_is_not_shared(self):
        self.as_("a@x.com")
        self.assertIsNone(self.sr.add("Trader Joe's", "Eggs", None, "empty_shelf"))
        self.assertEqual(self.sr._load(), {})


class TestOlderChainReports(PerStore):
    def test_an_open_chain_report_still_reaches_every_branch(self):
        self.legacy()
        self.assertEqual(len(self.news([SUNNYVALE])), 1)
        self.assertEqual(self.news([SUNNYVALE])[0]["store"], "Trader Joe's")

    def test_it_expires_as_before(self):
        self.legacy(age_s=3 * 86400 + 5)
        self.assertEqual(self.news([SUNNYVALE]), [])

    def test_no_double_alert_beside_the_branch_report(self):
        self.legacy()
        self.three_at(MILPITAS)
        news = self.news([MILPITAS])
        self.assertEqual([n["id"] for n in news], ["@gplace-milpitas|egg"])

    def test_one_store_folds_both(self):
        # Two older chain reports and one at this branch make the quorum.
        self.legacy(users=("a@x.com", "b@x.com"))
        self.at("c@x.com", MILPITAS)
        self.as_("me@x.com")
        g = self.sr.groups("Trader Joe's", store_id="gplace-milpitas")
        self.assertEqual([(x["store_key"], x["count"]) for x in g], [("@gplace-milpitas", 3)])

    def test_found_at_a_branch_clears_the_chain_report_too(self):
        self.legacy()
        self.as_("me@x.com")
        self.sr.found("Trader Joe's", "Eggs", None, store_id="gplace-milpitas")
        self.assertEqual(self.sr._load(), {})

    def test_a_typed_store_name_still_sees_the_chain_report(self):
        self.legacy()
        self.as_("me@x.com")
        with mock.patch.object(self.q, "_my_list_names", return_value={"egg": "Eggs"}):
            reps = self.q.store_reports("Trader Joe's")["reports"]
        self.assertEqual([r["item"] for r in reps], ["Eggs"])


class TestHuntFlags(PerStore):
    def test_store_reports_is_per_branch(self):
        self.three_at(MILPITAS)
        self.as_("me@x.com")
        with mock.patch.object(self.q, "_my_list_names", return_value={"egg": "Eggs"}):
            here = self.q.store_reports("Trader Joe's", store_id="gplace-milpitas")["reports"]
            there = self.q.store_reports("Trader Joe's", store_id="gplace-sunnyvale")["reports"]
        self.assertEqual([r["item"] for r in here], ["Eggs"])
        self.assertEqual(there, [])

    def test_my_own_report_flags_only_its_branch(self):
        self.as_("me@x.com")
        with self.state.file_lock("quest.json"):
            s = self.q._store()
            s["reports"].append({"id": "rep-1", "session_id": "s1", "store": "Trader Joe's",
                                 "store_id": "gplace-sunnyvale", "item": "Milk", "item_group": "milk",
                                 "kind": "empty_shelf", "state": "reported", "reported_at": "x"})
            self.q._save_store(s)
        with mock.patch.object(self.q, "_my_list_names", return_value={}):
            self.assertEqual(self.q.store_reports("Trader Joe's", store_id="gplace-milpitas")["count"], 0)
            self.assertEqual(self.q.store_reports("Trader Joe's", store_id="gplace-sunnyvale")["count"], 1)
            self.assertEqual(self.q.store_reports("Trader Joe's")["count"], 1)  # typed name: as before


if __name__ == "__main__":
    unittest.main()
