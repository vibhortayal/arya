"""Audit M2 (2026-10-30): the app's route map is not public. /docs,
/redoc and /openapi.json answer 404; the open Lists API keeps its own
schema at /api/v1/openapi.json. Pins api/main.py."""
import unittest

from fastapi.testclient import TestClient

from api.main import app


class TestApiDocsOff(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_docs_and_schema_are_gone(self):
        for path in ("/docs", "/redoc", "/openapi.json"):
            r = self.client.get(path)
            self.assertNotEqual(r.status_code, 200, path)
            self.assertNotIn("swagger", r.text.lower(), path)
            self.assertNotIn('"openapi"', r.text, path)

    def test_lists_api_schema_stays_public(self):
        r = self.client.get("/api/v1/openapi.json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("openapi", r.json())


if __name__ == "__main__":
    unittest.main()
