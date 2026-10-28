"""Stage E: the store directory (platform plane) + My Stores and
favorites (account plane), search, add-with-address, and the
session store_id snapshot. All deterministic code — no model calls.
"""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        raise AssertionError("Store paths must not call a model")


def make_client(case):
    from api import main
    main.MetaClient = FakeClient
    main._login_fails.clear()
    case.c = TestClient(main.app)
    case.main = main
    return case.c


def setup_account(case, username="owner@example.com"):
    r = case.c.post("/auth/setup", json={"username": username,
                                         "password": "long-password"})
    assert r.status_code == 200, r.text


class TestStoreDirectory(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        setup_account(self)

    def search(self, q, quests=None):
        params = {"q": q}
        if quests:
            params["quests"] = 1
        r = self.c.get("/api/stores/search", params=params)
        assert r.status_code == 200, r.text
        return r.json()["stores"]

    def test_seeds_are_in_the_directory(self):
        rows = self.search("")
        names = {s["name"] for s in rows}
        assert {"Trader Joe's", "Costco Wholesale",
                "Sprouts Farmers Market", "Los Serranos Market"} <= names
        tj = next(s for s in rows if s["name"] == "Trader Joe's")
        assert tj["street"] == "13911 Peyton Dr"
        assert tj["city"] == "Chino Hills" and tj["state"] == "CA"
        assert tj["zip"] == "91709" and tj["scene"] == "cloud"
        assert tj["created_by"] == "seed"

    def test_search_by_name_street_city(self):
        assert [s["name"] for s in self.search("trader")] == ["Trader Joe's"]
        assert self.search("peyton")
        assert {s["zip"] for s in self.search("chino hills")} == {"91709"}
        assert self.search("no such place") == []

    def test_search_by_zip_exact_and_prefix(self):
        assert len(self.search("91709")) == 4
        assert len(self.search("917")) == 4
        assert self.search("90210") == []

    def test_search_quests_filter_keeps_cloud_only(self):
        rows = self.search("", quests=1)
        assert [s["name"] for s in rows] == ["Trader Joe's"]
        assert all(s["scene"] == "cloud" for s in rows)

    def test_search_rows_carry_mine_flags(self):
        rows = {s["name"]: s for s in self.search("91709")}
        assert rows["Trader Joe's"]["in_mine"] is True
        assert rows["Trader Joe's"]["favorite"] is True
        assert rows["Sprouts Farmers Market"]["favorite"] is False


class TestMyStores(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        setup_account(self)

    def mine(self):
        r = self.c.get("/api/stores/mine")
        assert r.status_code == 200, r.text
        return r.json()["stores"]

    def test_mine_starts_with_seeds_favorites_first(self):
        rows = self.mine()
        assert len(rows) == 4
        favs = [s["name"] for s in rows if s["favorite"]]
        assert favs == ["Costco Wholesale", "Trader Joe's"]  # name order
        assert [s["favorite"] for s in rows] == [True, True, False, False]
        assert all(s["in_mine"] for s in rows)

    def test_favorite_toggle(self):
        sprouts = next(s for s in self.mine()
                       if s["name"] == "Sprouts Farmers Market")
        r = self.c.post("/api/stores/favorite",
                        json={"store_id": sprouts["id"], "favorite": True})
        assert r.status_code == 200, r.text
        assert r.json()["favorite"] is True
        rows = self.mine()
        assert rows[0]["name"] == "Sprouts Farmers Market" or \
            any(s["favorite"] and s["name"] == "Sprouts Farmers Market"
                for s in rows[:3])
        r = self.c.post("/api/stores/favorite",
                        json={"store_id": sprouts["id"], "favorite": False})
        assert r.json()["favorite"] is False

    def test_add_to_mine_is_idempotent(self):
        # A store created by another account is in the directory but
        # not in mine until I add it.
        from api import auth
        auth.create_user("two@example.com", "long-password")
        c2 = TestClient(self.main.app)
        r = c2.post("/auth/login", json={"username": "two@example.com",
                                         "password": "long-password"})
        assert r.status_code == 200, r.text
        r = c2.post("/api/stores", json={
            "name": "Pavillions", "street": "100 Main St",
            "city": "Chino Hills", "state": "CA", "zip": "91709"})
        assert r.status_code == 200, r.text
        new_id = r.json()["id"]
        assert all(s["id"] != new_id for s in self.mine())
        r = self.c.post("/api/stores/mine", json={"store_id": new_id})
        assert r.status_code == 200 and r.json()["in_mine"] is True
        r = self.c.post("/api/stores/mine", json={"store_id": new_id})
        assert r.status_code == 200
        assert [s["id"] for s in self.mine()].count(new_id) == 1

    def test_add_to_mine_unknown_store_404(self):
        r = self.c.post("/api/stores/mine", json={"store_id": "store-nope"})
        assert r.status_code == 404

    def test_favorite_requires_mine(self):
        # A directory store that is not in my stores cannot be starred.
        from api import auth
        auth.create_user("two@example.com", "long-password")
        c2 = TestClient(self.main.app)
        c2.post("/auth/login", json={"username": "two@example.com",
                                     "password": "long-password"})
        r = c2.post("/api/stores", json={
            "name": "Vons", "street": "200 Main St", "city": "Chino",
            "state": "CA", "zip": "91710"})
        new_id = r.json()["id"]
        r = self.c.post("/api/stores/favorite",
                        json={"store_id": new_id, "favorite": True})
        assert r.status_code == 404


class TestCreateStore(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        setup_account(self)

    def test_create_adds_to_directory_and_mine(self):
        r = self.c.post("/api/stores", json={
            "name": "H Mart", "street": "300 Grand Ave", "city": "Diamond Bar",
            "state": "ca", "zip": "91765"})
        assert r.status_code == 200, r.text
        row = r.json()
        assert row["scene"] == "strip" and row["in_mine"] is True
        assert row["state"] == "CA" and row["zip"] == "91765"
        assert row["created_by"] == "owner@example.com"
        found = self.c.get("/api/stores/search",
                           params={"q": "91765"}).json()["stores"]
        assert [s["name"] for s in found] == ["H Mart"]

    def test_create_dedupes_on_name_and_zip(self):
        body = {"name": "H Mart", "street": "300 Grand Ave",
                "city": "Diamond Bar", "state": "CA", "zip": "91765"}
        first = self.c.post("/api/stores", json=body).json()
        again = self.c.post("/api/stores", json={
            **body, "name": "h  mart", "street": "999 Other St"}).json()
        assert again["id"] == first["id"]
        rows = self.c.get("/api/stores/search",
                          params={"q": "91765"}).json()["stores"]
        assert len(rows) == 1
        # the original row wins — the second street was not written
        assert rows[0]["street"] == "300 Grand Ave"

    def test_create_validates_fields(self):
        r = self.c.post("/api/stores", json={
            "name": "No Zip Mart", "street": "1 A St", "city": "Chino",
            "state": "CA", "zip": "917"})
        assert r.status_code == 400
        r = self.c.post("/api/stores", json={
            "name": "", "street": "1 A St", "city": "Chino",
            "state": "CA", "zip": "91709"})
        assert r.status_code == 400


class TestSessionStoreSnapshot(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        setup_account(self)

    def test_session_with_store_id_snapshots(self):
        rows = self.c.get("/api/stores/search",
                          params={"q": "trader"}).json()["stores"]
        tj = rows[0]
        r = self.c.post("/api/quest/sessions", json={
            "store_id": tj["id"], "mode": "quest",
            "items": [{"name": "milk", "qty": 1}]})
        assert r.status_code == 200, r.text
        sess = r.json()
        assert sess["store"] == "Trader Joe's"
        assert sess["store_id"] == tj["id"]
        assert sess["store_address"] == \
            "13911 Peyton Dr, Chino Hills, CA 91709"

    def test_session_with_unknown_store_id_404(self):
        r = self.c.post("/api/quest/sessions", json={
            "store_id": "store-nope", "mode": "quest", "items": []})
        assert r.status_code == 404

    def test_free_text_session_unchanged(self):
        r = self.c.post("/api/quest/sessions", json={
            "store": "Corner Shop", "mode": "express", "items": []})
        assert r.status_code == 200, r.text
        sess = r.json()
        assert sess["store"] == "Corner Shop"
        assert "store_id" not in sess and "store_address" not in sess


class TestDemoStoreWritesBlocked(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        r = self.c.post("/auth/demo")
        assert r.status_code == 200, r.text

    def test_demo_reads_but_cannot_write(self):
        assert self.c.get("/api/stores/search",
                          params={"q": "91709"}).status_code == 200
        assert self.c.get("/api/stores/mine").status_code == 200
        assert self.c.post("/api/stores", json={
            "name": "X", "street": "1 A St", "city": "Chino",
            "state": "CA", "zip": "91709"}).status_code == 403
        assert self.c.post("/api/stores/mine",
                           json={"store_id": "seed-costco-91709"}).status_code == 403
        assert self.c.post("/api/stores/favorite", json={
            "store_id": "seed-costco-91709",
            "favorite": False}).status_code == 403


class TestStoreShell(unittest.TestCase):
    """The Stage E screens exist in the shell and the pick is wired
    to the API: favorites first, addresses shown, drawn-SVG stars."""

    def read(self, name):
        pwa = os.path.join(os.path.dirname(__file__), "..", "pwa")
        with open(os.path.join(pwa, name), encoding="utf-8") as fh:
            return fh.read()

    def test_store_views_exist(self):
        html = self.read("index.html")
        for vid in ("view-store", "view-stores-find", "view-stores-mine",
                    "view-stores-add"):
            self.assertIn(f'id="{vid}"', html)
        for fid in ("sf-q", "sf-chips", "sf-results", "sm-list",
                    "sa-name", "sa-street", "sa-city", "sa-state",
                    "sa-zip", "st-mine"):
            self.assertIn(f'id="{fid}"', html)
        # the old free-text-only chips are gone from the pick
        self.assertNotIn('id="st-chips"', html)
        # Profile carries the Stores navrow
        self.assertIn('data-qnav="view-stores-mine"', html)

    def test_pick_and_views_use_the_api(self):
        js = self.read("quest.js")
        for path in ("/api/stores/mine", "/api/stores/search",
                     "/api/stores/favorite", "/api/stores\""):
            self.assertIn(path, js)
        self.assertIn("store_id: Q.draft.storeId", js)
        self.assertIn("Favorites", js)
        # the star is a drawn SVG path, never an emoji
        self.assertIn("<svg", js)
        self.assertNotIn("⭐", js)

    def test_sw_cache_bumped(self):
        self.assertIn('arya-v32', self.read("sw.js"))


if __name__ == "__main__":
    unittest.main()
