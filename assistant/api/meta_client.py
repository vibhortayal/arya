"""meta_client — the only module that calls the Meta Model API.

Contract: IMPLEMENTATION §2.2 + docs/MODEL-POLICY.md.
- Base URL https://api.meta.ai/v1; auth = Bearer key from env MODEL_API_KEY.
  The key is never in code and never in this repo.
- Endpoint note: §2.2 lists POST /v1/responses; spikes 1-2 verified
  POST /v1/chat/completions end-to-end on this team's key. This client uses
  the verified endpoint. Revisit if the responses endpoint is adopted.
- Mode discipline: personal data (the owner's real records) is Standard
  only. Contributor mode is for eval loops on synthetic/public data and is
  refused for personal payloads.
"""
import json, os, urllib.request, uuid

BASE = "https://api.meta.ai/v1"

MODELS = {
    "standard": "muse-spark-1.3",
    "contributor": "muse-spark-1.3-contributor",
    "wonder": "muse-wonder-1.0",
    "image": "muse-image-1.0",
    "voice": "muse-voice-transcribe-1.0",
    "sam": "sam-3.1",
}

# USD per 1M tokens: (input, cached_input, output). MODEL-POLICY.md is the
# source; keep the two in sync.
PRICES = {
    "standard": (1.25, 0.15, 4.25),
    "contributor": (0.10, 0.002, 0.20),
    "wonder": (4.00, 0.20, 20.00),
}

# Muse Voice Transcribe is billed per audio hour, not per token
# (MODEL-POLICY.md; Meta docs read 2026-10-27).
ASR_USD_PER_HOUR = 0.18

# SAM 3.1 is billed per image processed (MODEL-POLICY.md).
SAM_USD_PER_IMAGE = 2.50 / 1000.0

# Muse Image is billed per image generated (MODEL-POLICY.md).
IMAGE_USD_PER_IMAGE = 0.01


def transcribe_cost(duration_s):
    return duration_s / 3600 * ASR_USD_PER_HOUR


def estimate_cost(mode, input_tokens, cached_tokens=0, output_tokens=0):
    pin, pcache, pout = PRICES[mode]
    fresh = max(input_tokens - cached_tokens, 0)
    return (fresh * pin + cached_tokens * pcache + output_tokens * pout) / 1_000_000


class MetaClient:
    def __init__(self, api_key=None, transport=None, ledger=None):
        self.api_key = api_key if api_key is not None else os.environ.get("MODEL_API_KEY", "")
        self.transport = transport  # injectable for tests: fn(method, url, headers, body) -> (status, payload)
        self.ledger = ledger        # optional cost_ledger.CostLedger

    def _via_transport(self, method, url, headers, body):
        """The injectable transport, under the same error contract
        as the real one: a network failure is a RuntimeError, never
        a raw urllib/TimeoutError escaping to a route (review H3)."""
        try:
            return self.transport(method, url, headers, body)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise RuntimeError(f"Meta API unreachable: {e}") from e

    @staticmethod
    def _parse_body(raw, status):
        """A gateway error page is not JSON. Parse what is, and
        carry the rest as text so the caller's status check raises
        a RuntimeError with the HTTP code — never a JSONDecodeError
        surfacing as a bare 500."""
        try:
            return json.loads(raw or "{}")
        except json.JSONDecodeError:
            if status == 200:
                raise RuntimeError("Meta API returned a non-JSON response")
            return {"error": (raw or "")[:300]}

    def _send(self, path, body, timeout=None):
        url = BASE + path
        headers = {"Content-Type": "application/json",
                   "Authorization": f"Bearer {self.api_key}"}
        if self.transport is not None:
            return self._via_transport("POST", url, headers, body)
        req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                     headers=headers, method="POST")
        try:
            with urllib.request.urlopen(
                    req, timeout=120 if timeout is None else timeout) as resp:
                status = resp.status
                raw = resp.read().decode(errors="replace")
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace") if e.fp else ""
            return e.code, self._parse_body(raw, e.code)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise RuntimeError(f"Meta API unreachable: {e}") from e
        return status, self._parse_body(raw, status)

    def chat(self, messages, mode="standard", personal=False,
             reasoning_effort="low", temperature=0.1, timeout=None):
        """One chat completion. Returns (text, usage_dict, cost_usd).
        usage keys are normalized: input_tokens, cached_tokens, output_tokens.
        reasoning_effort=None omits the key entirely — Wonder's production
        configuration per WONDER-EVAL (no effort key sent). timeout bounds
        the HTTP call in seconds; None keeps the 120 s default."""
        if personal and mode == "contributor":
            raise ValueError("personal data is Standard-only (MODEL-POLICY rule 3)")
        body = {"model": MODELS[mode], "messages": messages,
                "temperature": temperature}
        if reasoning_effort is not None:
            body["reasoning_effort"] = reasoning_effort
        status, payload = self._send("/chat/completions", body, timeout=timeout)
        if status != 200:
            raise RuntimeError(f"Meta API HTTP {status}: {str(payload)[:300]}")
        try:
            text = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise RuntimeError(
                f"Meta API: unexpected response shape: {str(payload)[:300]}")
        u = payload.get("usage", {})
        cached = (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0)
        usage = {"input_tokens": u.get("prompt_tokens", u.get("input_tokens", 0)),
                 "cached_tokens": cached,
                 "output_tokens": u.get("completion_tokens", u.get("output_tokens", 0))}
        cost = estimate_cost(mode, usage["input_tokens"], usage["cached_tokens"],
                             usage["output_tokens"])
        if self.ledger is not None:
            self.ledger.record(mode=mode, model=MODELS[mode], **usage, cost_usd=cost)
        return text, usage, cost

    def segment(self, image_bytes, prompt, media_type="image/jpeg"):
        """SAM 3.1 segmentation for one text prompt (the /responses
        surface — the one non-chat endpoint this client uses; shape
        verified by the Stage D and Shelf Scan spikes). Returns
        (boxes, usage, cost_usd): boxes are {box: [x1, y1, x2, y2]
        in frame pixels, w, h, confidence} parsed from SAM's box
        tokens. Cost is per image processed, logged to the ledger
        like every other door."""
        import base64, re
        uri = (f"data:{media_type};base64,"
               + base64.b64encode(image_bytes).decode())
        body = {"model": MODELS["sam"], "stream": False,
                "input": [{"type": "message", "role": "user", "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": uri}]}],
                "metadata": {"include_confidence": "true"}}
        status, payload = self._send("/responses", body)
        if not isinstance(payload, dict):
            raise RuntimeError(f"SAM: unexpected response: {str(payload)[:300]}")
        if status != 200 or payload.get("status") != "completed":
            raise RuntimeError(f"SAM HTTP {status}: {str(payload)[:300]}")
        images = (payload.get("usage") or {}).get("images_processed", 1)
        cost = images * SAM_USD_PER_IMAGE
        if self.ledger is not None:
            self.ledger.record(mode="sam", model=MODELS["sam"],
                               input_tokens=0, cached_tokens=0,
                               output_tokens=0, cost_usd=cost)
        text = ""
        for item in payload.get("output") or []:
            for part in item.get("content") or []:
                if part.get("type") == "output_text":
                    text += part.get("text", "")
        boxes = []
        for m in re.finditer(r"(\d+)<\|box;([^|]*)\|>", text):
            fields = {}
            for part in m.group(2).split(";"):
                if "=" in part:
                    k, v = part.split("=", 1)
                    fields[k.strip()] = v.strip()
            try:
                box = [int(fields["x1"]), int(fields["y1"]),
                       int(fields["x2"]), int(fields["y2"])]
                w, h = int(fields["w"]), int(fields["h"])
            except (KeyError, ValueError):
                continue
            try:
                conf = float(fields["c"]) if "c" in fields else None
            except ValueError:
                conf = None
            boxes.append({"box": box, "w": w, "h": h, "confidence": conf})
        return boxes, {"images_processed": images}, cost

    def generate_image(self, prompt):
        """Muse Image generation (POST /v1/images/generations; shape
        verified by probe 2026-10-27: data[0].b64_json carries the
        image bytes, WebP). Returns (image_bytes, usage, cost_usd);
        cost is per image generated, logged to the ledger like every
        other door. Used offline by tools (celebration characters);
        generated art never claims to picture a real store."""
        import base64
        body = {"model": MODELS["image"], "prompt": prompt}
        status, payload = self._send("/images/generations", body)
        if status != 200 or not isinstance(payload, dict):
            raise RuntimeError(f"Meta API HTTP {status}: {str(payload)[:300]}")
        data = payload.get("data") or []
        if not data or not data[0].get("b64_json"):
            raise RuntimeError(f"Muse Image: no image in response: {str(payload)[:300]}")
        image_bytes = base64.b64decode(data[0]["b64_json"])
        usage = payload.get("usage") or {}
        cost = IMAGE_USD_PER_IMAGE
        if self.ledger is not None:
            self.ledger.record(mode="image", model=MODELS["image"],
                               input_tokens=0, cached_tokens=0,
                               output_tokens=0, cost_usd=cost)
        return image_bytes, usage, cost

    def edit_image(self, image_bytes, prompt, media_type="image/jpeg"):
        """Muse Image edits (POST /v1/images/edits, multipart; same
        response shape as generations). Returns (image_bytes, usage,
        cost_usd), billed per image like generate_image. The input
        bytes are sent once and not kept here."""
        import base64
        status, payload = self._send_multipart(
            "/images/edits",
            {"model": MODELS["image"], "prompt": prompt,
             "response_format": "b64_json"},
            ("image", "photo", media_type, image_bytes))
        if status != 200 or not isinstance(payload, dict):
            raise RuntimeError(f"Meta API HTTP {status}: {str(payload)[:300]}")
        data = payload.get("data") or []
        if not data or not data[0].get("b64_json"):
            raise RuntimeError(f"Muse Image: no image in response: {str(payload)[:300]}")
        out = base64.b64decode(data[0]["b64_json"])
        cost = IMAGE_USD_PER_IMAGE
        if self.ledger is not None:
            self.ledger.record(mode="image", model=MODELS["image"],
                               input_tokens=0, cached_tokens=0,
                               output_tokens=0, cost_usd=cost)
        return out, payload.get("usage") or {}, cost

    def _send_multipart(self, path, fields, file_part, json_fields=None):
        """POST multipart/form-data. file_part = (field, filename,
        content_type, bytes). json_fields are emitted as parts with
        Content-Type: application/json (the ASR endpoint's 'request'
        part). The injected transport receives the raw body bytes,
        same (status, payload) contract as _send."""
        boundary = "arya-" + uuid.uuid4().hex
        chunks = []
        for name, value in (json_fields or {}).items():
            chunks.append((f"--{boundary}\r\nContent-Disposition: form-data; "
                           f"name=\"{name}\"\r\nContent-Type: application/json"
                           f"\r\n\r\n{json.dumps(value)}\r\n").encode())
        for name, value in fields.items():
            chunks.append((f"--{boundary}\r\nContent-Disposition: form-data; "
                           f"name=\"{name}\"\r\n\r\n{value}\r\n").encode())
        field, filename, ctype, data = file_part
        chunks.append((f"--{boundary}\r\nContent-Disposition: form-data; "
                       f"name=\"{field}\"; filename=\"{filename}\"\r\n"
                       f"Content-Type: {ctype}\r\n\r\n").encode())
        chunks.append(data)
        chunks.append(f"\r\n--{boundary}--\r\n".encode())
        body = b"".join(chunks)
        url = BASE + path
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}",
                   "Authorization": f"Bearer {self.api_key}"}
        if self.transport is not None:
            return self._via_transport("POST", url, headers, body)
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                status = resp.status
                raw = resp.read().decode(errors="replace")
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace") if e.fp else ""
            return e.code, self._parse_body(raw, e.code)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise RuntimeError(f"Meta API unreachable: {e}") from e
        return status, self._parse_body(raw, status)

    def transcribe(self, wav_bytes, duration_s, filename="voice.wav"):
        """Muse Voice Transcribe, batch endpoint (POST /v1/asr/transcribe).
        Input contract (Meta docs): mono 16-bit PCM WAV at 16 or 24 kHz;
        32 MB and 10 minutes per request. Auth is the Bearer header
        (unlike the realtime WebSocket, which authenticates in-band).
        Returns (payload, cost_usd); the caller pulls the text out of
        the payload — see api/voice/service.py."""
        status, payload = self._send_multipart(
            "/asr/transcribe", {},
            ("audio", filename, "audio/wav", wav_bytes),
            json_fields={"request": {"model": MODELS["voice"],
                                     "audioEncoding": "WAV"}})
        if status != 200 or not isinstance(payload, dict):
            raise RuntimeError(f"Meta API HTTP {status}: {str(payload)[:300]}")
        cost = transcribe_cost(duration_s)
        if self.ledger is not None:
            self.ledger.record(mode="voice", model=MODELS["voice"],
                               input_tokens=0, cached_tokens=0, output_tokens=0,
                               cost_usd=cost)
        return payload, cost
