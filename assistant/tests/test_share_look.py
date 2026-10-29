"""Share looks (owner, 2026-10-28): the optional Muse paint pass for the
haul card. Muse Image is faked; no network, no spend. The prompts are
fixed per look, nothing the player typed reaches the model, the
upload is never stored, and the Meta credit is only claimed on a
painted card."""
import os, tempfile, unittest
from unittest import mock

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"

PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 64
PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


class FakeClient:
    calls = []

    def __init__(self, *a, **k):
        pass

    def edit_image(self, data, prompt, media_type="image/jpeg"):
        FakeClient.calls.append((len(data), prompt, media_type))
        return b"PAINTED", {}, 0.01


class TestShareLookModule(unittest.TestCase):
    def test_prompts_are_fixed_and_forbid_text_and_people(self):
        from api import sharelook
        self.assertEqual(set(sharelook.PROMPTS), set(sharelook.LOOKS))
        for look, prompt in sharelook.PROMPTS.items():
            self.assertIn("Do not add any text", prompt, look)
            self.assertIn("people", prompt, look)

    def test_rejects_bad_look_and_bad_art(self):
        from api import sharelook
        for look, art in (("nope", PNG), ("story", b""), ("story", b"GIF89a"),
                          ("story", PNG + b"x" * sharelook.MAX_BYTES)):
            with self.assertRaises(ValueError):
                sharelook.make(look, art, FakeClient())

    def test_one_edit_per_call(self):
        from api import sharelook
        FakeClient.calls = []
        img, cost = sharelook.make("story", PNG, FakeClient())
        self.assertEqual((img, cost), (b"PAINTED", 0.01))
        self.assertEqual(len(FakeClient.calls), 1)
        self.assertEqual(FakeClient.calls[0][2], "image/png")


class TestShareLookRoute(unittest.TestCase):
    def setUp(self):
        from api import deps
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        deps._login_fails.clear()
        FakeClient.calls = []
        self.p = mock.patch.object(deps, "MetaClient", FakeClient)
        self.p.start()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "a@example.com", "password": "pw-a"})
        assert r.status_code == 200, r.text

    def tearDown(self):
        self.p.stop()

    def post(self, look, body=PNG, ctype="image/png"):
        return self.c.post(f"/api/quest/share-look?look={look}", content=body,
                           headers={"Content-Type": ctype})

    def test_paints_and_stores_nothing(self):
        r = self.post("friends")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.content, b"PAINTED")
        self.assertEqual(r.headers["content-type"], "image/webp")
        self.assertEqual(r.headers["cache-control"], "no-store")
        left = [f for f in os.listdir(os.environ["ARYA_DATA_DIR"]) if f.endswith((".png", ".webp"))]
        self.assertEqual(left, [])

    def test_validation(self):
        self.assertEqual(self.post("nope").status_code, 400)
        self.assertEqual(self.post("story", ctype="image/jpeg").status_code, 415)
        self.assertEqual(self.post("story", body=b"not a png").status_code, 400)
        self.assertEqual(FakeClient.calls, [])

    def test_demo_counts_as_a_live_door(self):
        from api import demo_guard
        import api.main as main
        self.assertTrue(demo_guard._demo_live_door("/api/quest/share-look"))


class TestShareLookClient(unittest.TestCase):
    def test_credit_only_on_painted_cards(self):
        js = read("share.js")
        self.assertIn('"Made with Arya" + (opts && opts.painted ? " · Powered by Meta Muse" : "")', js)
        self.assertIn("/api/quest/share-look?look=", js)

    def test_art_layer_has_no_words_and_no_photo(self):
        js = read("share.js")
        art = js[js.index("async function paintLook"):js.index("  /* ---------- sheet")]
        self.assertIn(", false);", art)          # names off
        draw_art = js[js.index("function drawArt"):js.index("function draw(g, H)")]
        self.assertNotIn("c.title", draw_art)
        self.assertNotIn("c.photo", draw_art)

    def test_photo_off_by_default_and_switches_looks_off(self):
        js = read("share.js")
        self.assertIn("photo: false", js)
        self.assertIn("!!opts.photo", js)

    def test_sheet_surfaces(self):
        html = read("index.html")
        for needle in ('id="share-opts"', 'id="share-looks"', 'id="share-again"',
                       'id="share-copy"', 'data-look="badge"', 'data-look="friends"',
                       'data-look="story"', 'data-size="post"', ">Save image<"):
            self.assertIn(needle, html)
        self.assertNotIn("Share as video", html + read("quest.js"))


if __name__ == "__main__":
    unittest.main()
