"""Curator — Arya's identity reasoning agent.

The pattern engine groups products by name spelling. Spelling is brittle:
"5Dz Eggs" and "5 Dz Eggs" are one product; "Organic Fr Eggs" is another.
The Curator reasons over candidate clusters (built in code for $0) and
PROPOSES merges and splits with reasons. A proposal changes nothing until
the user applies it — no silent edits, ever.
Personal data: Standard mode only (enforced in meta_client).
"""
import hashlib, json, os, re
from collections import Counter, defaultdict

from api import state

PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts",
                           "curator_v1.md")
UNITS = {"oz", "lb", "lbs", "ct", "dz", "gal", "ml", "kg", "mg", "pk",
         "pack", "x", "fl", "pt", "qt", "each", "count"}


def load_prompt():
    return open(PROMPT_PATH).read().split("SYSTEM:", 1)[1].strip()


def _tokens(name):
    return [t for t in re.findall(r"[a-z]+", (name or "").lower())
            if t not in UNITS and len(t) > 1]


def clusters():
    """Candidate clusters: entries linked by a shared distinctive token
    or by an identical normalized name. Singletons are not candidates."""
    entries = [e for e in state.dictionary()["entries"]
               if e.get("kind") != "fee" and not e.get("unresolved")]
    toks, freq = {}, Counter()
    for e in entries:
        t = set(_tokens(e["canonical_name"]))
        toks[e["item_id"]] = t
        freq.update(t)
    distinctive = {t for t, c in freq.items() if 2 <= c <= 8}
    parent = {e["item_id"]: e["item_id"] for e in entries}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    by_token = defaultdict(list)
    for iid, t in toks.items():
        for tok in t & distinctive:
            by_token[tok].append(iid)
    for ids in by_token.values():
        for other in ids[1:]:
            union(ids[0], other)
    by_name = defaultdict(list)
    for e in entries:
        by_name[state._norm_name(e["canonical_name"])].append(e["item_id"])
    for ids in by_name.values():
        for other in ids[1:]:
            union(ids[0], other)
    groups = defaultdict(list)
    for iid in parent:
        groups[find(iid)].append(iid)
    return [sorted(ids) for ids in groups.values() if len(ids) > 1]


def _facts(item_ids):
    """Buys and stores per item, counted from the receipts (code, $0)."""
    buys = Counter({i: 0 for i in item_ids})
    stores = defaultdict(set)
    for r in state.receipts():
        for ln in r["lines"]:
            iid = ln.get("item_id")
            if iid in buys and ln.get("line_type") == "item":
                buys[iid] += 1
                if r.get("merchant"):
                    stores[iid].add(r["merchant"])
    return buys, stores


def run_curator(client):
    cls = clusters()
    if not cls:
        return 0
    nm = state.names()
    all_ids = [i for c in cls for i in c]
    buys, stores = _facts(all_ids)
    blocks = []
    for n, c in enumerate(cls):
        lines = [f"Cluster {n}:"]
        for iid in c:
            lines.append(f"  [{iid}] {nm.get(iid, iid)} — {buys[iid]} buys"
                         f" — stores: {', '.join(sorted(stores[iid])) or 'unknown'}")
        blocks.append("\n".join(lines))
    messages = [{"role": "system", "content": load_prompt()},
                {"role": "user", "content":
                 "Judge these product clusters:\n\n" + "\n\n".join(blocks)}]
    out, _usage, _cost = client.chat(messages, mode="standard", personal=True)
    try:
        verdict = json.loads(out)
    except Exception:
        verdict = json.loads(out[out.find("{"): out.rfind("}") + 1])
    cluster_of = {}
    for c in cls:
        for iid in c:
            cluster_of[iid] = frozenset(c)
    store = state.curator_store()
    pending_keys = {frozenset(p["members"]) for p in store["proposals"]
                    if p["status"] == "pending"}
    dismissed = {frozenset(d) for d in store["dismissed"]}
    added = 0
    for m in verdict.get("merges", []):
        members = sorted(x for x in m.get("members", []) if x in cluster_of)
        if len(members) < 2 or len(set(cluster_of[x] for x in members)) != 1:
            continue  # a merge never crosses clusters
        key = frozenset(members)
        if key in pending_keys or key in dismissed:
            continue
        store["proposals"].append({
            "id": "cur-" + hashlib.sha1(",".join(members).encode()).hexdigest()[:8],
            "kind": "merge", "members": members,
            "names": [nm.get(x, x) for x in members],
            "into_name": m.get("name") or nm.get(members[0], members[0]),
            "reason": m.get("reason", ""), "status": "pending"})
        pending_keys.add(key)
        added += 1
    for sp in verdict.get("splits", []):
        iid = sp.get("item_id")
        if iid not in cluster_of:
            continue
        key = frozenset([iid])
        store["proposals"].append({
            "id": "cur-" + hashlib.sha1(("split:" + iid).encode()).hexdigest()[:8],
            "kind": "split", "members": [iid], "names": [nm.get(iid, iid)],
            "into_name": nm.get(iid, iid),
            "reason": sp.get("reason", ""), "status": "pending"})
        added += 1
    state.save_curator(store)
    return added


def pending():
    store = state.curator_store()
    return [p for p in store["proposals"] if p["status"] == "pending"]


def decide(proposal_id, action):
    store = state.curator_store()
    for p in store["proposals"]:
        if p["id"] == proposal_id and p["status"] == "pending":
            if action == "apply":
                if p["kind"] == "merge":
                    rep = sorted(p["members"])[0]
                    state.set_entry_group(p["members"], rep,
                                          rename_rep=p.get("into_name"))
                else:
                    state.set_entry_group(p["members"], p["members"][0])
                p["status"] = "applied"
            elif action == "dismiss":
                p["status"] = "dismissed"
                store["dismissed"].append(p["members"])
            else:
                raise ValueError("action must be apply or dismiss")
            state.save_curator(store)
            return p
    raise KeyError("unknown or settled proposal")
