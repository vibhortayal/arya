"""Event-loop rule — review 2026-10-28, H1.

A slow model call must not freeze the app: while a photo decode
(blocking urllib, here a 2 s stand-in) is in flight, /health
answers immediately. Before the fix the decode ran on the event
loop and every other request queued behind it.
"""
import asyncio, os, tempfile, time, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"


class TestEventLoopFree(unittest.IsolatedAsyncioTestCase):
    async def test_health_answers_while_decode_in_flight(self):
        import httpx
        import api.main as main
        from api.routes import intake

        def slow_decode(body, client, media_type=None):
            time.sleep(2.0)
            return {"receipt_id": "r-slow", "merchant": "Test Mart",
                    "purchased_at": "2026-10-27", "lines": [],
                    "returns": [], "total_cents": 0, "tenders": []}

        orig_decode, orig_judge = intake.decode_photo, main.state.judge_pending
        intake.decode_photo = slow_decode
        main.state.judge_pending = lambda client: 0
        transport = httpx.ASGITransport(app=main.app)
        try:
            async with httpx.AsyncClient(transport=transport,
                                         base_url="http://t") as c:
                r = await c.post("/auth/setup", json={
                    "username": "loop@example.com", "password": "pw-test"})
                assert r.status_code == 200, r.text

                async def timed(coro):
                    t0 = time.monotonic()
                    resp = await coro
                    return resp, time.monotonic() - t0

                decode_resp, health_resp = await asyncio.gather(
                    timed(c.post("/decode/photo", content=b"\xff\xd8\xff x",
                                 headers={"Content-Type": "image/jpeg"})),
                    timed(c.get("/health")))
                self.assertEqual(decode_resp[0].status_code, 200,
                                 decode_resp[0].text)
                self.assertGreater(decode_resp[1], 1.8)
                self.assertEqual(health_resp[0].status_code, 200)
                self.assertLess(health_resp[1], 1.0,
                                "health waited behind the photo decode — "
                                "the model call is on the event loop")
        finally:
            intake.decode_photo, main.state.judge_pending = orig_decode, orig_judge


if __name__ == "__main__":
    unittest.main()
