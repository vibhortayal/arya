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
    return {"push_reminders": reminders.flag_on(),
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
        "on_list": [i.get("name") or nm.get(i["item_id"], i["item_id"])
                    for i in d["smart_list"]["items"] if not i.get("checked")],
        # Named lists (Costco, Indian Store...) and what sits on each.
        "named_lists": [
            {"name": l["name"], "stores": l.get("stores", []),
             "items": [i.get("name") or nm.get(i["item_id"], i["item_id"])
                       for i in d["smart_list"]["items"]
                       if i.get("list") == l["id"] and not i.get("checked")]}
            for l in state.named_lists()],
        "currency": _currency_line(),
        "spend_total": dash["spend_total"], "returns_total": dash["returns_total"],
        "spend_by_month": dash["spend_by_month"],
        "spend_by_store": dash["spend_by_store"],
        "top_items_spend": [{"name": t["name"], "spend": t["spend"]}
                            for t in dash["top_items"][:8]],
        "trips": dash["trip_count"], "top_items": [t["name"] for t in dash["top_items"][:8]],
        "items": pats,
        # Prices from the household's own receipts, worked out in code
        # (api/prices.py) so the model only reads them (owner, 2026-10-29).
        "prices": _price_facts(d, nm),
        "review_pending": len(state.review_queue()["lines"]),
    }


def _price_facts(d, nm):
    from api import prices
    return prices.ask_facts(d, nm)


def _resolve(name):
    from api import state
    from api.eyes.service import match_item
    return match_item(name or "", state.name_index())


def _list_for(name):
    """A named list by the name the user said (case-blind), or None."""
    from api import state
    want = " ".join(str(name or "").split()).lower()
    if not want:
        return None
    return next((l for l in state.named_lists() if l["name"].lower() == want), None)


def apply_actions(actions, added=None):
    """Apply validated actions. `added`, when given, collects
    {item_id, name} for each item that newly joined the list, so a
    caller can offer Undo."""
    from api import state
    applied, skipped = [], []
    today = date.today().isoformat()
    for a in actions or []:
        item_id = _resolve(a.get("item"))
        target = _list_for(a.get("list")) if a.get("type") == "add_to_list" else None
        if a.get("type") == "add_to_list" and a.get("list") and target is None:
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
                if tid.startswith("manual-"):
                    fl["name"] = name
                if target:
                    fl["list"] = target["id"]
                state.set_flag(tid, fl)
                note = ""
                if state.classify_grocery(name)["kind"] == "other":
                    note = " That does not look like a grocery item; I added it anyway, so remove it if it is a mistake."
                applied.append(_t("added", "Added {name}{dest}.", name=name, dest=dest) + note)
                continue
        if not item_id:
            skipped.append(_t("not_tracked", "I don't track {item} yet — it will appear after its first receipt.",
                              item=a.get("item")))
            continue
        nm = state.names().get(item_id, item_id)
        fl = dict(state.flags().get(item_id, {}))
        t = a.get("type")
        if t == "add_to_list":
            if added is not None and not (fl.get("manual") and not fl.get("dismissed_on")):
                added.append({"item_id": item_id, "name": nm})
            fl["manual"] = True
            if target:
                fl["list"] = target["id"]
            applied.append(_t("added", "Added {name}{dest}.", name=nm, dest=dest))
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


def _asked(history):
    """The last two things the user said: a follow-up such as "how do I
    do that?" still finds the topic from the message before it."""
    us = [str(h.get("content", "")) for h in history or [] if h.get("role") == "user"]
    return " ".join(us[-2:])


def chat(history, client, surface=None, context=None, image=None):
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
                {"role": "user", "content": "ABOUT ARYA:\n" + feature_sheet(question=topics_for)}]
    if surface and ctx:
        messages.append({"role": "user", "content": "CURRENT SCREEN:\n" + json.dumps(ctx)[:2000]})
    if lang != "auto":
        messages.append({"role": "user", "content": f"REPLY LANGUAGE: {LANGUAGES[lang]} ({lang})"})
    for h in (history or [])[-10:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": str(h["content"])[:2000]})
    if image:
        # One-shot "ask about this photo": the picture rides on the last
        # question and is not stored. Prices are never judged from a
        # photo (owner rule), and a photo answer changes nothing.
        messages.append({"role": "user", "content": PHOTO_RULES})
        last = next((m for m in reversed(messages) if m["role"] == "user" and m["content"] is not PHOTO_RULES), None)
        uri = f"data:{image['media_type']};base64,{image['data']}"
        last["content"] = [{"type": "text", "text": str(last["content"])},
                           {"type": "image_url", "image_url": {"url": uri}}]
    out, _u, _c = client.chat(messages, mode="standard", personal=True)
    dec = parse_json(out)
    actions = [a for a in (dec.get("actions") or []) if isinstance(a, dict)] if not image else []
    if surface:
        # Viewing a named list: an add that names no list goes there.
        here = next((l for l in state.named_lists() if l["id"] == ctx.get("list_id")), None)
        if here:
            for a in actions:
                if a.get("type") == "add_to_list" and not a.get("list"):
                    a["list"] = here["name"]
    proposed, now = [], actions
    if surface:
        now = [a for a in actions if a.get("type") not in RISKY]
        for a in actions:
            if a.get("type") in RISKY:
                iid = _resolve(a.get("item"))
                if iid:
                    proposed.append({"action": a, "text": _risky_text(a, state.names().get(iid, a.get("item")))})
    added = []
    applied, skipped = apply_actions(now, added)
    if surface:
        for a in actions:
            if a.get("type") in RISKY and not _resolve(a.get("item")):
                skipped.append(_t("not_tracked", "I don't track {item} yet — it will appear after its first receipt.",
                                  item=a.get("item")))
    return {"reply": dec.get("reply", ""), "applied": applied, "skipped": skipped,
            "added": added, "proposed": proposed}


def apply_confirmed(actions):
    """The yes to a proposed action: only the risky types apply here."""
    ok = [a for a in actions or [] if isinstance(a, dict) and a.get("type") in RISKY]
    applied, skipped = apply_actions(ok)
    return {"applied": applied, "skipped": skipped}
