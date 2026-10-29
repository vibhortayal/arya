"""Live sync for groups (owner, 2026-10-29): a change by one member
wakes the other members' open apps through /api/group/live."""
import asyncio, contextvars, json, os, tempfile, threading, unittest
from unittest import mock

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"

from api import groups, live, state


class TestHub(unittest.TestCase):
    def setUp(self):
        os.environ.pop("DATABASE_URL", None)
        live._subs.clear()

    def test_change_from_another_thread_reaches_the_stream(self):
        async def go():
            s = live.subscribe("g1", "alice")
            other = live.subscribe("g2", "carol")
            gen = live.stream(s, lambda: True, self._never_gone)
            self.assertEqual(await gen.__anext__(), "retry: 5000\n\n")
            tok = live.client_id.set("tab-9")
            # A route in the threadpool carries the request's context.
            t = threading.Thread(target=contextvars.copy_context().run,
                                 args=(live.changed, "g1"), kwargs={"by": "bob"})
            t.start(); t.join()
            live.client_id.reset(tok)
            msg = await asyncio.wait_for(gen.__anext__(), 2)
            self.assertTrue(msg.startswith("event: change\ndata: "))
            d = json.loads(msg.split("data: ", 1)[1])
            self.assertEqual((d["group"], d["by"], d["client"]), ("g1", "bob", "tab-9"))
            self.assertTrue(other.queue.empty())
            await gen.aclose()
            self.assertNotIn(s, live._subs.get("g1", set()))
        asyncio.run(go())

    def test_removed_member_stream_ends(self):
        async def go():
            s = live.subscribe("g1", "bob")
            gen = live.stream(s, lambda: False, self._never_gone)
            await gen.__anext__()
            live.changed("g1", by="alice", what="members")
            self.assertEqual(await asyncio.wait_for(gen.__anext__(), 2),
                             "event: left\ndata: {}\n\n")
            with self.assertRaises(StopAsyncIteration):
                await gen.__anext__()
        asyncio.run(go())

    def test_caps(self):
        async def go():
            subs = [live.subscribe("g1", "alice") for _ in range(live.MAX_STREAMS_PER_USER)]
            self.assertIsNone(live.subscribe("g1", "alice"))
            self.assertIsNotNone(live.subscribe("g1", "bob"))
            for s in subs:
                live.unsubscribe(s)
        asyncio.run(go())

    def test_postgres_path_notifies_instead(self):
        os.environ["DATABASE_URL"] = "postgres://x"
        try:
            with mock.patch("api.pgstore._run") as run, \
                    mock.patch.object(live, "_deliver") as deliver:
                live.changed("g1", by="bob")
                run.assert_called_once()
                deliver.assert_not_called()
                run.side_effect = RuntimeError("db away")
                live.changed("g1", by="bob")
                deliver.assert_called_once()
            os.environ["ARYA_LIVE_PG"] = "0"
            with mock.patch("api.pgstore._run") as run:
                live.changed("g1")
                run.assert_not_called()
        finally:
            os.environ.pop("DATABASE_URL", None)
            os.environ.pop("ARYA_LIVE_PG", None)

    @staticmethod
    async def _never_gone():
        return False


class TestSaveSignals(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()

    def test_shared_saves_and_receipts_signal_personal_ones_do_not(self):
        with mock.patch.object(live, "changed") as ch:
            with state.as_user("alice", "abc123"):
                state.set_flag("milk", {"manual": True})
                state._save("receipts.json", [])
                state._save("quest.json", {})
                state._save("settings.json", {})
            with state.as_user("alice"):
                state.set_flag("milk", {"manual": True})
        self.assertEqual([c.args[0] for c in ch.call_args_list], ["abc123", "abc123"])
        self.assertEqual(ch.call_args_list[0].kwargs["by"], "alice")


class TestLiveRoute(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["ARYA_GROUPS"] = "1"
        os.environ.pop("DATABASE_URL", None)
        from fastapi.testclient import TestClient
        import api.main as main
        from api import deps
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        assert self.c.post("/auth/setup", json={"username": "alice", "password": "pw-alice"}).status_code == 200

    def tearDown(self):
        os.environ.pop("ARYA_GROUPS", None)

    def test_not_in_a_group_is_404(self):
        self.assertEqual(self.c.get("/api/group/live").status_code, 404)

    def test_membership_changes_signal(self):
        with mock.patch.object(live, "changed") as ch:
            self.c.post("/api/group", json={"name": "Home"})
            self.c.post("/api/group/rename", json={"name": "Our home"})
            self.c.post("/api/group/leave")
        whats = [c.kwargs.get("what") for c in ch.call_args_list]
        self.assertIn("members", whats)
        self.assertGreaterEqual(whats.count("members"), 2)

    def test_tab_id_reaches_the_signal(self):
        self.c.post("/api/group", json={"name": "Home"})
        seen = []
        with mock.patch.object(live, "changed",
                               side_effect=lambda gid, **k: seen.append(live.client_id.get())):
            self.c.post("/api/list/add", json={"name": "Milk"},
                        headers={"X-Arya-Client": "tab-1"})
        self.assertTrue(seen)
        self.assertEqual(set(seen), {"tab-1"})


class TestLiveShell(unittest.TestCase):
    def read(self, name):
        with open(os.path.join(os.path.dirname(__file__), "..", "pwa", name), encoding="utf-8") as fh:
            return fh.read()

    def test_app_sends_tab_id_and_listens(self):
        self.assertIn('"X-Arya-Client", CLIENT_ID', self.read("app.js"))
        js = self.read("group.js")
        self.assertIn('new EventSource("/api/group/live")', js)
        self.assertIn("d.client === CLIENT_ID", js)

    def test_worker_leaves_the_stream_alone(self):
        sw = self.read("sw.js")
        self.assertLess(sw.index('url.pathname === "/api/group/live") return;'),
                        sw.index("if (BYPASS"))


if __name__ == "__main__":
    unittest.main()
