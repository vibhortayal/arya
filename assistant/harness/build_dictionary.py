#!/usr/bin/env python3
"""Build dictionary v1 from the staged Costco corpus + resolve ambiguities.
Resolution: ONE batched muse-spark-1.3 Standard call (owner data) via the
connector surrogate on Hatch, or MetaClient when MODEL_API_KEY is set.
Output goes to the workspace staging area — never into git (AGENTS rule 7).
Usage: build_dictionary.py <corpus.json> <out.json>"""
import importlib.util, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from api.decode.service import normalize_costco_json
from api.dictionary.build import aggregate

AMBIGUOUS = {"121288", "815544", "32911", "47266", "22967", "38479"}

RESOLVE_SYS = """You identify Costco products from receipt evidence. For each
SKU you get the printed description, pack detail, median price, and purchase
count. Return ONLY JSON: {"<sku>": {"name": str, "confidence": 0..1,
"alternatives": [str]}}. Use the exact retail product name. If the evidence
cannot decide between two real products, set confidence below 0.8 and list
both in alternatives. Do not guess a brand that is not in the evidence."""


def resolve(entries, call):
    targets = [e for e in entries if e["sku"] in AMBIGUOUS]
    evidence = {e["sku"]: {"desc": e["aliases"], "pack_detail": e.get("detail_variants", []), "median_price": e["median_price"],
                           "count": e["purchase_count"]} for e in targets}
    body = {"model": "muse-spark-1.3", "temperature": 0.1, "reasoning_effort": "low",
            "messages": [{"role": "system", "content": RESOLVE_SYS},
                         {"role": "user", "content": json.dumps(evidence)}]}
    status, payload = call("POST", "/v1/chat/completions", body)
    assert status == 200, f"resolve call HTTP {status}"
    out = payload["choices"][0]["message"]["content"]
    try:
        verdicts = json.loads(out)
    except Exception:
        verdicts = json.loads(out[out.find("{"): out.rfind("}") + 1])
    usage = payload.get("usage", {})
    for e in targets:
        v = verdicts.get(e["sku"])
        if not v:
            continue
        if v["confidence"] >= 0.8:
            e["canonical_name"] = v["name"]
            e["resolution"] = {"status": "resolved", "confidence": v["confidence"], "candidates": []}
        else:
            e["resolution"] = {"status": "unresolved", "confidence": v["confidence"],
                               "candidates": list(dict.fromkeys([v["name"]] + v.get("alternatives", [])))}
    return usage


def main():
    corpus = json.load(open(sys.argv[1]))
    entries = aggregate([normalize_costco_json(r) for r in corpus])
    if os.environ.get("MODEL_API_KEY"):
        from api.meta_client import MetaClient
        client = MetaClient()
        def call(method, path, body):
            import urllib.request
            req = urllib.request.Request("https://api.meta.ai/v1" + path.replace("/v1", "", 1),
                                         data=json.dumps(body).encode(), method=method,
                                         headers={"Content-Type": "application/json",
                                                  "Authorization": f"Bearer {client.api_key}"})
            import urllib.error
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    return resp.status, json.loads(resp.read().decode())
            except urllib.error.HTTPError as ex:
                return ex.code, {}
    else:
        spec = importlib.util.spec_from_file_location(
            "meta_api", os.path.expanduser("~/workspace/custom-connectors/custom.meta-model-api/bin/meta_api.py"))
        meta = importlib.util.module_from_spec(spec); spec.loader.exec_module(meta)
        call = meta.call
    usage = resolve(entries, call)
    fees = sum(1 for e in entries if e["kind"] == "fee")
    unres = [e["sku"] for e in entries if e["resolution"]["status"] == "unresolved"]
    json.dump({"version": 1, "entries": entries}, open(sys.argv[2], "w"), indent=1)
    print(f"entries={len(entries)} fees={fees} unresolved={unres} usage={usage}")
    for e in entries:
        if e["sku"] in AMBIGUOUS:
            print(e["sku"], "->", e["canonical_name"], e["resolution"])


if __name__ == "__main__":
    main()
