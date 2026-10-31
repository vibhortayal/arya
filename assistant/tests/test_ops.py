"""Ops review 2026-10-31: failed and slow model calls are booked, /health
tells the uptime monitor about a full disk, and the ops report reads it."""
import json, os, tempfile, time, unittest
from unittest import mock

from api.cost_ledger import CostLedger
from api.meta_client import MetaClient


def ok_transport(method, url, headers, body):
    return 200, {"choices": [{"message": {"content": "{}"}}],
                 "usage": {"prompt_tokens": 10, "completion_tokens": 5}}


def deny_transport(method, url, headers, body):
    return 401, {"error": "bad key"}


class TestLedgerRows(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "ledger.jsonl")

    def test_success_row_carries_latency(self):
        led = CostLedger(self.path)
        MetaClient(api_key="k", transport=ok_transport, ledger=led).chat(
            [{"role": "user", "content": "hi"}])
        row = led.rows()[0]
        self.assertIn("ms", row)
        self.assertNotIn("ok", row)

    def test_failed_call_is_booked_at_zero_cost(self):
        led = CostLedger(self.path, user="ann")
        c = MetaClient(api_key="k", transport=deny_transport, ledger=led)
        with self.assertRaises(RuntimeError):
            c.chat([{"role": "user", "content": "hi"}], mode="wonder")
        row = led.rows()[0]
        self.assertIs(row["ok"], False)
        self.assertEqual(row["err"], "http_401")
        self.assertEqual(row["mode"], "wonder")
        self.assertEqual(row["cost_usd"], 0)
        self.assertEqual(led.total_usd(), 0)

    def test_voice_failure_is_booked(self):
        led = CostLedger(self.path)
        with self.assertRaises(RuntimeError):
            MetaClient(api_key="k", transport=deny_transport, ledger=led).transcribe(b"w", 2.0)
        self.assertEqual(led.rows()[0]["mode"], "voice")

    def test_failed_rows_do_not_count_as_usage(self):
        led = CostLedger(self.path, user="ann")
        led.record("standard", "m", 1, 0, 1, 0.01)
        led.record("standard", "m", ok=False, err="timeout")
        self.assertEqual(led.usage("ann")["kinds"]["helps"]["n"], 1)
        self.assertEqual(led.whole()["people"], 1)

    def test_health_counts_failures_and_percentiles(self):
        led = CostLedger(self.path, user="ann")
        for ms in (100, 200, 300, 400):
            led.record("standard", "m", 1, 0, 1, 0.01, ms=ms)
        led.record("standard", "m", ok=False, err="timeout", ms=900)
        h = led.health(24)["by_mode"]["standard"]
        self.assertEqual((h["calls"], h["failed"]), (5, 1))
        self.assertEqual(h["errs"], {"timeout": 1})
        self.assertEqual(h["p50_ms"], 300)
        self.assertEqual(led.health(24)["top_users"][0][0], "ann")

    def test_old_rows_without_new_fields_still_read(self):
        with open(self.path, "w") as fh:
            fh.write(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "mode": "standard",
                                 "model": "m", "cost_usd": 0.02}) + "\n")
        self.assertEqual(CostLedger(self.path).health(24)["by_mode"]["standard"]["calls"], 1)


class TestHealth(unittest.TestCase):
    def test_full_disk_answers_503(self):
        from fastapi.testclient import TestClient
        from api.main import app
        with mock.patch.dict(os.environ, {"ARYA_HEALTH_MIN_FREE_MB": "99999999"}):
            r = TestClient(app).get("/health")
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["status"], "degraded")
        with mock.patch.dict(os.environ, {"ARYA_HEALTH_MIN_FREE_MB": "1",
                                          "ARYA_DATA_DIR": tempfile.mkdtemp()}):
            r = TestClient(app).get("/health")
        self.assertEqual(r.json(), {"status": "ok", "service": "arya-api", "stage": 3})


class TestOpsReport(unittest.TestCase):
    def test_report_flags_a_failing_mode_and_quiet_otherwise(self):
        from api import deps
        from harness import ops
        d = tempfile.mkdtemp()
        with mock.patch.dict(os.environ, {"ARYA_DATA_DIR": d}), \
                mock.patch.object(deps, "_LEDGER", os.path.join(d, "cost-ledger.jsonl")):
            subject, text = ops.build(24)
            self.assertIn("all quiet", subject)
            led = CostLedger(deps._LEDGER)
            for _ in range(6):
                led.record("wonder", "m", ok=False, err="http_503")
            subject, text = ops.build(24)
            self.assertIn("wonder: 6 of 6 calls failed", text)
            self.assertIn("Needs a look", subject)


if __name__ == "__main__":
    unittest.main()
