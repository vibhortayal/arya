"""One name per real store (owner, 2026-10-30: "the store numbers look
weird. we have store addresses ... arya can find the exact store name,
city etc.").

A receipt carries the merchant text the store printed, and one Costco
warehouse prints it several ways ("Costco Newark #1660", "Costco Wholesale
Newark #1660", "Costco Wholesale #1660"). This module turns those into one
label per store, in two steps, all deterministic code at $0:

  1. Match the merchant to a store in the directory (stores.json: name,
     street, city, the same record the Stores picker files). The chain
     must match and the city must appear in the merchant text. A store
     number seen with a matched spelling carries over to the spellings
     that have the number but no city.
  2. Otherwise clean the text: drop "Wholesale", the number and the
     punctuation, and fold spellings that share a chain and a number.

A receipt filed against a shopping trip carries "store_ref", the trip's
directory store. The label comes from that store when the receipt agrees
with it: the same chain, and a city that is absent or the same.

The label is "<chain> <city>", for example "Costco Newark". It is also
the ledger store id, so prices and spending group on it. The raw merchant
text on the receipt is never changed.
"""
import re

_NUM = re.compile(r"#\s*(\d+)")
_NOISE = {"wholesale", "warehouse"}


def _chain(word):
    return re.sub(r"[^a-z0-9]", "", (word or "").lower())


_STATES = {"AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","ON","BC","AB","QC"}
_SMALL = {"of", "the", "and", "at", "de", "la", "del"}


def _human(word):
    """SUNNYVALE -> Sunnyvale. Mixed-case words and short brand codes
    (BJ's, HEB) keep their spelling; a word printed in capitals becomes
    capitalised."""
    if word.isupper() and len(word) > 3:
        return word.capitalize()
    if word.isupper() and word.lower() in _SMALL:
        return word.lower()
    if word.isupper() and len(word) == 3 and word.isalpha() and word.lower() in {"our", "new", "san", "los"}:
        return word.capitalize()
    return word


def _parse(raw):
    s = str(raw or "").strip()
    m = _NUM.search(s)
    words = [w for w in _NUM.sub(" ", s).split() if w.lower() not in _NOISE]
    words = [w for w in words if re.search(r"[A-Za-z0-9]", w)]
    # "CYPRESS CA": a trailing state code is not part of the place.
    if len(words) >= 3 and words[-1].upper() in _STATES:
        words = words[:-1]
    # A leading chain word keeps its own case; everything printed in
    # capitals reads like a person wrote it.
    return [_human(w) for w in words], (m.group(1) if m else None)


def _directory():
    try:
        from api import stores
        return stores._root_load("stores.json", {}).get("stores", [])
    except Exception:
        return []


def _store_label(store):
    words = [w for w in str(store.get("name") or "").split() if w.lower() not in _NOISE]
    city = (store.get("city") or "").strip()
    if city and city.lower() not in " ".join(words).lower():
        words.append(city)
    return " ".join(words)


def _match(words, stores):
    """The directory store a merchant names, or None. Needs the same
    chain and a city that appears in the merchant text, and exactly one
    such store."""
    if len(words) < 2:
        return None
    place = " ".join(words[1:]).lower()
    hits = [s for s in stores
            if _chain((str(s.get("name") or "").split() or [""])[0]) == _chain(words[0])
            and (s.get("city") or "").strip()
            and s["city"].strip().lower() in place]
    return hits[0] if len(hits) == 1 else None


def merge(raws, stores=None):
    """{raw merchant: {"label", "sub"}} for every merchant text given.
    sub is the street (matched store) or the store number."""
    raws = [r for r in dict.fromkeys(raws) if r]
    stores = _directory() if stores is None else stores
    parsed = {r: _parse(r) for r in raws}
    # "SUNNYVALE #423" has no chain word: the printed header line was just
    # the warehouse name. When the same store number appears with a chain
    # (Costco ... #423), that spelling takes the chain too.
    first_words = [_chain(w[0]) for w, n in parsed.values() if w]
    owner = {}
    for r, (w, n) in parsed.items():
        if w and n and len(w) >= 2 and first_words.count(_chain(w[0])) >= 2:
            owner.setdefault(n, w[0])
    for r, (w, n) in list(parsed.items()):
        if w and n and n in owner and _chain(w[0]) != _chain(owner[n]) \
                and first_words.count(_chain(w[0])) == 1:
            parsed[r] = ([owner[n]] + w, n)
    found = {}                                  # (chain, number) -> directory store
    for r, (words, num) in parsed.items():
        st = _match(words, stores) if words else None
        if st:
            parsed[r] = (words, num, st)
            if num:
                found[(_chain(words[0]), num)] = st
    labels = {}                                 # (chain, number) -> longest cleaned name
    for r, p in parsed.items():
        words, num = p[0], p[1]
        if words and num:
            k = (_chain(words[0]), num)
            if len(words) > len(labels.get(k, [])):
                labels[k] = words
    numbered = {k[0] for k in labels}
    out = {}
    for r, p in parsed.items():
        words, num = p[0], p[1]
        st = p[2] if len(p) > 2 else (found.get((_chain(words[0]), num)) if words and num else None)
        if st:
            sub = ", ".join(x for x in (st.get("street"), st.get("city")) if x)
            out[r] = {"label": _store_label(st), "sub": sub}
        elif words and num:
            out[r] = {"label": " ".join(labels[(_chain(words[0]), num)]), "sub": f"Store #{num}"}
        elif words:
            label = " ".join(words)
            if len(words) == 1 and _chain(words[0]) in numbered:
                label += ", location unknown"
            out[r] = {"label": label, "sub": None}
        else:
            out[r] = {"label": str(r), "sub": None}
    return out


def _agrees(merchant, store):
    """Does the receipt's merchant text fit the trip's store? Same
    chain, and a place that is absent or is the store's city."""
    words, _num = _parse(merchant)
    name = str(store.get("name") or "").split()
    if not words or not name or _chain(words[0]) != _chain(name[0]):
        return False
    city = (store.get("city") or "").strip().lower()
    return len(words) < 2 or not city or city in " ".join(words[1:]).lower()


def _printed(r):
    """The text a receipt's store goes by. A photo read after the reader
    started returning the header's address carries store_info (chain,
    city, number); that is a better key than the one line the model
    copied as "store"."""
    info = r.get("store_info") or {}
    chain = str(info.get("chain") or "").strip()
    city = str(info.get("city") or "").strip()
    num = str(info.get("number") or "").strip().lstrip("#")
    if chain and (city or num):
        return " ".join(x for x in (chain, city, f"#{num}" if num else "") if x)
    return r.get("merchant")


def labels(receipts, stores=None):
    """{receipt_id: {"label", "sub"}}: merge() for every receipt, and a
    receipt linked to its trip's store takes that store's label."""
    receipts = list(receipts)
    stores = _directory() if stores is None else stores
    by_merchant = merge((_printed(r) for r in receipts), stores)
    by_id = {s.get("id"): s for s in stores}
    out = {}
    for r in receipts:
        ref = by_id.get(r.get("store_ref"))
        if ref and _agrees(r.get("merchant"), ref):
            sub = ", ".join(x for x in (ref.get("street"), ref.get("city")) if x)
            out[r["receipt_id"]] = {"label": _store_label(ref), "sub": sub}
        else:
            out[r["receipt_id"]] = by_merchant.get(_printed(r)) or {"label": r.get("merchant"), "sub": None}
    return out
