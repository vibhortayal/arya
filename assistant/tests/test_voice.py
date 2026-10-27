import io, os, tempfile, unittest, wave

from api.cost_ledger import CostLedger
from api.meta_client import MetaClient, transcribe_cost
from api.voice.service import extract_transcript, inspect_wav, transcribe_audio


def wav_bytes(seconds=1.0, rate=16000, channels=1, width=2):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(b"\x00" * (width * channels) * int(rate * seconds))
    return buf.getvalue()


class TestTranscribeClient(unittest.TestCase):
    def test_multipart_request_shape_and_cost(self):
        cap = {}

        def transport(method, url, headers, body):
            cap.update(method=method, url=url, headers=headers, body=body)
            return 200, {"text": "milk and eggs"}

        c = MetaClient(api_key="test-key", transport=transport)
        payload, cost = c.transcribe(wav_bytes(2.0), 2.0)
        self.assertEqual(payload["text"], "milk and eggs")
        self.assertEqual(cap["method"], "POST")
        self.assertTrue(cap["url"].endswith("/v1/asr/transcribe"))
        self.assertEqual(cap["headers"]["Authorization"], "Bearer test-key")
        self.assertTrue(cap["headers"]["Content-Type"].startswith("multipart/form-data; boundary="))
        self.assertIn(b'name="model"', cap["body"])
        self.assertIn(b"muse-voice-transcribe-1.0", cap["body"])
        self.assertIn(b'name="audio"; filename="voice.wav"', cap["body"])
        # Verified live 2026-10-27: the endpoint requires a JSON
        # 'request' part carrying the model and audioEncoding "WAV".
        self.assertIn(b'name="request"', cap["body"])
        self.assertIn(b'"audioEncoding": "WAV"', cap["body"])
        self.assertIn(b"RIFF", cap["body"])
        # $0.18 per audio hour, independent of tokens
        self.assertAlmostEqual(cost, transcribe_cost(2.0), places=9)
        self.assertAlmostEqual(transcribe_cost(3600), 0.18, places=9)

    def test_ledger_row_written(self):
        path = os.path.join(tempfile.mkdtemp(), "ledger.jsonl")
        ledger = CostLedger(path)

        def transport(method, url, headers, body):
            return 200, {"text": "x"}

        c = MetaClient(api_key="k", transport=transport, ledger=ledger)
        c.transcribe(wav_bytes(1.0), 3600.0)
        rows = ledger.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["mode"], "voice")
        self.assertEqual(rows[0]["model"], "muse-voice-transcribe-1.0")
        self.assertAlmostEqual(rows[0]["cost_usd"], 0.18, places=6)

    def test_http_error_raises(self):
        def transport(method, url, headers, body):
            return 429, {"error": "slow down"}

        c = MetaClient(api_key="k", transport=transport)
        with self.assertRaises(RuntimeError):
            c.transcribe(wav_bytes(1.0), 1.0)


class TestInspectWav(unittest.TestCase):
    def test_valid(self):
        duration, rate = inspect_wav(wav_bytes(1.5, 16000))
        self.assertAlmostEqual(duration, 1.5, places=2)
        self.assertEqual(rate, 16000)
        duration, rate = inspect_wav(wav_bytes(0.5, 24000))
        self.assertEqual(rate, 24000)

    def test_rejects_stereo_odd_rate_and_garbage(self):
        with self.assertRaises(ValueError):
            inspect_wav(wav_bytes(1.0, channels=2))
        with self.assertRaises(ValueError):
            inspect_wav(wav_bytes(1.0, rate=8000))
        with self.assertRaises(ValueError):
            inspect_wav(wav_bytes(1.0, width=1))
        with self.assertRaises(ValueError):
            inspect_wav(b"not a wav at all")


class TestExtractTranscript(unittest.TestCase):
    def test_shapes(self):
        self.assertEqual(extract_transcript({"text": " milk "}), "milk")
        self.assertEqual(extract_transcript({"transcript": "eggs"}), "eggs")
        self.assertEqual(
            extract_transcript({"turns": [{"transcript": "oat milk"},
                                           {"transcript": "and eggs"}]}),
            "oat milk and eggs")
        self.assertEqual(
            extract_transcript({"segments": [{"text": "a"}, {"text": "b"}]}), "a b")
        self.assertEqual(extract_transcript({}), "")
        self.assertEqual(extract_transcript(None), "")


class StubAsrClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def transcribe(self, wav, duration_s):
        self.calls.append((wav, duration_s))
        return self.payload, transcribe_cost(duration_s)


class TestTranscribeAudio(unittest.TestCase):
    def test_round_trip(self):
        stub = StubAsrClient({"text": "sourdough, two"})
        out = transcribe_audio(wav_bytes(2.0), stub)
        self.assertEqual(out["text"], "sourdough, two")
        self.assertAlmostEqual(out["duration_s"], 2.0, places=2)
        self.assertAlmostEqual(stub.calls[0][1], 2.0, places=2)

    def test_empty_transcript_is_an_error(self):
        stub = StubAsrClient({"turns": []})
        with self.assertRaises(RuntimeError):
            transcribe_audio(wav_bytes(1.0), stub)

    def test_bad_wav_never_reaches_the_api(self):
        stub = StubAsrClient({"text": "x"})
        with self.assertRaises(ValueError):
            transcribe_audio(b"junk", stub)
        self.assertEqual(stub.calls, [])


if __name__ == "__main__":
    unittest.main()
