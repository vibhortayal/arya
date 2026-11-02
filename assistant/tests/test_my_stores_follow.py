"""My stores follows where you shop (owner, 2026-11-02): a store linked
to a list, or a receipt's store once it is in the directory, joins My
stores; a one-time backfill catches stores linked before this shipped;
a store the shopper removed is never put back that way."""
import os, tempfile, unittest
from unittest import mock

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from tests.test_stores import make_client, setup_account  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        setup_account(self)
        from api import stores
        self.vons, _ = stores.create_store("Vons", "1 Main St", "Pomona", "CA", "91766", "test")
        self.ralphs, _ = stores.create_store("Ralphs", "2 Main St", "Pomona", "CA", "91766", "test")

    def me(self):
        from api import state
        return state.as_user("owner@example.com")

    def mine(self):
        r = self.c.get("/api/stores/mine")
        self.assertEqual(r.status_code, 200, r.text)
        return {s["id"] for s in r.json()["stores"]}

    def remove(self, sid):
        r = self.c.post("/api/stores/mine/remove", json={"store_id": sid})
        self.assertEqual(r.status_code, 200, r.text)

    def link(self, sids, name="Weekly"):
        r = self.c.post("/api/lists", json={"name": name, "stores": ["x"], "store_ids": sids})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()


class TestListsAndReceipts(Base):
    def test_a_store_linked_to_a_new_list_joins(self):
        self.assertNotIn(self.vons["id"], self.mine())
        self.link([self.vons["id"]])
        self.assertIn(self.vons["id"], self.mine())

    def test_a_store_linked_on_edit_joins(self):
        l = self.link([])
        r = self.c.post("/api/lists/update", json={"id": l["id"], "stores": ["Ralphs"], "store_ids": [self.ralphs["id"]]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn(self.ralphs["id"], self.mine())

    def test_a_removed_store_is_never_put_back(self):
        self.link([self.vons["id"]])
        self.remove(self.vons["id"])
        self.link([self.vons["id"]], name="Another")
        self.assertNotIn(self.vons["id"], self.mine())
        # Adding it by hand brings it back for good.
        self.c.post("/api/stores/mine", json={"store_id": self.vons["id"]})
        self.assertIn(self.vons["id"], self.mine())
        self.link([self.vons["id"]], name="Third")
        self.assertIn(self.vons["id"], self.mine())

    def test_unknown_store_ids_are_ignored(self):
        self.link(["no-such-store"])
        self.assertNotIn("no-such-store", self.mine())

    def test_a_receipt_store_in_the_directory_joins(self):
        from api import stores, places
        self.mine()  # backfill done first, so only the receipt adds it
        with mock.patch.object(places, "provisioned", return_value=False), self.me():
            stores.resolve_merchants(["VONS POMONA #2105"])
        self.assertIn(self.vons["id"], self.mine())

    def test_a_removed_receipt_store_stays_out(self):
        from api import stores, places
        self.mine()
        self.remove(self.seed)
        with mock.patch.object(places, "provisioned", return_value=False), self.me():
            stores.resolve_merchants(["SPROUTS CHINO HILLS"])
        self.assertNotIn(self.seed, self.mine())

    seed = "seed-sprouts-91709"


class TestBackfill(Base):
    def test_old_links_and_receipts_join_once(self):
        from api import stores, state
        with mock.patch.object(stores, "follow", return_value=[]):
            self.link([self.vons["id"]])  # linked before this shipped
        self.remove("seed-sprouts-91709")
        receipts = [{"merchant": "RALPHS POMONA"}, {"merchant": "SPROUTS CHINO HILLS"}]
        with mock.patch.object(state, "own_receipts", return_value=receipts):
            got = self.mine()
        self.assertIn(self.vons["id"], got)
        self.assertIn(self.ralphs["id"], got)
        self.assertNotIn("seed-sprouts-91709", got)  # removed stays out
        # Once only: a store removed afterwards is not backfilled again.
        self.remove(self.vons["id"])
        self.assertNotIn(self.vons["id"], self.mine())

    def test_favorites_survive_the_backfill(self):
        self.c.post("/api/stores/favorite", json={"store_id": "seed-sprouts-91709", "favorite": True})
        self.link([self.vons["id"]])
        rows = {s["id"]: s for s in self.c.get("/api/stores/mine").json()["stores"]}
        self.assertTrue(rows["seed-trader-joes-91709"]["favorite"])


if __name__ == "__main__":
    unittest.main()
