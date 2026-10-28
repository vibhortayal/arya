import unittest
from api.meta_client import MetaClient, estimate_cost


def fake_transport(capture):
    def t(method, url, headers, body):
        capture.update(method=method, url=url, headers=headers, body=body)
        return 200, {"choices": [{"message": {"content": "{}"}}],
                     "usage": {"prompt_tokens": 1000, "completion_tokens": 200,
                               "prompt_tokens_details": {"cached_tokens": 400}}}
    return t


class TestMetaClient(unittest.TestCase):
    def test_request_shape_and_mode_mapping(self):
        cap = {}
        c = MetaClient(api_key="test-key", transport=fake_transport(cap))
        text, usage, cost = c.chat([{"role": "user", "content": "hi"}], mode="standard", personal=True)
        self.assertTrue(cap["url"].endswith("/v1/chat/completions"))
        self.assertEqual(cap["headers"]["Authorization"], "Bearer test-key")
        self.assertEqual(cap["body"]["model"], "muse-spark-1.3")
        self.assertEqual(cap["body"]["reasoning_effort"], "low")
        self.assertEqual(usage["cached_tokens"], 400)
        self.assertAlmostEqual(cost, estimate_cost("standard", 1000, 400, 200), places=9)

    def test_personal_contributor_refused(self):
        c = MetaClient(api_key="k", transport=fake_transport({}))
        with self.assertRaises(ValueError):
            c.chat([], mode="contributor", personal=True)

    def test_generate_image_shape_and_cost(self):
        import base64
        cap = {}
        def t(method, url, headers, body):
            cap.update(method=method, url=url, headers=headers, body=body)
            return 200, {"data": [{"b64_json": base64.b64encode(b"WEBPDATA").decode()}],
                         "usage": {"images_generated": 1}}
        c = MetaClient(api_key="<redacted>", transport=t)
        img, usage, cost = c.generate_image("a mascot")
        self.assertTrue(cap["url"].endswith("/v1/images/generations"))
        self.assertEqual(cap["body"]["model"], "muse-image-1.0")
        self.assertEqual(cap["body"]["prompt"], "a mascot")
        self.assertEqual(img, b"WEBPDATA")
        self.assertEqual(usage, {"images_generated": 1})
        self.assertAlmostEqual(cost, 0.01, places=9)

    def test_cost_math(self):
        self.assertAlmostEqual(estimate_cost("standard", 1_000_000), 1.25, places=6)
        self.assertAlmostEqual(estimate_cost("standard", 1_000_000, cached_tokens=1_000_000), 0.15, places=6)
        self.assertAlmostEqual(estimate_cost("contributor", 1_000_000, output_tokens=1_000_000), 0.30, places=6)
        self.assertAlmostEqual(estimate_cost("wonder", 0, output_tokens=1_000_000), 20.00, places=6)


if __name__ == "__main__":
    unittest.main()
