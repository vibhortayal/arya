"""Clean names: printed receipt text -> the name a person writes on a list.

"ORG BLACKBRY" becomes "Blackberries - Organic". The format is fixed in
code: the product first, then the details that tell variants apart
(organic, flavor, brand, size) after a dash.

Where the names live: the dictionary (the household's name book), keyed
by item number. Receipts are never edited, so line totals, the
arithmetic checks and the ledger stay exactly as they were. Every
screen that reads state.names() shows the clean name.

Rules:
- One batched Spark text call per BATCH items (printed text, store
  chain, item number, usual price and pack detail; no photo).
- A name the household set (resolution "manual") or one already settled
  by research ("resolved") is never touched. Entries cleaned once carry
  named_by and are not asked again; the same item number on a later
  receipt reuses the name with no call.
- Below MIN_CONF the guess goes to To check as an unresolved entry
  (one-tap "It's ..." chip). The existing rule keeps it off suggestions
  until the household answers.
- Renaming never merges or splits items: each changed entry keeps the
  group key it had before (an explicit "group").
- Everything a change replaced is kept on the entry under "clean_undo",
  so undo() puts the name book back exactly.
- Nothing runs on its own until the owner applies once (the "clean_names"
  switch in the dictionary file). After that, judge_pending cleans the
  new items of each new receipt.
"""
import os
import re
import statistics
from collections import Counter

from api import state
from api.decode.service import load_hints, looks_abbreviated
from api.dictionary.build import FEE_RE
from api.dictionary.enrich import SECTIONS
from api.meta_client import parse_json
from api.prices import chain_of

VERSION = "clean-v1"
BATCH = 25
MIN_CONF = 0.8
MAX_ITEMS = 400
_PROMPT = os.path.join(os.path.dirname(__file__), "..", "..", "prompts", "clean_names_v1.md")
PLAN_FILE = "clean_names_plan.json"
_KEEP = {"manual", "resolved", "unresolved"}


def _prompt():
    with open(_PROMPT) as fh:
        return fh.read().split("SYSTEM:", 1)[1].strip() + "\n\n" + load_hints()


def _printed_style(name):
    """True for text that still reads like the receipt printed it."""
    n = (name or "").strip()
    return bool(n) and (looks_abbreviated(n) or (n.upper() == n and re.search(r"[A-Z]", n) is not None))


def compose(product, details=(), brand=None, size=None):
    """'Blackberries' + ['Organic'] -> 'Blackberries - Organic'."""
    product = " ".join(str(product or "").split())
    if not product:
        return ""
    extra = []
    for x in list(details or []) + [brand, size]:
        x = " ".join(str(x or "").split())
        if x and x.lower() not in {e.lower() for e in extra} and x.lower() not in product.lower():
            extra.append(x)
    return product + (" - " + ", ".join(extra) if extra else "")


def candidates():
    """Items whose shown name is still receipt text, with the evidence
    the model gets. Fees, settled names and cleaned names are left out."""
    entries = {e["item_id"]: e for e in state.dictionary()["entries"]}
    ev = {}
    for r in state.receipts():
        chain = chain_of(r.get("merchant"))
        for ln in r.get("lines", []):
            if ln.get("line_type") != "item" or not ln.get("sku"):
                continue
            iid = ln.get("item_id") or f"costco-{ln['sku']}"
            x = ev.setdefault(iid, {"printed": Counter(), "shown": None, "date": "",
                                    "stores": Counter(), "detail": Counter(), "prices": []})
            if ln.get("raw"):
                x["printed"][ln["raw"].strip()] += 1
            if (r.get("purchased_at") or "") >= x["date"]:
                x["date"] = r.get("purchased_at") or ""
                x["shown"] = ln.get("decoded_name") or ln.get("raw")
            if chain:
                x["stores"][chain] += 1
            if ln.get("detail"):
                x["detail"][str(ln["detail"])] += 1
            try:
                q = float(ln.get("qty") or 1) or 1
                if float(ln.get("line_total") or 0) > 0:
                    x["prices"].append(float(ln["line_total"]) / q)
            except (TypeError, ValueError):
                pass
    out = []
    for iid, x in ev.items():
        if not x["printed"]:
            continue
        sku = iid.split("-", 1)[1] if iid.startswith("costco-") else ""
        top = x["printed"].most_common(1)[0][0]
        e = entries.get(iid)
        if e is not None:
            status = (e.get("resolution") or {}).get("status")
            if e.get("named_by") or status in _KEEP or e.get("kind") == "fee":
                continue
            if not any(_printed_style(a) for a in [top] + list(e.get("aliases") or [])):
                continue
            current = e["canonical_name"]
        else:
            if FEE_RE.search(top) or not _printed_style(x["shown"] or top):
                continue
            current = x["shown"] or top
        out.append({"item_id": iid, "sku": sku, "current": current,
                    "printed": [p for p, _ in x["printed"].most_common(3)],
                    "store": x["stores"].most_common(1)[0][0] if x["stores"] else "",
                    "detail": x["detail"].most_common(1)[0][0] if x["detail"] else "",
                    "price": round(statistics.median(x["prices"]), 2) if x["prices"] else None,
                    "count": sum(x["printed"].values()), "last": x["date"]})
    out.sort(key=lambda c: -c["count"])
    return out[:MAX_ITEMS]


def _ask(client, batch):
    lines = []
    for n, c in enumerate(batch):
        price = f"${c['price']:.2f}" if c["price"] is not None else ""
        lines.append(f"[{n}] {' / '.join(c['printed'])} | {c['store']} | {c['sku']} | {price} | {c['detail']}")
    text, _u, _c = client.chat(
        [{"role": "system", "content": _prompt()},
         {"role": "user", "content": "\n".join(lines)}],
        mode="standard", personal=True, temperature=0.0,
        cache_key="arya-clean-names-v1")
    got = {}
    for v in (parse_json(text) or {}).get("names", []):
        try:
            n = int(v["n"])
            conf = max(0.0, min(1.0, float(v.get("confidence") or 0)))
        except (KeyError, TypeError, ValueError):
            continue
        if not 0 <= n < len(batch):
            continue
        name = compose(v.get("product"), v.get("details") or [], v.get("brand"), v.get("size"))
        if not name or len(name) > 80:
            continue
        alts = [" ".join(str(a).split()) for a in (v.get("alternatives") or [])
                if isinstance(a, str) and a.strip()][:2]
        sec = str(v.get("section") or "").lower().strip()
        got[n] = (name, conf, [a for a in alts if a.lower() != name.lower()],
                  sec if sec in SECTIONS else None)
    return got


def plan(client, items=None):
    """Ask the model for every candidate. Returns {"changes": [...],
    "same": int, "failed": int, "asked": int}. Writes nothing."""
    items = candidates() if items is None else items
    changes, same, failed = [], 0, 0
    for i in range(0, len(items), BATCH):
        batch = items[i:i + BATCH]
        try:
            got = _ask(client, batch)
        except Exception:
            got = {}
        for n, c in enumerate(batch):
            hit = got.get(n)
            if not hit:
                failed += 1
                continue
            name, conf, alts = hit[:3]
            if name.lower() == (c["current"] or "").lower():
                same += 1
                continue
            changes.append({"item_id": c["item_id"], "sku": c["sku"], "before": c["current"],
                            "after": name, "confidence": round(conf, 2), "alternatives": alts,
                            "check": conf < MIN_CONF, "printed": c["printed"],
                            "price": c["price"], "count": c["count"], "last": c["last"]})
    return {"version": VERSION, "asked": len(items), "changes": changes,
            "same": same, "failed": failed}


def _new_entry(ch):
    return {"item_id": ch["item_id"], "sku": ch["sku"], "canonical_name": ch["before"],
            "kind": "product", "category": None, "aliases": [], "spoken_names": [],
            "typical_unit": None, "sam_concept": None, "detail_variants": [],
            "purchase_count": ch.get("count") or 0, "median_price": ch.get("price"),
            "first_seen": ch.get("last"), "last_seen": ch.get("last"),
            "resolution": {"status": "auto", "confidence": None, "candidates": []}}


def apply(p):
    """Write a plan into the name book and turn on cleaning for new
    receipts. Returns how many names changed and how many went to
    To check. Receipts are not touched."""
    renamed = to_check = 0
    with state.file_lock("dictionary.json"):
        d = state.dictionary()
        by_id = {e["item_id"]: e for e in d["entries"]}
        for ch in p.get("changes", []):
            e = by_id.get(ch["item_id"])
            created = e is None
            if created:
                e = _new_entry(ch)
                d["entries"].append(e)
                by_id[e["item_id"]] = e
            elif e.get("named_by") or (e.get("resolution") or {}).get("status") in _KEEP:
                continue  # the household or an earlier pass got there first
            e["clean_undo"] = {"created": created, "canonical_name": e["canonical_name"],
                               "resolution": dict(e.get("resolution") or {}),
                               "group": e.get("group"), "aliases": list(e.get("aliases") or [])}
            # Keep the grouping the old name gave: a new name never merges
            # or splits purchase history.
            if not e.get("group"):
                e["group"] = e["item_id"] if created else state._norm_name(e["canonical_name"])
            for a in list(ch.get("printed") or []) + [ch["before"]]:
                if a and a not in e["aliases"]:
                    e["aliases"].append(a)
            e["named_by"] = VERSION
            if ch.get("check"):
                e["resolution"] = {"status": "unresolved", "confidence": ch["confidence"],
                                   "candidates": list(dict.fromkeys([ch["after"]] + ch.get("alternatives", []))),
                                   "by": VERSION}
                to_check += 1
            else:
                e["canonical_name"] = ch["after"]
                e["resolution"] = {"status": "auto", "confidence": ch["confidence"],
                                   "candidates": [], "by": VERSION}
                renamed += 1
        d["clean_names"] = {"on": True, "version": VERSION}
        state._save("dictionary.json", d)
    return {"renamed": renamed, "to_check": to_check}


def undo():
    """Put back every name this pass wrote, except the ones the
    household has since set by hand. Turns automatic cleaning off."""
    restored = kept = 0
    with state.file_lock("dictionary.json"):
        d = state.dictionary()
        out = []
        for e in d["entries"]:
            u = e.get("clean_undo")
            if not u:
                out.append(e)
                continue
            if (e.get("resolution") or {}).get("status") == "manual":
                e.pop("clean_undo", None)  # the household's word stays
                kept += 1
                out.append(e)
                continue
            restored += 1
            if u.get("created"):
                continue
            e["canonical_name"] = u["canonical_name"]
            e["resolution"] = u["resolution"]
            e["aliases"] = u["aliases"]
            if u.get("group"):
                e["group"] = u["group"]
            else:
                e.pop("group", None)
            for k in ("clean_undo", "named_by"):
                e.pop(k, None)
            out.append(e)
        d["entries"] = out
        d["clean_names"] = {"on": False, "version": VERSION}
        state._save("dictionary.json", d)
    return {"restored": restored, "kept_by_you": kept}


def is_on():
    return bool((state.dictionary().get("clean_names") or {}).get("on"))


def clean_new(client, limit=60):
    """After a receipt is filed: clean the items no name covers yet.
    Only once the owner has applied the pass. Never raises."""
    try:
        if not getattr(client, "api_key", "") or not is_on():
            return 0
        items = candidates()[:limit]
        if not items:
            return 0
        res = apply(plan(client, items))
        return res["renamed"] + res["to_check"]
    except Exception:
        return 0


def save_plan(p):
    state._save(PLAN_FILE, p)


def load_plan():
    return state._load(PLAN_FILE, None)


def summary(p, sample=25):
    """Readable dry-run text: counts plus a before/after sample."""
    ch = p["changes"]
    sure = [c for c in ch if not c["check"]]
    unsure = [c for c in ch if c["check"]]
    rows = [f"Items looked at: {p['asked']}",
            f"Would rename: {len(sure)}",
            f"Would ask in To check: {len(unsure)}",
            f"Already fine: {p['same']} | no answer: {p['failed']}",
            "", "Sample (before -> after, confidence):"]
    for c in sorted(sure, key=lambda c: -c["count"])[:sample]:
        rows.append(f"  {c['before']}  ->  {c['after']}  ({c['confidence']:.2f})")
    if unsure:
        rows += ["", "To check sample:"]
        for c in unsure[:10]:
            rows.append(f"  {c['before']}  ->  {c['after']}?  ({c['confidence']:.2f}; or {', '.join(c['alternatives']) or '-'})")
    return "\n".join(rows)


# --- To check smart pass ----------------------------------------------------
# Before To check asks, Arya proposes a name for each unsure receipt line:
# line["suggested"] = {name, section, confidence, by: "arya"}. A proposal
# only: the line stays unverified until the household taps it (rename) or
# keeps the printed name (confirm). A name the household already taught,
# or one the clean pass wrote, is reused with no model call. Lines the
# model could not read get suggest_tried, so reopening To check does not
# pay for them again.

SUGGEST_LIMIT = 150


def _learned():
    """sku -> a settled name from the name book (taught or cleaned)."""
    out = {}
    for e in state.dictionary()["entries"]:
        st = (e.get("resolution") or {}).get("status")
        if e.get("sku") and e.get("canonical_name") and st != "unresolved" and (
                st in ("manual", "resolved") or e.get("named_by")):
            out[e["sku"]] = {"name": e["canonical_name"], "section": e.get("section_guess")}
    return out


def suggest_review(client=None, limit=SUGGEST_LIMIT):
    """Fill suggested on To check lines that have none. Returns how many
    items (groups of lines with one item number) got a suggestion."""
    lines = [ln for ln in state.review_queue()["lines"]
             if not ln.get("suggested") and not ln.get("suggest_tried")]
    if not lines:
        return 0
    groups = {}
    for ln in lines:
        groups.setdefault(ln.get("sku") or ln.get("raw") or "", []).append(ln)
    learned = _learned()
    writes, ask, found = [], [], 0
    for key, g in groups.items():
        hit = learned.get(g[0].get("sku")) if g[0].get("sku") else None
        if hit and hit["name"].lower() != (g[0].get("decoded_name") or "").lower():
            s = {"name": hit["name"], "section": hit["section"], "confidence": 1.0, "by": "arya"}
            found += 1
            writes += [(ln["receipt_id"], ln["idx"], s) for ln in g]
        else:
            ask.append(g)
    ask = ask[:limit]
    if ask and getattr(client, "api_key", ""):
        items = []
        for g in ask:
            prices = [float(ln["line_total"]) / (float(ln.get("qty") or 1) or 1)
                      for ln in g if isinstance(ln.get("line_total"), (int, float)) and ln["line_total"] > 0]
            printed = list(dict.fromkeys(x for ln in g for x in (ln.get("raw"), ln.get("decoded_name")) if x))
            items.append({"sku": g[0].get("sku") or "", "printed": printed[:3],
                          "store": chain_of(g[0].get("merchant")), "detail": "",
                          "price": round(statistics.median(prices), 2) if prices else None})
        for i in range(0, len(items), BATCH):
            try:
                got = _ask(client, items[i:i + BATCH])
            except Exception:
                got = {}
            for n, g in enumerate(ask[i:i + BATCH]):
                hit = got.get(n)
                if hit and hit[0].lower() != (g[0].get("decoded_name") or "").lower():
                    s = {"name": hit[0], "section": hit[3], "confidence": round(hit[1], 2), "by": "arya"}
                    found += 1
                else:
                    s = None  # could not read it: remember, do not ask again
                writes += [(ln["receipt_id"], ln["idx"], s) for ln in g]
    state.suggest_lines(writes)
    return found


def save_section(sku, item_id, section):
    """The household accepted a suggestion: keep its shelf section on
    the item when the item has none yet."""
    if section not in SECTIONS:
        return
    with state.file_lock("dictionary.json"):
        d = state.dictionary()
        for e in d["entries"]:
            if e["item_id"] == item_id or (sku and e.get("sku") == sku):
                if not e.get("section_guess"):
                    e["section_guess"] = section
                    e["label_by"] = "household"
                    state._save("dictionary.json", d)
                return
