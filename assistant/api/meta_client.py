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
import json, os, urllib.request

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


def estimate_cost(mode, input_tokens, cached_tokens=0, output_tokens=0):
    pin, pcache, pout = PRICES[mode]
    fresh = max(input_tokens - cached_tokens, 0)
    return (fresh * pin + cached_tokens * pcache + output_tokens * pout) / 1_000_000


class MetaClient:
    def __init__(self, api_key=None, transport=None, ledger=None):
        self.api_key = api_key if api_key is not None else os.environ.get("MODEL_API_KEY", "")
        self.transport = transport  # injectable for tests: fn(method, url, headers, body) -> (status, payload)
        self.ledger = ledger        # optional cost_ledger.CostLedger

    def _send(self, path, body):
        url = BASE + path
        headers = {"Content-Type": "application/json",
                   "Authorization": f"Bearer {self.api_key}"}
        if self.transport is not None:
            return self.transport("POST", url, headers, body)
        req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                     headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.status, json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode() or "{}")

    def chat(self, messages, mode="standard", personal=False,
             reasoning_effort="low", temperature=0.1):
        """One chat completion. Returns (text, usage_dict, cost_usd).
        usage keys are normalized: input_tokens, cached_tokens, output_tokens."""
        if personal and mode == "contributor":
            raise ValueError("personal data is Standard-only (MODEL-POLICY rule 3)")
        body = {"model": MODELS[mode], "messages": messages,
                "temperature": temperature, "reasoning_effort": reasoning_effort}
        status, payload = self._send("/chat/completions", body)
        if status != 200:
            raise RuntimeError(f"Meta API HTTP {status}: {str(payload)[:300]}")
        text = payload["choices"][0]["message"]["content"]
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
