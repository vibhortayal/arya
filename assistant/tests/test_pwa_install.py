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
