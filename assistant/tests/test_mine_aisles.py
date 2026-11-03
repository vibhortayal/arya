"""Map my store labels (owner, 2026-11-03): "N aisles mapped" only when
that store's map really has aisles; each of My stores carries the count."""
import os, tempfile, unittest

os.environ.setdefault("ARYA_INSECURE_COOKIE", "1")
from fastapi.testclient import TestClient


class TestMineAisles(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "owner@example.com", "password": "long-password"})
        self.assertEqual(r.status_code, 200, r.text)

    def mine(self):
        return {s["name"]: s for s in self.c.get("/api/stores/mine").json()["stores"]}

    def test_count_follows_the_map(self):
        sid = self.c.get("/api/stores/search?q=91709").json()["stores"][0]
        self.assertEqual(self.c.post("/api/stores/mine", json={"store_id": sid["id"]}).status_code, 200)
        self.assertEqual(self.mine()[sid["name"]]["aisles"], 0)
        for label in ("Aisle 1", "Aisle 2"):
            r = self.c.post("/api/storemap/segments", json={"store": sid["name"], "label": label, "side": "both"})
            self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.mine()[sid["name"]]["aisles"], 2)


if __name__ == "__main__":
    unittest.main()
