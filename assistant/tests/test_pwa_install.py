"""Game shell, install + mobile pieces (2026-10-28): the manifest is
installable on Android and iOS (PNG + maskable icons, standalone,
the app's light colors), the icons are served without a login and
pre-cached, a hunt never turns a gesture into a zoom or a
pull-to-refresh, and the hunt plays from a keyboard.

React at / (2026-10-29): the React app (web/) is the only app. These
pins cover how it is served (the build at /, /next/* moved, the shell
and worker never cached stale) and its service worker
(web/src/sw.js, built to /sw.js by vite-plugin-pwa injectManifest).
"""
import json, os, struct, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient  # noqa: E402

from tests.frontend import STATIC, WEB, index_html, read, src  # noqa: E402


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", path
    return struct.unpack(">II", head[16:24])


def sw():
    return src("sw.js")


class TestManifest(unittest.TestCase):
    def test_manifest_is_installable(self):
        m = json.loads(read("manifest.json"))
        for k in ("name", "short_name", "start_url", "display",
                  "background_color", "theme_color", "icons"):
            self.assertIn(k, m)
        self.assertEqual(m["display"], "standalone")
        # The app lives at /: the installed icon opens it there.
        self.assertEqual(m["start_url"], "/")
        self.assertEqual(m["scope"], "/")
        # Light only, greyscale + one accent (Discussion 31).
        self.assertEqual(m["theme_color"], "#EFEFF1")
        html = index_html()
        self.assertIn('<meta name="theme-color" content="#EFEFF1">', html)
        self.assertIn('<link rel="manifest" href="/manifest.json">', html)
        sizes = {(i["sizes"], i["purpose"]) for i in m["icons"]}
        self.assertIn(("192x192", "any"), sizes)
        self.assertIn(("512x512", "any"), sizes)
        self.assertIn(("512x512", "maskable"), sizes)

    def test_icon_files_match_their_declared_sizes(self):
        m = json.loads(read("manifest.json"))
        for icon in m["icons"]:
            if icon["type"] != "image/png":
                continue
            w, h = png_size(os.path.join(STATIC, icon["src"]))
            self.assertEqual(f"{w}x{h}", icon["sizes"], icon["src"])
        self.assertEqual(png_size(os.path.join(STATIC, "icons", "apple-touch-180.png")), (180, 180))
        self.assertIn('rel="apple-touch-icon" href="/icons/apple-touch-180.png"', index_html())

    def test_icons_are_precached(self):
        static = sw().split("const STATIC = [")[1].split("];")[0]
        for icon in json.loads(read("manifest.json"))["icons"]:
            self.assertIn(f'"/{icon["src"]}"', static)

    def test_icons_served_without_login(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api.main import app
        c = TestClient(app)
        for path in ("/manifest.json", "/icons/maskable-512.png", "/icons/icon-192.png"):
            r = c.get(path)
            self.assertEqual(r.status_code, 200, path)


class TestServedAtRoot(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api.main import app
        self.c = TestClient(app)

    def test_next_moved_to_root(self):
        for path, to in (("/next", "/"), ("/next/", "/"), ("/next/list", "/list"),
                         ("/next/index.html", "/index.html"), ("/next/list?x=1", "/list?x=1"),
                         ("/next//evil.example", "/evil.example")):
            r = self.c.get(path, follow_redirects=False)
            self.assertEqual(r.status_code, 302, path)
            self.assertEqual(r.headers["location"], to, path)
        self.assertEqual(self.c.head("/next/list", follow_redirects=False).status_code, 302)

    def test_build_first_then_static_folder(self):
        from api.main import _AppFiles
        with tempfile.TemporaryDirectory() as dist, tempfile.TemporaryDirectory() as static:
            for d, name, body in ((dist, "index.html", "react"), (dist, "sw.js", "worker"),
                                  (static, "index.html", "old"), (static, "scene.js", "scene")):
                with open(os.path.join(d, name), "w") as fh:
                    fh.write(body)
            from starlette.applications import Starlette
            a = Starlette()
            a.mount("/", _AppFiles(dist, static))
            c = TestClient(a)
            r = c.get("/")
            self.assertEqual(r.text, "react")
            self.assertEqual(r.headers["cache-control"], "no-cache")
            r = c.get("/sw.js")
            self.assertEqual(r.text, "worker")
            self.assertEqual(r.headers["cache-control"], "no-cache")
            r = c.get("/scene.js")
            self.assertEqual(r.text, "scene")
            self.assertNotIn("cache-control", r.headers)
        # Without a build, the static folder alone still serves.
        with tempfile.TemporaryDirectory() as static:
            with open(os.path.join(static, "manifest.json"), "w") as fh:
                fh.write("{}")
            a = Starlette()
            a.mount("/", _AppFiles(os.path.join(static, "missing"), static))
            self.assertEqual(TestClient(a).get("/manifest.json").status_code, 200)

    def test_the_old_app_is_gone(self):
        # The plain-JS app's files left the static folder; what stays
        # is what the React app loads at runtime.
        for name in ("index.html", "app.js", "quest.js", "lists.js", "sw.js", "styles.css", "powers.js"):
            self.assertFalse(os.path.exists(os.path.join(STATIC, name)), name)
        for name in ("scene.js", "manifest.json", "icons/favicon.ico", "vendor/three.module.js"):
            self.assertTrue(os.path.exists(os.path.join(STATIC, name)), name)


class TestServiceWorker(unittest.TestCase):
    """web/src/sw.js: precache the build, network first, the old rules."""

    def test_built_by_inject_manifest_at_the_old_url(self):
        cfg = open(os.path.join(WEB, "vite.config.ts"), encoding="utf-8").read()
        self.assertIn('strategies: "injectManifest"', cfg)
        self.assertIn('filename: "sw.js"', cfg)
        self.assertIn('rollupFormat: "iife"', cfg)
        self.assertIn("self.__WB_MANIFEST", sw())
        reg = src("app/sw-register.ts")
        self.assertIn('navigator.serviceWorker.register("/sw.js")', reg)
        self.assertIn("registerWorker();", src("main.tsx"))

    def test_takes_over_and_drops_old_caches(self):
        w = sw()
        self.assertIn('const CACHE = "arya-web-" + hash(', w)
        install = w.split('self.addEventListener("install"')[1].split("});")[0]
        self.assertIn("c.addAll(SHELL)", install)
        self.assertIn("self.skipWaiting()", install)
        activate = w.split('self.addEventListener("activate"')[1].split("});")[0]
        # Every other cache goes, the old app's "arya-v*" shells too.
        self.assertIn("keys.filter(k => k !== CACHE).map(k => caches.delete(k))", activate)
        self.assertIn("self.clients.claim()", activate)

    def test_fetch_rules(self):
        w = sw()
        fetch = w.split('self.addEventListener("fetch"')[1].split("\n});")[0]
        # Writes never transit the worker (the iOS empty-upload bug).
        self.assertIn('if (e.request.method !== "GET") return;', fetch)
        # The live-sync stream is never touched, before any other rule.
        self.assertLess(fetch.index('if (url.pathname === "/api/group/live") return;'), fetch.index("BYPASS.some"))
        self.assertIn('const BYPASS = ["/api/", "/auth/", "/decode", "/import", "/eyes"];', w)
        # A bypass is a true bypass: the worker does not answer it.
        self.assertIn("if (BYPASS.some(p => url.pathname.startsWith(p))) return;", fetch)
        self.assertEqual(fetch.count("e.respondWith("), 1)
        # Hashed build files cache first (speed audit #21); page loads
        # race the network for 2.5 s, then the shell; the rest network
        # first, the cache only the offline fallback.
        self.assertIn('url.pathname.startsWith("/app/") ? cacheFirst(e.request)', fetch)
        self.assertIn('networkFirst(e.request, e.request.mode === "navigate" ? 2500 : 0)', fetch)
        nf = w.split("function networkFirst(")[1]
        self.assertLess(nf.index("fetch(req)\n    .then"), nf.index("caches.match(req"))
        self.assertIn('caches.match("/index.html")', nf)

    def test_push_reminders_kept(self):
        w = sw()
        self.assertIn('self.addEventListener("push"', w)
        self.assertIn("self.registration.showNotification(", w)
        self.assertIn('self.addEventListener("notificationclick"', w)
        self.assertIn('data: { url: d.url || "/#list" }', w)

    def test_runtime_files_are_precached(self):
        static = sw().split("const STATIC = [")[1].split("];")[0]
        for f in ("/scene.js", "/vendor/three.module.js", "/manifest.json", "/assets/characters/manifest.json"):
            self.assertIn(f'"{f}"', static, f)
        # Best effort: one missing file never stops the install.
        self.assertIn("STATIC.map(u => c.add(u).catch(() => {}))", sw())


class TestHuntMobileAndKeys(unittest.TestCase):
    def test_hunt_locks_zoom_and_pull_to_refresh(self):
        css = read("styles.css")
        rule = css.split("body.hunting {")[1].split("}")[0]
        self.assertIn("touch-action: pan-y", rule)
        self.assertIn("overscroll-behavior: none", rule)
        self.assertIn("100dvh", rule)
        for rel in ("screens/Hunt.tsx", "screens/Express.tsx"):
            js = src(rel)
            self.assertIn('document.body.classList.add("hunting");', js, rel)
            self.assertIn('document.body.classList.remove("hunting");', js, rel)
        # Zoom stays available outside a hunt (accessibility).
        self.assertNotIn("maximum-scale", index_html())
        self.assertNotIn("user-scalable", index_html())

    def test_keyboard_map(self):
        js = src("screens/Hunt.tsx")
        keys = js.split("const keyRef = useRef")[1].split("  useEffect(() => {")[0]
        for key, action in (('case " ": case "Enter"', 'press("#btn-collect")'),
                            ('case "p": case "P"', 'press("#btn-pause")'),
                            ('case "f": case "F"', 'press("#btn-finish")'),
                            ('e.key === "Escape"', 'nav.back("community")')):
            self.assertIn(key, keys)
            self.assertIn(action, keys)
        self.assertIn('case "ArrowRight": case "ArrowLeft"', keys)
        # Typing in a field never grabs.
        self.assertIn('closest("input, textarea, select, [contenteditable]")', keys)
        self.assertIn('document.addEventListener("keydown", h);', js)


class TestGameLoopStyles(unittest.TestCase):
    """The game loop's stylesheets load in the old order (the build
    precaches them with the rest)."""

    def test_stylesheet_order(self):
        main = src("main.tsx")
        css = ["styles.css", "hunt.css", "pack.css", "album.css", "haul.css"]
        for name in css:
            self.assertTrue(os.path.exists(os.path.join(WEB, "src", "styles", name)), name)
        pos = [main.index(f'import "./styles/{n}";') for n in css]
        self.assertEqual(pos, sorted(pos))


class TestIntegrationFixes(unittest.TestCase):
    def test_rail_counts_the_live_session(self):
        rail = src("screens/Express.tsx").split('<div id="exp-rail"')[1].split("</div>")[0]
        self.assertIn("const s = s0.id === sess.id ? sess : s0;", rail)

    def test_finish_step_hides_the_hunt_toast(self):
        hunt = src("screens/Hunt.tsx")
        fin = hunt.split("function onFinish() {")[1].split("\n  }")[0]
        self.assertLess(fin.index("hideToast();"), fin.index('nav.show("finish"'))
        self.assertIn('const openFinish = () => { hideToast(); nav.show("finish", { session: sess }); };',
                      src("screens/Express.tsx"))

    def test_mode_copy_has_no_clock(self):
        self.assertNotIn("beat the clock", src("screens/Mode.tsx"))
        self.assertNotIn("beat the clock", src("screens/Login.tsx"))

    def test_plan_shows_the_deck_before_the_composer(self):
        nl = src("screens/NewList.tsx")
        self.assertLess(nl.rindex('id="nl-deck"'), nl.rindex('id="nl-text"'))
        self.assertLess(nl.rindex('id="nl-text"'), nl.rindex('id="nl-plan"'))


if __name__ == "__main__":
    unittest.main()
