"""Voice intake — Muse Voice Transcribe on the Meta Model API.

The browser records speech and encodes mono 16-bit PCM WAV at 16 kHz
(the batch endpoint's input contract); this module validates the WAV,
hands it to meta_client (the only module that calls the API), and
pulls the transcript text out of the response.

Nothing is persisted here: a transcript is returned to the caller,
which decides what it becomes (list items, a chat message). The demo
household therefore transcribes live and saves nothing, by construction.
"""
import io, wave

MAX_BYTES = 32_000_000        # API cap: 32 MB per request
MAX_SECONDS = 600             # API cap: 10 minutes per request
SAMPLE_RATES = (16000, 24000)


def inspect_wav(wav_bytes):
    """Return (duration_s, sample_rate) for an endpoint-ready WAV.
    Raises ValueError with a user-readable reason otherwise."""
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as w:
            channels = w.getnchannels()
            width = w.getsampwidth()
            rate = w.getframerate()
            frames = w.getnframes()
    except Exception:
        raise ValueError("that recording is not a WAV file Arya can send")
    if channels != 1:
        raise ValueError("the recording must be mono")
    if width != 2:
        raise ValueError("the recording must be 16-bit PCM")
    if rate not in SAMPLE_RATES:
        raise ValueError("the recording must be 16 or 24 kHz")
    duration = frames / rate if rate else 0.0
    if duration <= 0:
        raise ValueError("the recording is empty")
    if duration > MAX_SECONDS:
        raise ValueError("recordings are capped at 10 minutes — split it and try again")
    return duration, rate


def extract_transcript(payload):
    """Pull the transcript text out of an ASR response. The batch
    endpoint carries the text directly or as ordered turns; accept the
    documented shapes and join turn text in order."""
    if isinstance(payload, str):
        return payload.strip()
    if not isinstance(payload, dict):
        return ""
    for key in ("text", "transcript"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for key in ("turns", "segments"):
        parts = []
        for seg in payload.get(key) or []:
            if isinstance(seg, dict):
                t = seg.get("transcript") or seg.get("text")
                if t:
                    parts.append(str(t).strip())
        if parts:
            return " ".join(p for p in parts if p).strip()
    return ""


def transcribe_audio(wav_bytes, client):
    """Validate, then transcribe. Returns {"text", "duration_s",
    "cost_usd"}. ValueError = a recording the endpoint would refuse;
    RuntimeError = the API answered without a transcript."""
    if len(wav_bytes) > MAX_BYTES:
        raise ValueError("that recording is too large (32 MB max)")
    duration, _rate = inspect_wav(wav_bytes)
    payload, cost = client.transcribe(wav_bytes, duration)
    text = extract_transcript(payload)
    if not text:
        raise RuntimeError("the transcription came back empty")
    return {"text": text, "duration_s": round(duration, 2), "cost_usd": cost}
