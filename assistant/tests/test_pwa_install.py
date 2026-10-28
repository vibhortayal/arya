"""Game shell, install + mobile pieces (2026-10-28): the manifest is
installable on Android and iOS (PNG + maskable icons, standalone,
the app's light colors), the icons are served without a login and
pre-cached, a hunt never turns a gesture into a zoom or a
pull-to-refresh, and the hunt plays from a keyboard.
"""
import json, os, struct, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as f:
        return f.read()


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", path
    return struct.unpack(">II", head[16:24])


class TestManifest(unittest.TestCase):
    def test_manifest_is_installable(self):
        m = json.loads(read("manifest.json"))
        for k in ("name", "short_name", "start_url", "display",
                  "background_color", "theme_color", "icons"):
            self.assertIn(k, m)
        self.assertEqual(m["display"], "standalone")
        # Light only, greyscale + one accent (Discussion 31).
        self.assertEqual(m["theme_color"], "#EFEFF1")
        self.assertIn('<meta name="theme-color" content="#EFEFF1">', read("index.html"))
        sizes = {(i["sizes"], i["purpose"]) for i in m["icons"]}
        self.assertIn(("192x192", "any"), sizes)
        self.assertIn(("512x512", "any"), sizes)
        self.assertIn(("512x512", "maskable"), sizes)

    def test_icon_files_match_their_declared_sizes(self):
        m = json.loads(read("manifest.json"))
        for icon in m["icons"]:
            if icon["type"] != "image/png":
                continue
            w, h = png_size(os.path.join(PWA, icon["src"]))
            self.assertEqual(f"{w}x{h}", icon["sizes"], icon["src"])
        self.assertEqual(png_size(os.path.join(PWA, "icons", "apple-touch-180.png")), (180, 180))
        self.assertIn('rel="apple-touch-icon" href="icons/apple-touch-180.png"', read("index.html"))

    def test_icons_are_precached(self):
        sw = read("sw.js")
        for icon in json.loads(read("manifest.json"))["icons"]:
            self.assertIn(f'"/{icon["src"]}"', sw)

    def test_icons_served_without_login(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api.main import app
        c = TestClient(app)
        for path in ("/manifest.json", "/icons/maskable-512.png", "/icons/icon-192.png"):
            r = c.get(path)
            self.assertEqual(r.status_code, 200, path)


class TestHuntMobileAndKeys(unittest.TestCase):
    def test_hunt_locks_zoom_and_pull_to_refresh(self):
        css = read("styles.css")
        rule = css.split("body.hunting {")[1].split("}")[0]
        self.assertIn("touch-action: pan-y", rule)
        self.assertIn("overscroll-behavior: none", rule)
        self.assertIn("100dvh", rule)
        # Zoom stays available outside a hunt (accessibility).
        self.assertNotIn("maximum-scale", read("index.html"))
        self.assertNotIn("user-scalable", read("index.html"))

    def test_keyboard_map(self):
        js = read("quest.js")
        keys = js.split("function qHuntKey(")[1].split("\n}")[0]
        for key, action in (('case " ": case "Enter"', 'press("#btn-collect")'),
                            ('case "p": case "P"', 'press("#btn-pause")'),
                            ('case "f": case "F"', 'press("#btn-finish")'),
                            ('e.key === "Escape"', "questBack()")):
            self.assertIn(key, keys)
            self.assertIn(action, keys)
        self.assertIn("qAimStep(Q.current", keys)
        # Typing in a field never grabs.
        self.assertIn('closest("input, textarea, select, [contenteditable]")', keys)
        self.assertIn('document.addEventListener("keydown", qHuntKey);', js)


if __name__ == "__main__":
    unittest.main()


class TestGameLoopPrecache(unittest.TestCase):
    """Every file the game loop added is in the offline shell, in the
    same order index.html loads it."""

    FILES = ("hunt.css", "pack.css", "album.css", "haul.css",
             "pack.js", "huntmenu.js", "album.js", "haul.js")

    def test_new_files_are_precached(self):
        sw = read("sw.js")
        for f in self.FILES:
            self.assertIn(f'"/{f}"', sw, f)

    def test_precached_files_exist_and_are_linked(self):
        html = read("index.html")
        for f in self.FILES:
            self.assertTrue(os.path.exists(os.path.join(PWA, f)), f)
            self.assertIn(f'"{f}"', html, f)

    def test_script_order(self):
        html = read("index.html")
        order = ["app.js", "pack.js", "scene.js", "quest.js", "huntmenu.js",
                 "album.js", "mapper.js", "share.js", "haul.js"]
        pos = [html.index(f'<script src="{n}">') for n in order]
        self.assertEqual(pos, sorted(pos))
        css = ["styles.css", "hunt.css", "pack.css", "album.css", "haul.css"]
        pos = [html.index(f'<link rel="stylesheet" href="{n}">') for n in css]
        self.assertEqual(pos, sorted(pos))


class TestIntegrationFixes(unittest.TestCase):
    def test_rail_counts_the_live_session(self):
        q = read("quest.js")
        rail = q.split("function qRailHtml(currentId) {")[1].split("\n}")[0]
        self.assertIn("Q.current.id === s0.id", rail)

    def test_finish_step_hides_the_hunt_toast(self):
        q = read("quest.js")
        fin = q.split("function openFinish(sess) {")[1].split("\n}")[0]
        self.assertIn('$("#toast")', fin)
        self.assertIn("hidden = true", fin)

    def test_mode_copy_has_no_clock(self):
        html = read("index.html")
        self.assertNotIn("beat the clock", html)

    def test_plan_shows_the_deck_before_the_composer(self):
        html = read("index.html")
        nl = html.split('id="view-newlist"')[1].split('id="view-store"')[0]
        self.assertLess(nl.index('id="nl-deck"'), nl.index('id="nl-text"'))
        self.assertLess(nl.index('id="nl-text"'), nl.index('id="nl-plan"'))
