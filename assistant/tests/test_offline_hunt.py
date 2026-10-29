"""Offline hunts (game shell, 2026-10-28): back aisles drop signal.
A grab or put back that cannot reach the server applies on the phone
and waits in an outbox, in order; it replays when the phone is back
online. A server refusal is never queued. The outbox lives in
web/src/screens/hunt/model.ts; its behaviour runs under vitest in
hunt/model.test.ts ("the offline outbox")."""
import unittest

from tests import frontend


class TestOfflineShell(unittest.TestCase):
    def test_banner_and_listeners(self):
        self.assertIn('<p id="hunt-offline" className="offlinenote" role="status" hidden={!offlineText}>',
                      frontend.src("screens/Hunt.tsx"))
        model = frontend.src("screens/hunt/model.ts")
        self.assertIn('window.addEventListener("online", () => { qFlushOutbox(); });', model)
        self.assertIn("if (!(e instanceof TypeError) || !it) throw e;", model)
        # api() keeps network failures a TypeError, the outbox's key.
        self.assertIn('throw new TypeError("No connection right now', frontend.src("lib/api.ts"))


class TestOfflineUnderVitest(unittest.TestCase):
    def test_outbox(self):
        t = frontend.src("screens/hunt/model.test.ts")
        for name in ("a grab offline applies on the phone, queues in order, and replays in order",
                     "a refusal is never queued; a refused entry in the queue is dropped and the rest syncs"):
            self.assertIn(name, t)


if __name__ == "__main__":
    unittest.main()
