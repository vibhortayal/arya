"""Offline hunts (game shell, 2026-10-28): back aisles drop signal.
A grab or put back that cannot reach the server applies on the phone
and waits in an outbox, in order; it replays when the phone is back
online. A server refusal is never queued. Runs headless under node."""
import json, os, subprocess, tempfile, unittest

from tests.test_hunt_nav import NODE, PRELUDE, read

DRIVER = r"""
;(async () => {
  const out = {};
  let online = false;
  const sent = [];
  post = async (path, body) => {
    if (!online) throw new TypeError("No connection");
    if (body.item === "REFUSE") throw new Error("hunt is closed");
    sent.push([path, body]);
    return {};
  };
  toast = () => {};
  const s = { id: "s1", store: "TJ", mode: "quest", state: "playing",
    items: ["A", "B", "C"].map(n => ({ name: n, qty: 1, checked: false, group: n })) };
  Q.current = s; Q.scene = { setStops() {}, setNext() {}, glideTo() {}, destroy() {} };
  Q.storeReports = []; Q.focusIdx = -1; Q.arrived = true;
  await qCheck(s, "A", true);
  await qCheck(s, "B", true);
  await qCheck(s, "A", false);
  out.applied_locally = !s.items[0].checked && s.items[1].checked;
  out.queued_in_order = JSON.stringify(qOutbox().map(o => [o.item, o.checked])) === JSON.stringify([["A", true], ["B", true], ["A", false]]);
  out.nothing_sent_offline = sent.length === 0;
  online = true;
  await qFlushOutbox();
  out.replayed_in_order = JSON.stringify(sent.map(x => [x[1].item, x[1].checked])) === JSON.stringify([["A", true], ["B", true], ["A", false]]);
  out.outbox_empty = qOutbox().length === 0;
  // a refusal is not queued
  let threw = false;
  try { await qCheck(s, "REFUSE", true); } catch (e) { threw = true; }
  out.refusal_not_queued = threw && qOutbox().length === 0;
  // a refused op in the queue is dropped, the rest still syncs
  online = false;
  s.items.push({ name: "REFUSE", qty: 1, checked: false, group: "r" });
  await qCheck(s, "REFUSE", true);
  await qCheck(s, "C", true);
  online = true; sent.length = 0;
  await qFlushOutbox();
  out.refused_op_dropped = qOutbox().length === 0 && sent.length === 1 && sent[0][1].item === "C";
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""


class TestOfflineShell(unittest.TestCase):
    def test_banner_and_listeners(self):
        self.assertIn('id="hunt-offline"', read("index.html"))
        js = read("quest.js")
        self.assertIn('window.addEventListener("online"', js)
        self.assertIn("if (!(e instanceof TypeError) || !it) throw e;", js)
        # api() keeps network failures a TypeError, the outbox's key.
        self.assertIn('throw new TypeError("No connection right now', read("app.js"))


@unittest.skipUnless(NODE, "node not installed")
class TestOfflineNode(unittest.TestCase):
    def test_outbox(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "harness.js")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(PRELUDE)
                fh.write("globalThis.navigator = { onLine: false };\n")
                fh.write(read("quest.js"))
                fh.write(DRIVER)
            out = subprocess.run([NODE, path], capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        res = json.loads(out.stdout.strip().splitlines()[-1])
        self.assertNotIn("error", res, res.get("error"))
        failed = [k for k, v in res.items() if v is not True]
        self.assertEqual(failed, [], f"{failed} in {res}")


if __name__ == "__main__":
    unittest.main()
