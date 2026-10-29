"""Brain restyle (wireframes B1–B6 + decluttered Today, approved
2026-10-27): the shell contract — five tabs, no Dashboard tab, the
new views — and the API data shapes the restyled screens render:
the List lens reads store affinity from /api/items/{id}
price_by_store, Analysis reads /api/dashboard + the receipt
archive, Today's needs-eye count reads /api/review + /api/curator.
"""
import json, os, re, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

from tests import frontend


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        return json.dumps({"verdicts": []}), {}, 0.0


def fresh_client():
    os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
    from api import main
    from api import deps
    deps.MetaClient = FakeClient
    deps._login_fails.clear()
    c = TestClient(main.app)
    r = c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
    assert r.status_code == 200, r.text
    return c


def seed_receipt(c, merchant, date, lines, rid):
    body = {"merchant": merchant, "purchased_at": date, "receipt_id": rid,
            "lines": [{"decoded_name": n, "sku": sku, "line_total": amt,
                       "qty": 1, "confidence": 0.95}
                      for n, sku, amt in lines],
            "subtotal": sum(a for _, _, a in lines), "tax": 0,
            "total": sum(a for _, _, a in lines)}
    r = c.post("/api/intake/structured", json=body)
    assert r.status_code == 200, r.text
    return r.json()


class TestShellContract(unittest.TestCase):
    def test_four_tabs_no_add_no_dashboard(self):
        # The Add tab is gone (owner, 2026-10-28): adding lives on
        # the List page. List first, Quest second (owner, 2026-10-29):
        # Crew folded into the Quest tab; its view id stays
        # community. Settings tab (owner, 2026-10-29) opens Profile.
        views = frontend.src("app/views.ts")
        tabs = re.search(r"TABS: ViewId\[\] = \[([^\]]*)\]", views).group(1)
        self.assertEqual(re.findall(r'"([^"]+)"', tabs), ["home", "list", "chat", "community", "profile"])
        app = frontend.src("App.tsx")
        labels = re.search(r"TAB_LABEL[^{]*\{([^}]*)\}", app).group(1)
        self.assertEqual(re.findall(r':\s*"([^"]+)"', labels), ["Today", "Lists", "Ask", "Quest", "Settings"])
        self.assertIn('data-view={"view-" + t}', app)
        self.assertNotIn('"scan"', views)

    def test_new_views_exist_dashboard_gone(self):
        reg = frontend.src("screens/registry.tsx")
        for vid in ("list", "receipts", "analysis"):
            self.assertRegex(reg, rf"\n\s*{vid}: ", vid)
        self.assertNotIn("dash", frontend.src("app/views.ts"))

    def test_no_stock_chrome_emojis(self):
        app = frontend.app()
        self.assertNotIn("\U0001F6D2", app)
        self.assertNotIn("\u2601\ufe0f", app)
        self.assertNotIn("\U0001F514", app)

    def test_today_and_list_hooks(self):
        where = {"screens/Today.tsx": ("today-eye", "today-listline"),
                 "screens/Lists.tsx": ("list-cards", "composer", "add-text", "add-submit",
                                       "add-split", "list-eyes"),
                 "screens/Receipts.tsx": ("rc-archive",), "screens/Analysis.tsx": ("an-spend",),
                 "screens/Profile.tsx": ("pf-avatar",), "screens/QuestProgress.tsx": ("pf-badges",)}
        for f, ids in where.items():
            js = frontend.src(f)
            for el in ids:
                self.assertIn(f'id="{el}"', js, el)
        # The staples line is a count only (owner, 2026-10-28): no
        # name dump, no returns sentence. Today taps through to Lists.
        today = frontend.src("screens/Today.tsx")
        self.assertNotIn("never re-suggested", frontend.app())
        self.assertIn('<span id="today-listline-text">Open Lists</span>', today)

    def test_list_actions_wired(self):
        js = frontend.app()
        for path in ("/api/list/check", "/api/list/qty", "/api/list/remove",
                     "/api/list/check-ok", "/expired"):
            self.assertIn(path, js)
        self.assertNotIn("renderDash", js)
        self.assertNotIn("view-dash", js)

    def test_sw_drops_every_old_cache(self):
        # Was: the CACHE name bumped by hand. The worker now names its
        # cache after the build and deletes every other one, the old
        # app's "arya-v*" shells included.
        sw = frontend.src("sw.js")
        self.assertIn('const CACHE = "arya-web-" + hash(', sw)
        self.assertIn("keys.filter(k => k !== CACHE).map(k => caches.delete(k))", sw)

    def test_light_mode_only(self):
        """Owner 2026-10-27: light theme only. No Appearance switch,
        no dark token variant, and the page pins light."""
        app = frontend.app()
        css = frontend.css()
        self.assertNotIn("Appearance", app)
        self.assertNotIn("theme-seg", app)
        self.assertNotIn("data-theme-choice", app)
        self.assertNotIn("prefers-color-scheme: dark", css + app)
        self.assertNotIn('[data-theme="dark"]', css)
        self.assertNotIn("color-scheme: dark", css)
        self.assertIn('<html lang="en" data-theme="light">', frontend.index_html())


class TestLensData(unittest.TestCase):
    def setUp(self):
        self.c = fresh_client()
        for d in ("2026-09-05", "2026-09-26", "2026-10-17"):
            seed_receipt(self.c, "Costco", d,
                         [("KS Almonds", "1001", 12.99),
                          ("Organic Eggs", "1002", 8.49)], f"r-{d}")
        seed_receipt(self.c, "Trader Joe's", "2026-10-20",
                     [("Organic Eggs", "1002", 6.99),
                      ("Mandarins", "1003", 4.49)], "r-tj")

    def test_affinity_from_price_by_store(self):
        eggs = self.c.get("/api/items/costco-1002").json()
        self.assertEqual(sorted(eggs["price_by_store"]),
                         ["Costco", "Trader Joe's"])
        almonds = self.c.get("/api/items/costco-1001").json()
        self.assertEqual(list(almonds["price_by_store"]), ["Costco"])

    def test_manual_add_lands_on_one_list(self):
        self.c.post("/api/list/add", json={"item_id": "costco-1001"})
        self.c.post("/api/list/add", json={"name": "Oat Milk"})
        items = self.c.get("/api/home").json()["list"]["items"]
        ids = [i["item_id"] for i in items]
        self.assertIn("costco-1001", ids)
        self.assertIn("manual-oat-milk", ids)
        # a manual item has no history: its page opens with no stores
        r = self.c.get("/api/items/manual-oat-milk")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["price_by_store"], {})


class TestAnalysisAndTodayData(unittest.TestCase):
    def setUp(self):
        self.c = fresh_client()
        seed_receipt(self.c, "Costco", "2026-09-05",
                     [("KS Almonds", "1001", 12.99)], "r-sep")
        seed_receipt(self.c, "Costco", "2026-10-17",
                     [("KS Almonds", "1001", 12.99),
                      ("Organic Eggs", "1002", 8.49)], "r-oct")

    def test_analysis_shape(self):
        d = self.c.get("/api/dashboard").json()
        self.assertEqual(max(d["spend_by_month"]), "2026-10")
        self.assertEqual(d["spend_by_month"]["2026-10"], 21.48)
        self.assertIn("returns_total", d)
        archive = self.c.get("/api/quest/receipts").json()["receipts"]
        october = [r for r in archive
                   if r["purchased_at"].startswith("2026-10")]
        self.assertEqual(len(october), 1)
        self.assertTrue(all(r["totals_reconcile"] for r in archive))

    def test_today_inputs(self):
        s = self.c.post("/api/quest/sessions",
                        json={"store": "Costco", "mode": "express",
                              "items": [{"name": "KS Almonds", "qty": 1}]})
        self.assertEqual(s.status_code, 200)
        sessions = self.c.get("/api/quest/sessions").json()["sessions"]
        self.assertEqual(sessions[0]["state"], "not_started")
        q = self.c.get("/api/review").json()
        self.assertIn("lines", q)
        self.assertIn("unresolved", q)
        cur = self.c.get("/api/curator").json()
        self.assertIn("proposals", cur)
        prof = self.c.get("/api/quest/profile").json()
        self.assertEqual(prof["stats"]["receipts"], 2)
        self.assertTrue(any(b["id"] == "eagle_eye" for b in prof["badges"]))


class TestCuratorCardGating(unittest.TestCase):
    """The discrepancy card shows only when proposals are pending
    (owner, 2026-10-29 — an idle explainer card is clutter), and
    when it shows it is the approved wireframe: one card per
    question, Arya's voice only, no internal names, no manual
    trigger on Receipts."""

    def test_card_hidden_without_proposals(self):
        js = frontend.src("screens/Receipts.tsx")
        self.assertIn("const hasCur = proposals.length > 0;", js)
        self.assertIn('<div id="curator" hidden={!hasCur}>', js)

    def test_card_is_the_approved_wireframe(self):
        app = frontend.src("screens/Receipts.tsx")
        self.assertIn("Are these the same item?", app)
        self.assertIn("Should these stay separate?", app)
        self.assertIn("Yes, same item", app)
        self.assertIn("No, keep separate", app)
        self.assertIn("Arya is asking because the names look alike.", app)
        # No internal subsystem names in user-facing copy, and no
        # manual run button on the Receipts card (owner: "for user
        # perspective it's all arya"; wireframe has no trigger).
        self.assertNotIn("Ask the Curator", app)
        self.assertNotIn("The Curator reasons", app)
        self.assertNotIn("The Curator proposed", app)
        self.assertNotIn("btn-curator-run", app)


if __name__ == "__main__":
    unittest.main()
