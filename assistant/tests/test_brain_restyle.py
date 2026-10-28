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

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        return json.dumps({"verdicts": []}), {}, 0.0


def fresh_client():
    os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
    from api import main
    main.MetaClient = FakeClient
    main._login_fails.clear()
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
        # the List page. Four tabs remain.
        html = read("index.html")
        nav = html.split('<nav id="tabs"')[1].split("</nav>")[0]
        labels = re.findall(r"<span>([^<]+)</span>", nav)
        self.assertEqual(labels, ["Today", "List", "Ask", "Crew"])
        views = re.findall(r'data-view="([^"]+)"', nav)
        self.assertEqual(views, ["view-home", "view-list",
                                 "view-chat", "view-community"])
        self.assertNotIn('id="view-scan"', html)

    def test_new_views_exist_dashboard_gone(self):
        html = read("index.html")
        for vid in ("view-list", "view-receipts", "view-analysis"):
            self.assertIn(f'id="{vid}"', html)
        self.assertNotIn('id="view-dash"', html)

    def test_no_stock_chrome_emojis(self):
        for name in ("index.html", "app.js"):
            self.assertNotIn("🛒", read(name))
            self.assertNotIn("☁️", read(name))
            self.assertNotIn("🔔", read(name))

    def test_today_and_list_hooks(self):
        html, js = read("index.html"), read("app.js")
        for el in ("today-hero", "today-eye", "today-listline",
                   "store-filter", "composer", "add-text", "add-submit",
                   "add-split", "list-eyes", "rc-archive",
                   "an-spend", "pf-avatar", "pf-badges"):
            self.assertIn(f'id="{el}"', html)
        # The staples line is a count only (owner, 2026-10-28): no
        # name dump, no returns sentence.
        self.assertNotIn("never re-suggested", js)
        self.assertIn("staplesLine", js)

    def test_list_actions_wired(self):
        js = read("app.js")
        for path in ("/api/list/check", "/api/list/qty", "/api/list/remove",
                     "/api/list/check-ok", "/expired"):
            self.assertIn(path, js)
        self.assertNotIn("renderDash", js)
        self.assertNotIn("view-dash", js)

    def test_sw_cache_bumped(self):
        self.assertIn('CACHE = "arya-v59"', read("sw.js"))

    def test_light_mode_only(self):
        """Owner 2026-10-27: light theme only. No Appearance switch,
        no dark token variant, and the boot script pins light while
        clearing any persisted theme preference."""
        html = read("index.html")
        js = read("app.js")
        css = read("styles.css")
        self.assertNotIn("Appearance", html)
        self.assertNotIn("theme-seg", html + js)
        self.assertNotIn("data-theme-choice", html + js)
        self.assertNotIn("prefers-color-scheme: dark", css + html)
        self.assertNotIn('[data-theme="dark"]', css)
        self.assertNotIn("color-scheme: dark", css)
        self.assertIn('dataset.theme="light"', html)
        self.assertIn('removeItem("arya-theme")', html)


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
        # the lens fallback: a manual item has no item page history
        r = self.c.get("/api/items/manual-oat-milk")
        self.assertEqual(r.status_code, 404)


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


if __name__ == "__main__":
    unittest.main()
