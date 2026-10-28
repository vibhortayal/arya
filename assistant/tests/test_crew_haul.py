"""Crew hauls: a finished haul posted to accepted friends only.

Two real accounts, as in test_friends. A post is a trip name, stock
character art per shown item and three numbers. A reaction is one of
three stickers (or none). No chat, no comment, no free text, and no
price, store, photo, receipt, session id or estimate ever crosses.
"""
import json, os, tempfile, unittest
from datetime import date

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"

TODAY = date.today().isoformat()
ALICE, BOB = "alice@example.com", "bob@example.com"
CAROL, DAVE = "carol@example.com", "dave@example.com"
ITEMS = ["Milk", "Eggs", "Bananas", "Bread", "Butter"]


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        raise AssertionError("Crew paths must not call a model")


def line(name):
    return {"decoded_name": name, "qty": 1, "unit_price": 9.99,
            "line_total": 9.99, "line_type": "item", "status": "auto"}


class CrewBase(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        from api import auth, state
        main.MetaClient = FakeClient
        main._login_fails.clear()
        self.main, self.state = main, state
        state._save("receipts.json", [{
            "receipt_id": "r-1", "merchant": "Trader Joe's",
            "purchased_at": TODAY, "total": 49.95, "subtotal": 49.95, "tax": 0,
            "totals_reconcile": True,
            "lines": [line("Whole Milk"), line("Eggs"), line("Bananas"),
                      line("Sourdough Bread"), line("Butter")]}])
        self.a = TestClient(main.app)
        r = self.a.post("/auth/setup", json={"username": ALICE, "password": "pw-alice"})
        assert r.status_code == 200, r.text
        self.clients = {}
        for u in (BOB, CAROL, DAVE):
            auth.create_user(u, "pw-" + u.split("@")[0])
            c = TestClient(main.app)
            r = c.post("/auth/login", json={"username": u,
                                            "password": "pw-" + u.split("@")[0]})
            assert r.status_code == 200, r.text
            self.clients[u] = c
        self.b, self.carol, self.dave = (self.clients[BOB], self.clients[CAROL],
                                         self.clients[DAVE])
        # alice <-> bob accepted; alice -> dave pending only; carol a stranger.
        assert self.a.post("/api/quest/friends", json={"handle": "bob"}).status_code == 200
        assert self.b.post("/api/quest/friends/accept", json={"handle": "alice"}).status_code == 200
        assert self.a.post("/api/quest/friends", json={"handle": "dave"}).status_code == 200
        self.sid = self.hunt()

    def hunt(self):
        c = self.a
        r = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest",
            "items": [{"name": n, "qty": 1} for n in ITEMS]})
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        for n in ITEMS:
            c.post(f"/api/quest/sessions/{sid}/check", json={"item": n, "checked": True})
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "finished"})
        r = c.post(f"/api/quest/sessions/{sid}/receipt", json={"receipt_id": "r-1"})
        assert r.status_code == 200, r.text
        return sid

    def post(self, items=None, sid=None):
        body = {} if items is None else {"items": items}
        return self.a.post(f"/api/quest/sessions/{sid or self.sid}/haul/post", json=body)

    def feed(self, client):
        r = client.get("/api/quest/crew/feed")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["feed"]


class TestPost(CrewBase):
    def test_friend_feed_shows_name_stickers_and_stats_only(self):
        arts = [{"name": "Milk", "art": "milk.webp"},
                {"name": "Eggs", "art": "egg.webp"}]
        r = self.post(arts)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["post"]["posted"])
        feed = self.feed(self.b)
        self.assertEqual(len(feed), 1)
        p = feed[0]
        self.assertEqual(set(p), {"post_id", "author", "name", "items", "stats",
                                  "posted_at", "my_reaction"})
        self.assertEqual(p["author"], "alice")
        self.assertEqual(len(p["items"]), 5)
        for it in p["items"]:
            self.assertEqual(set(it), {"name", "art"})
        arts_by = {i["name"]: i["art"] for i in p["items"]}
        self.assertEqual(arts_by["Milk"], "milk.webp")
        self.assertEqual(arts_by["Eggs"], "egg.webp")
        self.assertEqual(arts_by["Bread"], "basket.webp")  # no art sent
        self.assertEqual(set(p["stats"]), {"items", "new_finds", "level"})
        self.assertEqual(p["stats"]["items"], 5)
        # With the album merged, every first-time product is a new find
        # (capped at the items shown). Five grabs, no older trips: five.
        self.assertEqual(p["stats"]["new_finds"], 5)
        self.assertRegex(p["name"], r"^[A-Z][a-z]+day [A-Z]")
        self.assertTrue(p["post_id"].startswith("hp-"))
        self.assertIsNone(p["my_reaction"])
        # The author's own feed is not her posts.
        self.assertEqual(self.feed(self.a), [])

    def test_strangers_and_pending_friends_get_nothing(self):
        r = self.post()
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["post"]["audience"], ["bob"])
        self.assertEqual(self.feed(self.carol), [])
        self.assertEqual(self.feed(self.dave), [])
        self.assertEqual(self.a.get("/api/quest/crew/audience").json(),
                         {"audience": ["bob"]})

    def test_republish_is_one_card(self):
        a = self.post().json()["post"]["post_id"]
        b = self.post().json()["post"]["post_id"]
        self.assertEqual(a, b)
        self.assertEqual(len(self.feed(self.b)), 1)

    def test_hide_after_posting_updates_the_copy_in_place(self):
        self.post()
        pid = self.feed(self.b)[0]["post_id"]
        r = self.a.post(f"/api/quest/sessions/{self.sid}/haul/hide",
                        json={"key": "milk", "hidden": True})
        self.assertEqual(r.status_code, 200, r.text)
        feed = self.feed(self.b)
        self.assertEqual(len(feed), 1)
        self.assertEqual(feed[0]["post_id"], pid)
        self.assertNotIn("Whole Milk", [i["name"] for i in feed[0]["items"]])
        self.assertEqual(feed[0]["stats"]["items"], 4)
        self.a.post(f"/api/quest/sessions/{self.sid}/haul/hide",
                    json={"key": "milk", "hidden": False})
        self.assertEqual(self.feed(self.b)[0]["stats"]["items"], 5)

    def test_hiding_everything_takes_the_post_down(self):
        self.post()
        h = self.a.get(f"/api/quest/sessions/{self.sid}/haul").json()
        for it in h["items"]:
            self.a.post(f"/api/quest/sessions/{self.sid}/haul/hide",
                        json={"key": it["key"], "hidden": True})
        self.assertEqual(self.feed(self.b), [])
        r = self.post()
        self.assertEqual(r.status_code, 400)

    def test_hiding_the_last_sticker_says_the_post_came_down(self):
        self.post()
        h = self.a.get(f"/api/quest/sessions/{self.sid}/haul").json()
        flags = []
        for it in h["items"]:
            r = self.a.post(f"/api/quest/sessions/{self.sid}/haul/hide",
                            json={"key": it["key"], "hidden": True})
            flags.append(r.json()["post"].get("taken_down"))
        self.assertEqual(flags[:-1], [False] * (len(flags) - 1))
        self.assertIs(flags[-1], True)
        self.assertFalse(r.json()["post"]["posted"])
        # Showing one again does not post it. Nothing posts unasked.
        r = self.a.post(f"/api/quest/sessions/{self.sid}/haul/hide",
                        json={"key": h["items"][0]["key"], "hidden": False})
        self.assertFalse(r.json()["post"]["posted"])
        self.assertIs(r.json()["post"]["taken_down"], False)

    def test_new_finds_count_only_the_stickers_that_go_out(self):
        from unittest import mock
        from api import stickers
        fresh = [
            {"name": "Whole Milk", "key": "milk", "sticker_id": "s1"},
            {"name": "Eggs", "key": "eggs", "sticker_id": "s2"},
            {"name": "Never Bought", "key": "nb", "sticker_id": "s3"}]
        with mock.patch.object(stickers, "new_in_session", lambda sid: fresh):
            self.post()
            self.assertEqual(self.feed(self.b)[0]["stats"]["new_finds"], 2)
            # Hiding a new find lowers the count a friend sees.
            self.a.post(f"/api/quest/sessions/{self.sid}/haul/hide",
                        json={"key": "milk", "hidden": True})
            st = self.feed(self.b)[0]["stats"]
            self.assertEqual((st["items"], st["new_finds"]), (4, 1))

    def test_unpublish_removes_author_and_inbox_copies(self):
        self.post()
        self.assertEqual(len(self.feed(self.b)), 1)
        r = self.a.delete(f"/api/quest/sessions/{self.sid}/haul/post")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(r.json()["post"]["posted"])
        self.assertEqual(self.feed(self.b), [])
        h = self.a.get(f"/api/quest/sessions/{self.sid}/haul").json()
        self.assertFalse(h["post"]["posted"])
        # Delete twice is fine.
        self.assertEqual(self.a.delete(
            f"/api/quest/sessions/{self.sid}/haul/post").status_code, 200)
        # And a new post after a delete works again.
        self.post()
        self.assertEqual(len(self.feed(self.b)), 1)

    def test_art_outside_the_manifest_becomes_the_basket(self):
        bad = ["../../etc/passwd.webp", "evil.png", "unknown.webp", "", None, 7,
               "http://x/y.webp"]
        items = [{"name": n, "art": bad[i % len(bad)]}
                 for i, n in enumerate(["Whole Milk", "Eggs", "Bananas",
                                        "Sourdough Bread", "Butter"])]
        r = self.post(items)
        self.assertEqual(r.status_code, 200, r.text)
        p = self.feed(self.b)[0]
        self.assertEqual({i["art"] for i in p["items"]}, {"basket.webp"})

    def test_names_come_from_the_server_not_the_client(self):
        r = self.post([{"name": "FREE MONEY click here", "art": "milk.webp"},
                       "junk", 5])
        self.assertEqual(r.status_code, 200, r.text)
        names = [i["name"] for i in self.feed(self.b)[0]["items"]]
        self.assertNotIn("FREE MONEY click here", names)
        self.assertEqual(len(names), 5)

    def test_open_hunt_cannot_post(self):
        c = self.a
        r = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest", "items": ["Milk"]})
        sid = r.json()["id"]
        self.assertEqual(self.post(sid=sid).status_code, 400)
        self.assertEqual(self.post(sid="nope").status_code, 404)

    def test_the_public_post_carries_no_price_store_photo_receipt_or_session(self):
        self.post()
        blob = json.dumps(self.feed(self.b)).lower()
        for word in ("price", "total", "estimate", "store", "photo", "receipt",
                     "session", "trader", "$", "9.99", "49.95", self.sid.lower()):
            self.assertNotIn(word, blob, word)
        # Nor in what is stored on the friend's side.
        p = os.path.join(os.environ["ARYA_DATA_DIR"], "users", BOB, "crew_inbox.json")
        with open(p, encoding="utf-8") as fh:
            raw = fh.read().lower()
        for word in ("price", "estimate", "photo", "receipt", "session", "trader",
                     self.sid.lower()):
            self.assertNotIn(word, raw, word)

    def test_friend_cannot_read_the_authors_haul_or_hauls_file(self):
        self.post()
        for method, path in (
                ("get", f"/api/quest/sessions/{self.sid}/haul"),
                ("delete", f"/api/quest/sessions/{self.sid}/haul/post"),
                ("get", f"/api/quest/sessions/{self.sid}")):
            r = getattr(self.b, method)(path)
            self.assertEqual(r.status_code, 404, path)
        r = self.b.post(f"/api/quest/sessions/{self.sid}/haul/hide",
                        json={"key": "milk", "hidden": True})
        self.assertEqual(r.status_code, 404)
        # No route serves hauls.json or the private estimate to anyone else.
        paths = {getattr(r, "path", "") for r in self.main.app.routes}
        self.assertFalse([p for p in paths if "hauls" in p])
        self.assertEqual(len(self.feed(self.b)[0]["items"]), 5)

    def test_an_unfriended_author_leaves_the_feed(self):
        from api import quest
        self.post()
        self.assertEqual(len(self.feed(self.b)), 1)
        with quest._as_user(BOB):
            s = quest._store()
            s["friends"][0]["status"] = "pending_in"
            quest._save_store(s)
        self.assertEqual(self.feed(self.b), [])


class TestReactions(CrewBase):
    def setUp(self):
        super().setUp()
        self.post()
        self.pid = self.feed(self.b)[0]["post_id"]

    def react(self, kind, client=None, author="alice", pid=None):
        return (client or self.b).post(
            f"/api/quest/crew/posts/{author}/{pid or self.pid}/react",
            json={"kind": kind})

    def counts(self):
        h = self.a.get(f"/api/quest/sessions/{self.sid}/haul").json()
        return h["post"]["reactions"]

    def test_three_stickers_and_none_are_accepted(self):
        for kind in ("yum", "me_too", "teach_me", "none"):
            r = self.react(kind)
            self.assertEqual(r.status_code, 200, (kind, r.text))
        self.react("yum")
        self.assertEqual(self.feed(self.b)[0]["my_reaction"], "yum")
        self.assertEqual(self.counts(), {"yum": 1, "me_too": 0, "teach_me": 0})
        self.react("me_too")      # one active at a time
        self.assertEqual(self.feed(self.b)[0]["my_reaction"], "me_too")
        self.assertEqual(self.counts(), {"yum": 0, "me_too": 1, "teach_me": 0})
        self.react("none")
        self.assertIsNone(self.feed(self.b)[0]["my_reaction"])
        self.assertEqual(self.counts(), {"yum": 0, "me_too": 0, "teach_me": 0})

    def test_any_other_kind_is_400(self):
        for bad in ("love", "great haul!", "", "YUM", "yum ", "<script>", 5, None,
                    ["yum"], {"a": 1}):
            r = self.react(bad)
            self.assertEqual(r.status_code, 400, repr(bad))
        self.assertEqual(self.counts(), {"yum": 0, "me_too": 0, "teach_me": 0})

    def test_extra_fields_are_dropped_never_stored(self):
        r = self.b.post(f"/api/quest/crew/posts/alice/{self.pid}/react",
                        json={"kind": "yum", "text": "nice haul friend", "comment": "hi"})
        self.assertEqual(r.status_code, 200)
        for user in (ALICE, BOB):
            for name in ("crew_posts.json", "crew_inbox.json"):
                p = os.path.join(os.environ["ARYA_DATA_DIR"], "users", user, name)
                if os.path.exists(p):
                    with open(p, encoding="utf-8") as fh:
                        self.assertNotIn("nice haul", fh.read())

    def test_authors_see_counts_per_kind_not_who(self):
        self.react("teach_me")
        post = self.a.get(f"/api/quest/sessions/{self.sid}/haul").json()["post"]
        self.assertEqual(set(post["reactions"]), {"yum", "me_too", "teach_me"})
        self.assertTrue(all(isinstance(n, int) for n in post["reactions"].values()))
        self.assertEqual(post["reactions"]["teach_me"], 1)

    def test_strangers_and_unknown_posts_cannot_react(self):
        self.assertEqual(self.react("yum", client=self.carol).status_code, 404)
        self.assertEqual(self.react("yum", client=self.dave).status_code, 404)
        self.assertEqual(self.react("yum", pid="hp-nope").status_code, 404)
        self.assertEqual(self.react("yum", author="nobody").status_code, 404)
        self.assertEqual(self.counts()["yum"], 0)

    def test_no_chat_or_comment_route_exists(self):
        for route in self.main.app.routes:
            path = getattr(route, "path", "")
            if "crew" in path or "haul" in path:
                for bad in ("message", "comment", "chat", "dm", "reply"):
                    self.assertNotIn(bad, path)

    def test_reactions_survive_an_update_of_the_post(self):
        self.react("yum")
        self.a.post(f"/api/quest/sessions/{self.sid}/haul/hide",
                    json={"key": "milk", "hidden": True})
        self.assertEqual(self.feed(self.b)[0]["my_reaction"], "yum")
        self.assertEqual(self.counts()["yum"], 1)

    def test_deleting_the_post_deletes_its_reactions(self):
        self.react("yum")
        self.a.delete(f"/api/quest/sessions/{self.sid}/haul/post")
        self.assertEqual(self.react("yum").status_code, 404)


if __name__ == "__main__":
    unittest.main()
