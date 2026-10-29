"""No-map stores (owner, 2026-10-29, approved mockups).

Pinned here:
- GET /api/storemap/stores: the stores Arya holds pictures for. Trader
  Joe's ships a photo walk and a 3D model; any other store joins only
  once a shopper capture is kept on its shared map.
- "Snap the aisle": /api/storemap/next with an item always answers with
  a prompt. A known section asks for that section; an unknown one asks
  for a photo or a short video and lets the teach reader name it, and
  the teach upload notes the item in the section it read.
- The React app (web/src): the Start shopping sheet hides Quest for a store
  with no pictures and shows the approved note; the Express help row
  drops Show me for an item with no data and shows the Snap the aisle
  nudge; the hard-coded store tables are gone.
"""
import io, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "..", "web", "src")

SHEET_NOTE = ("Quest needs aisle photos of this store, and Arya has none yet. "
              "In Express, snap a photo or a short video of the aisles you pass. "
              "Once {store} is mapped, Quest turns on here.")


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as fh:
        return fh.read()


def jpeg(seed=1, w=640, h=480):
    rng = np.random.default_rng(seed)
    a = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, "JPEG", quality=90)
    return buf.getvalue()


class FakeClient:
    reads = []

    def __init__(self, *a, **k):
        pass

    def segment(self, image_bytes, prompt, media_type="image/jpeg"):
        if prompt == "grocery shelf":
            return [{"box": [i * 20, 40, i * 20 + 18, 400], "w": 640,
                     "h": 480, "confidence": 0.8} for i in range(27)], {}, 0.0025
        return [], {}, 0.0025

    def chat(self, messages, mode="standard", **k):
        return FakeClient.reads.pop(0), {}, 0.004


class TestStoresRoute(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        FakeClient.reads = []
        from api import main, deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "owner@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text

    def stores(self):
        r = self.c.get("/api/storemap/stores")
        self.assertEqual(r.status_code, 200, r.text)
        return {s["key"]: s for s in r.json()["stores"]}

    def test_needs_login(self):
        self.assertEqual(TestClient(__import__("api.main", fromlist=["app"]).app)
                         .get("/api/storemap/stores").status_code, 401)

    def test_trader_joes_ships_with_pictures(self):
        got = self.stores()
        tj = got["traderjoes"]
        self.assertEqual(set(tj), {"store", "key", "photos", "model", "has_pictures"})
        self.assertEqual(tj["store"], "Trader Joe's")
        self.assertEqual(tj["photos"], "models/trader-joes/frames-web")
        self.assertEqual(tj["model"], "models/trader-joes/manifest.json")
        self.assertTrue(tj["has_pictures"])
        self.assertNotIn("costco", got)

    def test_a_store_joins_once_a_capture_is_kept(self):
        r = self.c.post("/api/storemap/segments",
                        json={"store": "Costco", "label": "Aisle 4", "side": "left"})
        sid = r.json()["segment"]
        # An aisle with a name but no picture is still no picture.
        self.assertFalse(self.stores().get("costco", {}).get("has_pictures", False))
        r = self.c.post("/api/storemap/capture", params={"store": "Costco", "segment": sid},
                        content=jpeg(3), headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 200, r.text)
        row = self.stores()["costco"]
        self.assertEqual(row, {"store": "Costco", "key": "costco", "photos": None,
                               "model": None, "has_pictures": True})

    def test_snap_prompt_for_an_unknown_aisle_teaches_by_photo_or_video(self):
        r = self.c.get("/api/storemap/next", params={"store": "Costco", "item": "Paper Towels 6 ct"})
        self.assertEqual(r.status_code, 200)
        p = r.json()["prompt"]
        self.assertTrue(p["teach"])
        self.assertEqual(p["media"], "both")
        self.assertEqual(p["segment"], "")
        self.assertEqual(p["item"], "Paper Towels 6 ct")
        self.assertIn("Paper Towels 6 ct", p["title"])
        # Without an item the old answer stands: nothing to ask for.
        self.assertIsNone(self.c.get("/api/storemap/next",
                                     params={"store": "Costco"}).json()["prompt"])

    def test_snap_prompt_for_a_known_section_asks_for_that_section(self):
        from api import storemap
        sid = self.c.post("/api/storemap/segments", json={
            "store": "Costco", "label": "Paper Goods", "side": "both"}).json()["segment"]
        storemap.note_sighting("Costco", "Paper Towels 6 ct", "Paper Goods")
        p = self.c.get("/api/storemap/next", params={
            "store": "Costco", "item": "Paper Towels 6 ct"}).json()["prompt"]
        self.assertEqual(p["segment"], sid)
        self.assertEqual(p["kind"], "photo")
        self.assertFalse(p.get("teach"))

    def test_teach_with_an_item_notes_it_in_the_section_read(self):
        FakeClient.reads = ['{"label": "Paper Goods", "items": []}']
        r = self.c.post("/api/storemap/teach", params={
            "store": "Costco", "kind": "photo", "item": "Paper Towels 6 ct"},
            content=jpeg(5), headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 200, r.text)
        from api import storemap
        doc = storemap.load_map("Costco")
        seg = doc["segments"][r.json()["segment"]]
        self.assertIn("paper towels 6 ct", seg["items"])
        self.assertTrue(self.stores()["costco"]["has_pictures"])


class TestWebStoreData(unittest.TestCase):
    """The store-pictures block (pwa/storedata.js, now web/src/lib/stores.ts)."""

    def test_hard_coded_tables_are_gone(self):
        src = read(WEB, "lib", "stores.ts")
        self.assertNotIn("STORE_PHOTOS = {", src)
        self.assertNotIn("STORE_MODELS = {", src)
        self.assertIn("/api/storemap/stores", src)

    def test_trader_joes_still_works_offline(self):
        src = read(WEB, "lib", "stores.ts")
        self.assertIn('"models/trader-joes/frames-web"', src)
        self.assertIn('"models/trader-joes/manifest.json"', src)

    def test_express_show_me_needs_data(self):
        src = read(WEB, "screens", "Express.tsx")
        self.assertIn("itemHasData(sess.store, sess.items[next])", src)
        self.assertIn('id="exp-show" className="chip" type="button" hidden={!hasData}', src)

    def test_hunt_pop_card_nudge(self):
        src = read(WEB, "screens", "Hunt.tsx")
        self.assertIn('<p className="pop-shelf nodata">', src)
        self.assertIn("data-snap-aisle", src)

    def test_snap_opens_the_guided_capture(self):
        src = read(WEB, "screens", "Hunt.tsx")
        self.assertIn("/api/storemap/next?store=${encodeURIComponent(store)}&item=", src)
        self.assertIn('nav.show("capture", { prompt, store, from: "hunt" })', src)
        cap = read(WEB, "screens", "Capture.tsx")
        self.assertIn('id="cp-govideo"', cap)
        self.assertIn('setVideoOpt(p.media === "both");', cap)
        self.assertIn("&item=", cap)

    def test_snap_link_is_accent_coloured(self):
        css = read(WEB, "styles", "hunt.css")
        self.assertRegex(css, r"\.snapaisle\s*\{[^}]*color:\s*var\(--acc\)")


class TestWebNoMap(unittest.TestCase):
    def test_lists_sheet(self):
        src = read(WEB, "screens", "Lists.tsx")
        self.assertIn('id="shop-nomap"', src)
        self.assertIn("Quest needs aisle photos of this store, and Arya has none yet. "
                      "In Express, snap a photo or a short video of the aisles you pass. "
                      "Once ${shopStore} is mapped, Quest turns on here.", src)

    def test_express_nudge(self):
        src = read(WEB, "screens", "Express.tsx")
        self.assertIn('id="exp-nodata"', src)
        self.assertIn("Arya has no photo of this aisle yet. Found it?", src)
        self.assertIn(">Snap the aisle</button> so other Arya Shoppers can find it too.", src)
        self.assertIn('nav.show("capture", { prompt', src)

    def test_mode_falls_back(self):
        self.assertIn('mode === "quest" && !storeHasPictures(', read(WEB, "screens", "Mode.tsx"))


class TestSettingsRename(unittest.TestCase):
    def test_web(self):
        src = read(WEB, "screens", "Profile.tsx")
        self.assertIn('<h2 className="largetitle">Settings</h2>', src)
        self.assertIn('<h3 className="sect">Account</h3>', src)
        self.assertNotIn('<h2 className="largetitle">Profile</h2>', src)
        self.assertIn("`Settings, level ${ring.level}` : \"Settings\"", read(WEB, "App.tsx"))


if __name__ == "__main__":
    unittest.main()
