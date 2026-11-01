#!/usr/bin/env python3
"""Gate 0 PUBLIC fixture set: blind decode of public receipt photos.

Isolation: reads photos ONLY from public-set/photos/, writes ONLY to
public-set/results/. The SYSTEM prompt is extracted verbatim from
spike2/decode_photo.py (read-only) and the Meta connector is imported
exactly as spike2/run_one.py imports it. Each call is stateless.
"""
import base64, glob, importlib.util, json, os

spec = importlib.util.spec_from_file_location(
    "meta_api",
    os.path.expanduser("~/workspace/custom-connectors/custom.meta-model-api/bin/meta_api.py"))
meta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(meta)

src = open(os.path.expanduser("~/workspace/meta-hackathon-2026/spike2/decode_photo.py")).read()
SYSTEM = src.split('SYSTEM = """')[1].split('"""')[0]

base = os.path.expanduser("~/workspace/meta-hackathon-2026/spike2/public-set")
for path in sorted(glob.glob(base + "/photos/pub-*.jpg")):
    name = os.path.splitext(os.path.basename(path))[0]
    b64 = base64.b64encode(open(path, "rb").read()).decode()
    body = {"model": "muse-spark-1.3", "temperature": 0.1,
            "messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": [
                             {"type": "text", "text": "Decode this receipt photo."},
                             {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b64}}]}]}
    status, payload = meta.call("POST", "/v1/chat/completions", body)
    out = {"http_status": status, "file": name}
    if status == 200:
        content = payload["choices"][0]["message"]["content"]
        out["usage"] = payload.get("usage", {})
        try:
            dec = json.loads(content)
        except Exception:
            dec = json.loads(content[content.find("{"):content.rfind("}") + 1])
        out["decoded"] = dec
        lines = dec.get("lines", [])
        ssum = round(sum(l["price"] for l in lines if isinstance(l.get("price"), (int, float))), 2)
        print(f"== {name}: {dec.get('store')} | {dec.get('date')} | lines={len(lines)} "
              f"(items_sold says {dec.get('items_sold')}) sum={ssum} "
              f"subtotal={dec.get('subtotal')} tax={dec.get('tax')} total={dec.get('total')} usage={out['usage']}")
        for l in lines:
            print(f"   {l.get('item_no')} | {l.get('brand')} {l.get('product')} {l.get('detail') or ''} "
                  f"| list {l.get('list_price')} paid {l.get('price')} disc {l.get('discount')} qty {l.get('qty')} "
                  f"| conf {l.get('confidence')}{' CHECK' if l.get('needs_user_check') else ''} alts={l.get('alternatives')}")
    else:
        out["error"] = payload
        print(f"== {name}: HTTP {status} {json.dumps(payload)[:400]}")
    json.dump(out, open(f"{base}/results/{name}.json", "w"), indent=2)
print("DONE")
