"""Ask Arya — the conversational agent (owner-approved 2026-10-27).
The model answers from a compact snapshot of the household model and may
emit validated actions. All numbers come from the deterministic engines;
the model never does math. Actions resolve items by name against the
user's own index; an unresolvable action is reported, never guessed."""
import json, os, re
from datetime import date, timedelta

from api.meta_client import parse_json

PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts", "chat_v1.md")


FEATURES_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts", "arya_features.md")


def _feature_flags():
    from api import reminders, supabase_auth
    from api.deps import _registration_open
    from api import own_key
    on = own_key.available()   # the same answer the Settings row and Help topic use
    return {"own_key": on, "byok": on, "not_own_key": not on,
            "push_reminders": reminders.flag_on(),
            "supabase_auth": supabase_auth.enabled(),
            "registration_open": _registration_open()}


_GENERIC = re.compile(r"\b(how (do|can|to|does)|where (do|can|is|are)|what can|what does|what is arya|what do you do|"
                      r"help|feature|guide|tutorial|can arya|does arya|show me around|get started|new here)\b", re.I)
MAX_SECTIONS = 3


def _sections(text):
    """The sheet as (overview lines, [(title, keywords, lines)])."""
    head, secs = [], []
    for line in text.splitlines():
        m = re.match(r"##\s*([^|]+)\|\s*(.*)", line)
        if m:
            secs.append((m.group(1).strip(), set(m.group(2).lower().split()), []))
        elif line.strip():
            (secs[-1][2] if secs else head).append(line)
    return head, secs


def _stem(w):
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def _pick(secs, question):
    """The sections that answer this question: the best keyword
    matches, or all of them for a general "how do I / what can" ask
    with no clear topic. A data question gets none, so Ask stays small."""
    words = {_stem(w) for w in re.findall(r"[a-z']+", (question or "").lower())}
    scored = []
    for i, (_t_, kws, _l) in enumerate(secs):
        n = len(words & {_stem(k) for k in kws})
        if n:
            scored.append((-n, i))
    if scored:
        return [secs[i] for _n, i in sorted(scored)[:MAX_SECTIONS]]
    return secs if _GENERIC.search(question or "") else []


def feature_sheet(flags=None, question=None):
    """What Arya can do, for questions about Arya itself. The overview
    always goes; with a `question`, only the topics it matches follow
    (without one, every topic). Lines tagged [if flag] appear only
    when that switch is on, so Ask never claims a feature that is off."""
    flags = _feature_flags() if flags is None else flags
    with open(FEATURES_PATH, encoding="utf-8") as fh:
        head, secs = _sections(fh.read())
    if question is not None:
        secs = _pick(secs, question)
    out = []
    for line in head + [l for _t_, _k, ls in secs for l in ls]:
        m = re.match(r"\[if (\w+)\]\s*(.*)", line)
        if m:
            if flags.get(m.group(1)):
                out.append(m.group(2))
        else:
            out.append(line)
    return "\n".join(out)


# ---- Language (owner, 2026-10-29; assistant/docs/MULTILINGUAL-ASK.md).
# The model mirrors the user's language; these cover the lines code
# writes. English is the fallback for any code not listed here.
LANGUAGES = {"en": "English", "es": "Spanish", "hi": "Hindi"}

_T = {
    "es": {
        "no_list": "No tienes una lista llamada {list}, así que {item} fue a Everything else.",
        "not_tracked": "Todavía no sigo {item}: aparecerá después de su primer recibo.",
        "added": "Añadí {name}{dest}.",
        "dest_list": " a tu lista",
        "dest_named": " a {list}",
        "ran_out": "Marqué {name} como agotado: está en la lista.",
        "expired": "Marqué {name} como caducado: está en la lista.",
        "never": "No volveré a sugerir {name}.",
        "snooze": "Pospuse {name} {days} días.",
        "q_out": "¿Marcar {name} como agotado? Pasa a tu lista como pendiente.",
        "q_expired": "¿Marcar {name} como caducado? Pasa a tu lista como pendiente.",
        "q_never": "¿Dejar de sugerir {name}?",
        "q_snooze": "¿Posponer {name} {days} días?",
    },
    "hi": {
        "no_list": "आपकी {list} नाम की कोई सूची नहीं है, इसलिए {item} Everything else में गया।",
        "not_tracked": "मैं अभी {item} को ट्रैक नहीं करता: पहली रसीद के बाद यह दिखेगा।",
        "added": "{name} {dest} जोड़ दिया।",
        "dest_list": "आपकी सूची में",
        "dest_named": "{list} में",
        "ran_out": "{name} को खत्म के रूप में चिह्नित किया: यह सूची में है।",
        "expired": "{name} को एक्सपायर के रूप में चिह्नित किया: यह सूची में है।",
        "never": "मैं {name} फिर नहीं सुझाऊँगा।",
        "snooze": "{name} को {days} दिन के लिए टाल दिया।",
        "q_out": "{name} को खत्म चिह्नित करें? यह सूची में तुरंत आ जाएगा।",
        "q_expired": "{name} को एक्सपायर चिह्नित करें? यह सूची में तुरंत आ जाएगा।",
        "q_never": "{name} सुझाना बंद करें?",
        "q_snooze": "{name} को {days} दिन के लिए टालें?",
    },
}


def _language_setting():
    """The account's Language setting: "auto" or a code in LANGUAGES."""
    from api import state
    code = str(state._load("settings.json", {}).get("language") or "auto")
    return code if code in LANGUAGES else "auto"


def _t(key, default, **kw):
    """A code-written line in the account's language (English when
    the setting is auto or English, or the line has no translation)."""
    tpl = _T.get(_language_setting(), {}).get(key, default)
    return tpl.format(**kw)


def _currency_line():
    from api import state
    from api.routes.account import CURRENCIES
    code = state._load("settings.json", {}).get("currency", "USD")
    if code not in CURRENCIES:
        code = "USD"
    return f"{code} ({CURRENCIES[code]})"


def snapshot():
    from api import state
    d = state.derived()
    nm = state.names()
    dash = state.dashboard()
    checked = {i["item_id"] for i in d["smart_list"]["items"] if i.get("checked")}
    pats = []
    for p in d["patterns"]:
        if p["purchase_count"] >= 2:
            pats.append({"name": nm.get(p["item_id"], p["item_id"]),
                         "every_days": round(p["median_interval_days"]) if p["median_interval_days"] else None,
                         "last_bought": p["last_bought"], "buys": p["purchase_count"],
                         "due": p["due"], "seen_in_fridge": (p.get("seen") or {}).get("date")})
    return {
        "as_of": state.as_of(),
        # Running low = what Today shows (state.running_low), minus the
        # rows already checked off: not what the user typed in by hand
        # (QA 2026-10-28). It does not depend on the list: removing a
        # row from the list does not make the item stop running low.
        "running_low": [nm.get(p["item_id"], p["item_id"])
                        for p in state.running_low(d)
                        if p["item_id"] not in checked],
        # Only what is on a list; Arya's suggestions are not (they show
        # under "Suggested" on Lists until someone adds them).
        "on_list": [i.get("name") or nm.get(i["item_id"], i["item_id"])
                    for i in d["smart_list"]["items"] if not i.get("checked") and i.get("on_list")],
        "suggested": [i.get("name") or nm.get(i["item_id"], i["item_id"])
                      for i in d["smart_list"]["items"] if not i.get("checked") and not i.get("on_list")],
        # Named lists (Costco, Indian Store...) and what sits on each.
        "named_lists": [
            {"name": l["name"], "stores": l.get("stores", []),
             "items": [i.get("name") or nm.get(i["item_id"], i["item_id"])
                       for i in d["smart_list"]["items"]
                       if i.get("list") == l["id"] and not i.get("checked") and i.get("on_list")]}
            for l in state.named_lists()],
        "currency": _currency_line(),
        "spend_total": dash["spend_total"], "returns_total": dash["returns_total"],
        "spend_by_month": dash["spend_by_month"],
        "spend_by_store": dash["spend_by_store"],
        "top_items_spend": [{"name": t["name"], "spend": t["spend"]}
                            for t in dash["top_items"][:8]],
        "trips": dash["trip_count"], "top_items": [t["name"] for t in dash["top_items"][:8]],
        # Receipt-level facts (Tester run 1, 2026-11-01: "show me my last
        # receipt", "biggest receipt", "trips to Costco" had no data) and
        # spend per store per month, so "what about last month only?"
        # can keep the stores the question was about.
        "receipts": _receipt_facts(d, nm),
        "spend_by_store_month": _store_months(d),
        "items": pats,
        # Prices from the household's own receipts, worked out in code
        # (api/prices.py) so the model only reads them (owner, 2026-10-29).
        "prices": _price_facts(d, nm),
        # Food dates (owner, 2026-11-01: "What goes bad this week?" had
        # no data behind it). use_by: printed dates the household saved,
        # the same rows Today's Use soon card reads, over a longer
        # window. still_good: Today's "Still good?" questions, which are
        # shelf-life estimates from the purchase date, not printed dates.
        **_food_dates(d, nm),
        "review_pending": len(state.review_queue()["lines"]),
    }


ASK_DATES_AHEAD = 30
ASK_DATES_MAX = 20


RECENT_RECEIPTS = 8


def _receipt_facts(d, nm):
    """Per receipt, from the ledger (the same net amounts as Spending):
    date, store, amount, item count and its three biggest lines. Code
    does the counting and sorting; the model only reads it."""
    per = {}
    for e in d["entries"]:
        r = per.setdefault(e["receipt_id"], {"date": e["date"], "store": e["store_id"],
                                             "amount": 0.0, "items": 0, "_lines": []})
        r["amount"] += e["price"]
        if e["event_type"] == "purchase":
            r["items"] += 1
            r["_lines"].append((e["price"], nm.get(e["item_id"], e["item_id"])))
    rows = []
    for r in per.values():
        r["amount"] = round(r["amount"], 2)
        r["top_lines"] = [n for _p, n in sorted(r.pop("_lines"), key=lambda x: -x[0])[:3]]
        rows.append(r)
    rows.sort(key=lambda r: r["date"])
    by_store = {}
    for r in rows:
        s = by_store.setdefault(r["store"], {"receipts": 0, "spend": 0.0, "last": None})
        s["receipts"] += 1
        s["spend"] = round(s["spend"] + r["amount"], 2)
        s["last"] = r["date"]
    return {"count": len(rows),
            "first_date": rows[0]["date"] if rows else None,
            "last": rows[-1] if rows else None,
            "biggest": max(rows, key=lambda r: r["amount"]) if rows else None,
            "by_store": by_store,
            "recent": rows[-RECENT_RECEIPTS:][::-1]}


def _store_months(d):
    """{store: {YYYY-MM: net spend}}, the same sums as spend_by_store."""
    out = {}
    for e in d["entries"]:
        m = out.setdefault(e["store_id"], {})
        m[e["date"][:7]] = round(m.get(e["date"][:7], 0) + e["price"], 2)
    return {s: dict(sorted(m.items())) for s, m in out.items()}


# A pack date's kind as words: "use by Nov 3", never the key "use_by"
# (Tester run 1, 2026-11-01).
KIND_WORDS = {"use_by": "use by", "best_by": "best by", "expires": "expires",
              "packed": "packed on", "unknown": "date on the pack"}


def _food_dates(d, nm):
    from api import expiry, state
    from api.deps import _d_today
    from api.routes.home import still_good_checks
    fl = state.flags()
    last_bought = {p["item_id"]: p.get("last_bought") for p in d["patterns"]}
    dated = expiry.use_soon(fl, nm, last_bought, _d_today(),
                            ahead=ASK_DATES_AHEAD, skip_snoozed=False)
    pack = [{"name": r["name"], "date": r["date"],
             "label": KIND_WORDS.get(r["kind"], KIND_WORDS["unknown"]),
             "days_left": r["days"]} for r in dated[:ASK_DATES_MAX]]
    still = []
    for c in still_good_checks(d, nm, fl):
        lb = next((p.get("last_bought") for p in d["patterns"]
                   if p["item_id"] == c["item_id"]), None)
        still.append({"name": c["name"], "bought": lb})
    return {"today": _d_today().isoformat(), "pack_dates": pack, "still_good": still}


def _price_facts(d, nm):
    from api import prices, state
    gm = state.group_map()
    on_list = [gm.get(i["item_id"], i["item_id"]) for i in d["smart_list"]["items"]
               if i.get("on_list") and not i.get("checked")]
    return prices.ask_facts(d, nm, first=on_list)


def _resolve(name):
    from api import state
    from api.eyes.service import match_item
    return match_item(name or "", state.name_index())


def _list_key(name):
    """A list name for matching: lower case, no punctuation, no
    apostrophe-s, and no trailing word "list"."""
    w = re.sub(r"'s\b", "", str(name or "").lower().replace("\u2019", "'"))
    w = re.sub(r"[^a-z0-9\s]", " ", w).split()
    if len(w) > 1 and w[-1] == "list":
        w = w[:-1]
    return " ".join(w)


LIST_MIN_CHARS = 3


def _list_matches(name):
    """The named lists the user may mean, best first: the exact name,
    else names that start with what they said or the other way round
    (owner, 2026-11-01: "Costco" means Costcozy), else a close spelling
    or a store the list is for."""
    import difflib
    from api import state
    want = _list_key(name)
    if not want:
        return []
    lists = state.named_lists()
    keys = [(l, _list_key(l["name"])) for l in lists]
    exact = [l for l, k in keys if k == want]
    if exact:
        return exact[:1]
    if len(want) < LIST_MIN_CHARS:
        return []  # "c" is not a list name (Tester, #384)
    pref = [l for l, k in keys if len(k) >= LIST_MIN_CHARS and (k.startswith(want) or want.startswith(k))]
    if pref:
        return pref
    close = difflib.get_close_matches(want, [k for _l, k in keys], n=3, cutoff=0.75)
    if close:
        return [l for l, k in keys if k in close]
    return [l for l in lists if any(_list_key(s) == want for s in l.get("stores") or [])]


def _list_for(name):
    """The one named list the user means, or None when none or more
    than one fits."""
    m = _list_matches(name)
    return m[0] if len(m) == 1 else None


def _which_list(name):
    """The question to ask when a list name fits more than one list,
    or None. Nothing is added or removed until the user says which."""
    m = _list_matches(name)
    if len(m) > 1:
        return _t("which_list", "More than one list fits {list}: {names}. Which one?",
                  list=name, names=" or ".join(l["name"] for l in m))
    return None


def _on_list_rows(target=None):
    """Unticked rows on the lists (or on one named list): (item_id, name)."""
    from api import state
    d = state.derived()
    nm = state.names()
    out = []
    for i in d["smart_list"]["items"]:
        if i.get("checked") or not i.get("on_list"):
            continue
        if target and target["id"] != i.get("list") and target["id"] not in (i.get("also") or []):
            continue
        out.append((i["item_id"], i.get("name") or nm.get(i["item_id"], i["item_id"])))
    return out


def _remove(a, target):
    """Take an item off a list by the name the user said. Only a row
    that is on the list is touched; nothing else is guessed."""
    from api.eyes.service import match_item
    from api.routes.lists import _remove_item
    rows = _on_list_rows(target)
    iid = match_item(a.get("item") or "", {i: [n] for i, n in rows})
    where = target["name"] if target else None
    if not iid:
        if where:
            return None, _t("not_on_named", "{item} is not on {list}.", item=a.get("item"), list=where)
        return None, _t("not_on_list", "{item} is not on your lists.", item=a.get("item"))
    name = dict(rows)[iid]
    _remove_item(iid, target["id"] if target else None)
    if where:
        return _t("removed_from", "Removed {name} from {list}.", name=name, list=where), None
    return _t("removed", "Removed {name} from your list.", name=name), None


def apply_actions(actions, added=None):
    """Apply validated actions. `added`, when given, collects
    {item_id, name} for each item that newly joined the list, so a
    caller can offer Undo."""
    from api import state
    applied, skipped = [], []
    today = date.today().isoformat()
    for a in actions or []:
        if a.get("type") == "remove_from_list":
            target = _list_for(a.get("list")) if a.get("list") else None
            if a.get("list") and target is None:
                skipped.append(_which_list(a["list"])
                               or _t("no_list_remove", "You have no list called {list}.", list=a["list"]))
                continue
            ok, why = _remove(a, target)
            (applied if ok else skipped).append(ok or why)
            continue
        qty, unit, said = 1, "", a.get("item")
        if a.get("type") in ("add_to_list", "ran_out"):
            # An add reads the quantity out of the words ("two lemons" ->
            # Lemons x 2), and matches only a name that IS a tracked item:
            # "oat milk" must not become "Milk - 2%" (owner, 2026-11-01).
            from api.list.intake import existing_item_id, split_list_items_units
            parsed = split_list_items_units(str(said or ""))
            if parsed:
                said, qty, unit = parsed[0]
            q = a.get("qty")
            if isinstance(q, (int, float)) and not isinstance(q, bool) and 1 <= q <= 99:
                qty = int(q)
            a = dict(a, item=said)
            item_id = existing_item_id(said or "", state.dictionary()["entries"], state.flags())
            # Quantity counts packages: "a dozen eggs" on a 12-count carton
            # is one carton, not 12 cartons (live Ask run, 2026-11-01).
            qty = _packs(qty, state.names().get(item_id) if item_id else said)
            if item_id and item_id.startswith("manual-"):
                item_id = None   # a typed row: handled below, same as a new name
        else:
            item_id = _resolve(a.get("item"))
        target = _list_for(a.get("list")) if a.get("type") == "add_to_list" else None
        if a.get("type") == "add_to_list" and a.get("list") and target is None:
            ask = _which_list(a["list"])
            if ask:
                # Ask first; adding to Everything else and then asking
                # leaves a stray row (Tester, #384).
                skipped.append(ask)
                continue
            skipped.append(_t("no_list", "You have no list called {list}, so {item} went to Everything else.",
                              list=a["list"], item=a.get("item")))
        dest = (_t("dest_named", " to {list}", list=target["name"]) if target
                else _t("dest_list", " to your list"))
        if not item_id and a.get("type") in ("add_to_list", "ran_out"):
            # Add is a list act, not a history lookup: a name Arya
            # has never seen joins the list as a typed item, the same
            # as the Add box does (QA 2026-10-28).
            from api.list.intake import existing_item_id, item_slug
            name = str(a.get("item") or "").strip()[:60]
            slug = item_slug(name)
            if slug:
                # A name typed before joins its existing row, not a twin.
                tid = existing_item_id(name, state.dictionary()["entries"],
                                       state.flags()) or "manual-" + slug
                fl = dict(state.flags().get(tid, {}))
                if added is not None and not (fl.get("manual") and not fl.get("dismissed_on")):
                    added.append({"item_id": tid, "name": name})
                fl.update({"manual": True, "dismissed_on": None})
                if qty != 1:
                    fl["qty_override"] = qty
                if unit:
                    fl["unit"] = unit
                if tid.startswith("manual-"):
                    fl["name"] = name
                if target:
                    fl["list"] = target["id"]
                state.set_flag(tid, fl)
                note = ""
                if state.classify_grocery(name)["kind"] == "other":
                    note = " That does not look like a grocery item; I added it anyway, so remove it if it is a mistake."
                shown = f"{name} \u00d7{qty}" if qty != 1 else name
                applied.append(_t("added", "Added {name}{dest}.", name=shown, dest=dest) + note)
                continue
        if not item_id:
            skipped.append(_t("not_tracked", "I don't track {item} yet — it will appear after its first receipt.",
                              item=a.get("item")))
            continue
        nm = state.names().get(item_id, item_id)
        fl = dict(state.flags().get(item_id, {}))
        t = a.get("type")
        if t in ("add_to_list", "ran_out") and not target and not fl.get("list"):
            # No list named: the list for the store it is usually bought at (retest #5).
            home = state.usual_list(item_id)
            if home:
                fl["list"] = home
                lst = next((x for x in state.named_lists() if x["id"] == home), None)
                if lst:
                    dest = _t("dest_named", " to {list}", list=lst["name"])
        if t == "add_to_list":
            if added is not None and not (fl.get("manual") and not fl.get("dismissed_on")):
                added.append({"item_id": item_id, "name": nm})
            fl["manual"] = True
            if qty != 1:
                fl["qty_override"] = qty
            if unit:
                fl["unit"] = unit
            if target:
                fl["list"] = target["id"]
            applied.append(_t("added", "Added {name}{dest}.", name=f"{nm} \u00d7{qty}" if qty != 1 else nm, dest=dest))
        elif t == "ran_out":
            fl["out"] = today
            applied.append(_t("ran_out", "Marked {name} as out — it's on the list.", name=nm))
        elif t == "mark_expired":
            fl["expired"] = today
            applied.append(_t("expired", "Marked {name} as expired — it's on the list.", name=nm))
        elif t == "never_suggest":
            fl["never"] = True
            applied.append(_t("never", "I won't suggest {name} again.", name=nm))
        elif t == "snooze":
            days = int(a.get("days") or 14)
            fl["snoozed_until"] = (date.today() + timedelta(days=days)).isoformat()
            applied.append(_t("snooze", "Snoozed {name} for {days} days.", name=nm, days=days))
        else:
            continue
        state.set_flag(item_id, fl)
    return applied, skipped


_PACK = re.compile(r"\b(\d{1,3})\s*-?\s*(?:ct|count|pk|pack|pcs?|eggs)\b|\b(dozen|doz)\b", re.I)


def pack_size(name):
    """How many units one package of a named item holds ("Pasture Eggs
    12 ct" -> 12, "Eggs dozen" -> 12), else 1."""
    m = _PACK.search(str(name or ""))
    if not m:
        return 1
    return 12 if m.group(2) else max(1, int(m.group(1)))


def _packs(qty, name):
    """A count that is the pack's own size (or a whole number of packs)
    means packages: 12 of a 12-count carton is 1 carton, 24 is 2."""
    n = pack_size(name)
    if n > 1 and qty >= n and qty % n == 0:
        return qty // n
    return qty


RISKY = {"ran_out", "mark_expired", "never_suggest", "snooze"}


def _risky_text(a, name):
    t = a.get("type")
    if t == "ran_out":
        return _t("q_out", "Mark {name} as out? It goes on your list as due now.", name=name)
    if t == "mark_expired":
        return _t("q_expired", "Mark {name} as expired? It goes on your list as due now.", name=name)
    if t == "never_suggest":
        return _t("q_never", "Stop suggesting {name}?", name=name)
    return _t("q_snooze", "Snooze {name} for {days} days?", name=name, days=int(a.get("days") or 14))


PHOTO_RULES = ("PHOTO: the user attached a photo to their last question. Answer from what you "
               "can see in it, in the same JSON shape with an empty actions list. Never say "
               "whether a price is good, cheap or expensive, and never quote a price you read "
               "off the photo as a comparison; if asked, say prices come from receipts and "
               "Arya shoppers. The photo is not saved. If it is unclear, say so.")


# The shopper's bottom bar (owner, 2026-11-01; web/src/lib/bar.ts, same
# ids and default). Ask says where a place is from the bar the shopper
# sees, so the app sends it with each question; the saved one is the
# fallback.
BAR_NAMES = {"home": "Today", "list": "Lists", "receipts": "Receipts", "stores-mine": "Stores",
             "analysis": "Spending", "chat": "Ask", "community": "Quest", "help": "Help", "profile": "Settings"}
DEFAULT_BAR = ["home", "analysis", "community", "chat"]  # owner, 2026-11-02
BAR_MAX = 4


def _clean_bar(bar):
    if not isinstance(bar, list):
        return None
    on = [b for i, b in enumerate(bar) if isinstance(b, str) and b in BAR_NAMES and b not in bar[:i]][:BAR_MAX]
    return on or None


def bar_line(bar=None):
    """YOUR BAR for the model: the places on this shopper's bar, then
    what is in More."""
    on = _clean_bar(bar)
    if on is None:
        from api import state
        saved = (state._load("settings.json", {}).get("layouts") or {}).get("bar")
        on = _clean_bar(saved.get("on") if isinstance(saved, dict) else None) or DEFAULT_BAR
    more = [BAR_NAMES[k] for k in BAR_NAMES if k not in on]
    return "YOUR BAR: " + ", ".join(BAR_NAMES[k] for k in on) + ", More. In More: " + ", ".join(more) + "."


def _asked(history):
    """The last two things the user said: a follow-up such as "how do I
    do that?" still finds the topic from the message before it."""
    us = [str(h.get("content", "")) for h in history or [] if h.get("role") == "user"]
    return " ".join(us[-2:])


def _turns(history):
    """The last ten turns for the model. An assistant turn whose reply was
    empty (actions only) still goes in, marked done with what the app
    applied; dropping it left two user messages in a row, and the model
    applied the earlier one's actions again (live Ask run, 2026-11-01)."""
    out = []
    for h in (history or [])[-10:]:
        role = h.get("role")
        if role not in ("user", "assistant"):
            continue
        text = str(h.get("content") or "").strip()
        if role == "assistant":
            done = [str(x) for x in (h.get("applied") or []) if x][:10]
            if done:
                text = (text + "\n" if text else "") + "(done: " + " ".join(done) + ")"
            text = text or "(done)"
        elif not text:
            continue
        out.append({"role": role, "content": text[:2000]})
    return out


# Prompt section names the model must never show (live Ask run: "ABOUT ARYA
# doesn't say more").
_LABELS = re.compile(r"\b(?:[Tt]he\s+)?(ABOUT ARYA|HOUSEHOLD SNAPSHOT|CURRENT SCREEN|YOUR BAR|REPLY LANGUAGE)(?:\s+(?:message|section))?\b")
_LABEL_SAYS = {"ABOUT ARYA": "Arya's guide", "HOUSEHOLD SNAPSHOT": "your data", "CURRENT SCREEN": "this screen",
               "YOUR BAR": "your bar", "REPLY LANGUAGE": "your language setting"}


def _scrub_labels(reply):
    if not isinstance(reply, str) or not reply:
        return reply
    def say(m):
        w = _LABEL_SAYS[m.group(1)]
        start = not reply[:m.start()].strip() or reply[:m.start()].rstrip()[-1] in ".!?\n"
        return w[0].upper() + w[1:] if start else w
    return _LABELS.sub(say, reply)


def chat(history, client, surface=None, context=None, image=None, bar=None):
    """One Ask Arya turn. On the Ask tab every action applies at once.
    From the List or a hunt (surface "list"/"hunt"; owner, 2026-10-29)
    adds still apply at once, with the added items returned so the
    client can offer Undo, but the riskier actions (out, expired,
    never, snooze) come back as `proposed` and wait for a yes."""
    from api import state
    system = open(PROMPT_PATH).read().split("SYSTEM:", 1)[1].strip()
    ctx = context if isinstance(context, dict) else {}
    lang = _language_setting()
    # Topic words are English: a fixed es/hi account, or text in another
    # script, gets every topic so the model can still answer in kind.
    asked = _asked(history)
    topics_for = None if lang in ("es", "hi") or re.search(r"[^\x00-\x7f\u2018\u2019\u201c\u201d\u2014]", asked) else asked
    messages = [{"role": "system", "content": system},
                {"role": "user", "content": "HOUSEHOLD SNAPSHOT:\n" + json.dumps(snapshot())},
                {"role": "user", "content": "ABOUT ARYA:\n" + feature_sheet(question=topics_for) + "\n" + bar_line(bar)}]
    if surface and ctx:
        messages.append({"role": "user", "content": "CURRENT SCREEN:\n" + json.dumps(ctx)[:2000]})
    if lang != "auto":
        messages.append({"role": "user", "content": f"REPLY LANGUAGE: {LANGUAGES[lang]} ({lang})"})
    for m in _turns(history):
        messages.append(m)
    if image:
        # One-shot "ask about this photo": the picture rides on the last
        # question and is not stored. Prices are never judged from a
        # photo (owner rule), and a photo answer changes nothing.
        messages.append({"role": "user", "content": PHOTO_RULES})
        last = next((m for m in reversed(messages) if m["role"] == "user" and m["content"] is not PHOTO_RULES), None)
        uri = f"data:{image['media_type']};base64,{image['data']}"
        last["content"] = [{"type": "text", "text": str(last["content"])},
                           {"type": "image_url", "image_url": {"url": uri}}]
    # The system prompt leads every request unchanged, so a stable cache
    # key lets the API reuse that prefix (cheaper input, faster).
    out, _u, _c = client.chat(messages, mode="standard", personal=True,
                              cache_key="arya-ask-v1")
    dec = parse_json(out)
    actions = [a for a in (dec.get("actions") or []) if isinstance(a, dict)] if not image else []
    if surface:
        # Viewing a named list: an add that names no list goes there.
        here = next((l for l in state.named_lists() if l["id"] == ctx.get("list_id")), None)
        if here:
            for a in actions:
                if a.get("type") in ("add_to_list", "remove_from_list") and not a.get("list"):
                    a["list"] = here["name"]
    proposed, now = [], actions
    if surface:
        # "We ran out of X" for an X Arya has never seen is just an add (retest #4).
        now = [a for a in actions if a.get("type") not in RISKY
               or (a.get("type") == "ran_out" and not _resolve(a.get("item")))]
        for a in actions:
            if a.get("type") in RISKY:
                iid = _resolve(a.get("item"))
                if iid:
                    proposed.append({"action": a, "text": _risky_text(a, state.names().get(iid, a.get("item")))})
    added = []
    applied, skipped = apply_actions(now, added)
    if surface:
        for a in actions:
            if a.get("type") in RISKY and a.get("type") != "ran_out" and not _resolve(a.get("item")):
                skipped.append(_t("not_tracked", "I don't track {item} yet — it will appear after its first receipt.",
                                  item=a.get("item")))
    return {"reply": _scrub_labels(dec.get("reply", "")), "applied": applied, "skipped": skipped,
            "added": added, "proposed": proposed}


def apply_confirmed(actions):
    """The yes to a proposed action: only the risky types apply here."""
    ok = [a for a in actions or [] if isinstance(a, dict) and a.get("type") in RISKY]
    applied, skipped = apply_actions(ok)
    return {"applied": applied, "skipped": skipped}
