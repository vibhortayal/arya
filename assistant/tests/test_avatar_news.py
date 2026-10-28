"""Avatar maker, Store news and the labelled sample board (owner,
2026-10-28). Muse Image is faked; no network, no spend."""
import base64, os, tempfile, unittest
from unittest import mock

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


class FakeClient:
    calls = []

    def __init__(self, *a, **k):
        pass

    def generate_image(self, prompt):
        FakeClient.calls.append(("gen", prompt))
        return b"DRAWN", {}, 0.01

    def edit_image(self, data, prompt, media_type="image/jpeg"):
        FakeClient.calls.append(("edit", len(data)))
        return b"CARTOON", {}, 0.01


class TestAvatar(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        main._login_fails.clear()
        FakeClient.calls = []
        self.p = mock.patch.object(main, "MetaClient", FakeClient)
        self.p.start()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "a@example.com", "password": "pw-a"})
        assert r.status_code == 200, r.text

    def tearDown(self):
        self.p.stop()

    def test_preset_round_trip_and_bad_name(self):
        self.assertEqual(self.c.put("/api/quest/avatar", json={"preset": "egg"}).json()["preset"], "egg")
        self.assertEqual(self.c.get("/api/quest/avatar").json()["preset"], "egg")
        self.assertEqual(self.c.put("/api/quest/avatar", json={"preset": "../x"}).status_code, 400)

    def test_generated_waits_as_candidate_until_used(self):
        self.c.put("/api/quest/avatar", json={"preset": "egg"})
        r = self.c.post("/api/quest/avatar/generate", json={"prompt": "a fox"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["candidate"])
        self.assertEqual(self.c.get("/api/quest/avatar").json()["preset"], "egg")
        self.assertEqual(self.c.get("/api/quest/avatar/image?candidate=true").content, b"DRAWN")
        self.assertEqual(self.c.post("/api/quest/avatar/use").status_code, 200)
        a = self.c.get("/api/quest/avatar").json()
        self.assertTrue(a["image"])
        self.assertIsNone(a["preset"])
        self.assertEqual(self.c.get("/api/quest/avatar/image").content, b"DRAWN")

    def test_empty_and_long_prompts_refused_without_spend(self):
        self.assertEqual(self.c.post("/api/quest/avatar/generate", json={"prompt": " "}).status_code, 400)
        self.assertEqual(self.c.post("/api/quest/avatar/generate", json={"prompt": "x" * 300}).status_code, 400)
        self.assertEqual(FakeClient.calls, [])

    def test_photo_is_drawn_and_original_never_written(self):
        r = self.c.post("/api/quest/avatar/photo", content=b"RAWFACE",
                        headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.c.get("/api/quest/avatar/image?candidate=true").content, b"CARTOON")
        base = os.environ["ARYA_DATA_DIR"]
        for root, _, files in os.walk(base):
            for f in files:
                with open(os.path.join(root, f), "rb") as fh:
                    self.assertNotIn(b"RAWFACE", fh.read())
        self.assertEqual(self.c.post("/api/quest/avatar/photo", content=b"x",
                                     headers={"Content-Type": "text/plain"}).status_code, 415)

    def test_demo_cannot_spend_but_can_pick_a_character(self):
        from fastapi.testclient import TestClient
        import api.main as main
        d = TestClient(main.app)
        self.assertEqual(d.post("/auth/demo").status_code, 200)
        self.assertEqual(d.post("/api/quest/avatar/generate", json={"prompt": "a fox"}).status_code, 403)
        self.assertEqual(d.post("/api/quest/avatar/photo", content=b"x",
                                headers={"Content-Type": "image/jpeg"}).status_code, 403)
        self.assertEqual(d.put("/api/quest/avatar", json={"preset": "banana"}).status_code, 200)
        self.assertEqual(FakeClient.calls, [])


class TestEditImage(unittest.TestCase):
    def test_edits_endpoint_shape_and_cost(self):
        from api.meta_client import MetaClient
        cap = {}

        def t(method, url, headers, body):
            cap.update(url=url, body=body)
            return 200, {"data": [{"b64_json": base64.b64encode(b"OUT").decode()}]}
        out, _, cost = MetaClient(api_key="k", transport=t).edit_image(b"IN", "draw it")
        self.assertTrue(cap["url"].endswith("/v1/images/edits"))
        self.assertIn(b"muse-image-1.0", cap["body"])
        self.assertEqual(out, b"OUT")
        self.assertAlmostEqual(cost, 0.01, places=9)


class TestNewsAndSamples(unittest.TestCase):
    def test_store_news_groups_open_reports(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import quest, state
        s = quest._store()
        base = {"state": "reported", "kind": "out_of_stock", "photo": None}
        s["reports"] = [
            dict(base, id="1", store="Costco", item="Oat milk", item_group="oatmilk", reported_at="2026-10-27T10:00"),
            dict(base, id="2", store="costco", item="Oat milk", item_group="oatmilk", reported_at="2026-10-28T10:00"),
            dict(base, id="3", store="Costco", item="Eggs", item_group="eggs", reported_at="2026-10-26T10:00"),
            dict(base, id="4", store="Costco", item="Gone", item_group="gone", reported_at="2026-10-29T10:00", state="resolved")]
        quest._save_store(s)
        news = quest.store_news()["news"]
        self.assertEqual([n["item"] for n in news], ["Oat milk", "Eggs"])
        self.assertEqual(news[0]["count"], 2)

    def test_samples_are_labelled(self):
        js = open(os.path.join(PWA, "quest.js")).read()
        self.assertGreaterEqual(js.count('samplepill">Sample'), 2)
        self.assertIn("Example only", js)


if __name__ == "__main__":
    unittest.main()
