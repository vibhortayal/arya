"""Open-weights jobs (owner, 2026-10-28): Muse Spark Open on
Baseten labels dictionary entries and sits as the staple judge's
second seat. Pins: personal data can never reach the open client;
enrichment fills only empty categories, arbitrates low confidence
with the hosted client, and stamps provenance; the second seat is
name-only, keeps the verdict shape, and its report counts agreement
without ever touching the deciding verdicts."""
import json
import unittest

from api.dictionary.enrich import (enrich_entries, label_corpus_agreement,
                                   label_names)
from api.judge import second_seat_batch, second_seat_report
from api.open_client import OpenClient


class StubClient:
    """Answers chat() with canned JSON keyed by a marker in the
    listing, so tests never touch a network."""

    def __init__(self, replies):
        self.replies = replies
        self.calls = []

    def chat(self, messages, **kw):
        self.calls.append((messages, kw))
        listing = messages[-1]["content"]
        for marker, payload in self.replies:
            if marker in listing:
                return json.dumps(payload), {}, 0.0
        return "{}", {}, 0.0


def labels_payload(rows):
    return {"labels": [{"item_id": i, "category": c, "section": s,
                        "confidence": k} for i, c, s, k in rows]}


class TestOpenClientPolicy(unittest.TestCase):
    def test_personal_is_refused_before_any_send(self):
        c = OpenClient(api_key="test", transport=lambda *a: {})
        with self.assertRaises(ValueError):
            c.chat([{"role": "user", "content": "x"}], personal=True)

    def test_missing_key_is_a_clear_stop(self):
        c = OpenClient(api_key="")
        with self.assertRaises(RuntimeError):
            c.chat([{"role": "user", "content": "x"}])

    def test_chat_shape_matches_meta_client(self):
        def transport(url, body, headers):
            assert body["model"] == "meta-models/muse-spark-open-1026"
            assert headers["Authorization"] == "Bearer k"
            return {"choices": [{"message": {"content": "hi"}}],
                    "usage": {"prompt_tokens": 5, "completion_tokens": 2}}
        c = OpenClient(api_key="k", transport=transport)
        text, usage, cost = c.chat([{"role": "user", "content": "x"}])
        self.assertEqual(text, "hi")
        self.assertEqual(usage["input_tokens"], 5)
        self.assertEqual(cost, 0.0)


class TestEnrichment(unittest.TestCase):
    def setUp(self):
        self.open_stub = StubClient([
            ("Almonds", labels_payload(
                [("costco-1", "pantry", "pantry", 0.95)])),
            ("Mystery", labels_payload(
                [("costco-2", "other", "other", 0.3)])),
        ])
        self.hosted_stub = StubClient([
            ("Mystery", labels_payload(
                [("costco-2", "household", "household", 0.9)])),
        ])
        self.entries = [
            {"item_id": "costco-1", "canonical_name": "Almonds",
             "category": None},
            {"item_id": "costco-2", "canonical_name": "Mystery Powder",
             "category": None},
            {"item_id": "costco-3", "canonical_name": "Eggs",
             "category": "dairy"},
        ]

    def test_fills_empty_and_arbitrates_weak(self):
        done = enrich_entries(self.entries, self.open_stub,
                              self.hosted_stub)
        self.assertEqual(done, 2)
        e1, e2, e3 = self.entries
        self.assertEqual((e1["category"], e1["label_by"]),
                         ("pantry", "spark-open"))
        self.assertEqual((e2["category"], e2["label_by"]),
                         ("household", "spark-arbiter"))
        self.assertEqual(e3["category"], "dairy")
        self.assertNotIn("label_by", e3)

    def test_no_personal_flag_ever_set(self):
        enrich_entries(self.entries, self.open_stub, self.hosted_stub)
        for _msgs, kw in self.open_stub.calls + self.hosted_stub.calls:
            self.assertFalse(kw.get("personal", False))

    def test_agreement_report_counts(self):
        a = StubClient([("", labels_payload(
            [("n0", "dairy", "dairy & eggs", 0.9),
             ("n1", "pantry", "pantry", 0.9)]))])
        b = StubClient([("", labels_payload(
            [("n0", "dairy", "dairy & eggs", 0.9),
             ("n1", "frozen", "frozen", 0.9)]))])
        rep = label_corpus_agreement(a, b, ["Milk", "Peas"])
        self.assertEqual(rep["labeled_both"], 2)
        self.assertEqual(rep["category_agreement"], 0.5)
        self.assertEqual([d["item"] for d in rep["disagreements"]],
                         ["Peas"])


class TestSecondSeat(unittest.TestCase):
    def test_name_only_verdicts_and_report(self):
        stub = StubClient([("", {"verdicts": [
            {"item_id": "a", "class": "STAPLE", "reason": "rhythm buy"},
            {"item_id": "b", "class": "ONE_OFF", "reason": "durables"},
        ]})])
        out = second_seat_batch(stub, [("a", "Milk"), ("b", "Phone Charger")])
        self.assertEqual(out["a"]["class"], "STAPLE")
        self.assertTrue(out["a"]["list_ok"])
        self.assertFalse(out["b"]["list_ok"])
        # the listing the model saw contains names and ids only
        listing = stub.calls[0][0][-1]["content"]
        self.assertIn("Milk", listing)
        self.assertNotIn("buys", listing)
        spark = {"a": {"class": "STAPLE", "reason": ""},
                 "b": {"class": "OCCASIONAL", "reason": ""}}
        rep = second_seat_report(out, spark, {"a": "Milk",
                                              "b": "Phone Charger"})
        self.assertEqual(rep["checked"], 2)
        self.assertEqual(rep["agreed"], 1)
        self.assertEqual(rep["disagreements"][0]["item_id"], "b")
        self.assertEqual(rep["disagreements"][0]["open_class"], "ONE_OFF")

    def test_label_names_roundtrip(self):
        stub = StubClient([("", labels_payload(
            [("n0", "fruit", "produce", 0.8)]))])
        got = label_names(stub, ["Blueberries"])
        self.assertEqual(got["Blueberries"]["category"], "fruit")


if __name__ == "__main__":
    unittest.main()
