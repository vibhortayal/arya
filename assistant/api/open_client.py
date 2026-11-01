"""Open-weights client — Muse Spark Open on Baseten (owner, 2026-10-28).

The hosted Meta Model API (meta_client) stays the brain. This client
runs BATCH jobs on Meta's open-weights model through the hackathon's
inference partner, for work that is platform data only:

- dictionary enrichment (item name -> cast category + section guess)
- the staple judge's second seat (name-only classification)

Personal data NEVER goes through this client (MODEL-POLICY rule 3,
AGENTS.md rule 1): chat() raises on personal=True instead of sending.
Purchase facts, counts, prices, dates, and receipt text stay on
hosted Standard. The client mirrors MetaClient's shape — chat()
returns (text, usage, cost_usd) — so batch code can take either.

Key: BASETEN_API_KEY in the environment. Model: ARYA_OPEN_MODEL,
defaulting to the hackathon credit-form slug. Cost is reported as
0.0: partner credit is a flat grant, and usage tokens are returned
for the record instead.
"""
import json
import os
import urllib.error
import urllib.request

BASE_URL = "https://inference.baseten.co/v1/chat/completions"
DEFAULT_MODEL = "meta-models/muse-spark-open-1026"


class OpenClient:
    def __init__(self, api_key=None, transport=None, model=None):
        self.api_key = api_key if api_key is not None else os.environ.get(
            "BASETEN_API_KEY", "")
        # An env var set-but-empty (compose ${VAR:-}) means unset.
        from api import site_flags   # the Ops name wins over the environment
        self.model = model or site_flags.open_model() or os.environ.get("ARYA_OPEN_MODEL") \
            or DEFAULT_MODEL
        self.transport = transport  # tests: fn(url, body, headers) -> dict

    def _post(self, body, timeout):
        if self.transport is not None:
            return self.transport(BASE_URL, body,
                                  {"Authorization": f"Bearer {self.api_key}"})
        req = urllib.request.Request(
            BASE_URL, data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode(errors="replace"))
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace") if e.fp else ""
            raise RuntimeError(f"Baseten HTTP {e.code}: {raw[:200]}") from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise RuntimeError(f"Baseten unreachable: {e}") from e

    def chat(self, messages, mode="open", personal=False,
             reasoning_effort=None, temperature=0.1, timeout=60):
        """One chat completion -> (text, usage_dict, 0.0).

        personal=True raises: this client is third-party infra and
        personal data is hosted-Standard-only, by policy."""
        if personal:
            raise ValueError(
                "personal data never goes to the open-weights client "
                "(MODEL-POLICY rule 3) — use hosted Standard")
        if not self.api_key:
            raise RuntimeError(
                "BASETEN_API_KEY is not set — the open-weights batch "
                "jobs stay off until the operator provisions it")
        body = {"model": self.model, "messages": messages,
                "temperature": temperature}
        data = self._post(body, timeout)
        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise RuntimeError(f"Baseten reply shape: {str(data)[:200]}") from e
        u = data.get("usage") or {}
        usage = {"input_tokens": u.get("prompt_tokens", 0),
                 "cached_tokens": 0,
                 "output_tokens": u.get("completion_tokens", 0)}
        return text, usage, 0.0
