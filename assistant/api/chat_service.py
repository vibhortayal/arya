"""Ask Arya — the conversational agent (owner-approved 2026-10-27).
The model answers from a compact snapshot of the household model and may
emit validated actions. All numbers come from the deterministic engines;
the model never does math. Actions resolve items by name against the
user's own index; an unresolvable action is reported, never guessed."""
import json, os
from datetime import date, timedelta

PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts", "chat_v1.md")


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
        "currency": "USD (dollars)",
        "spend_total": dash["spend_total"], "returns_total": dash["returns_total"],
        "spend_by_month": dash["spend_by_month"],
        "spend_by_store": dash["spend_by_store"],
        "top_items_spend": [{"name": t["name"], "spend": t["spend"]}
                            for t in dash["top_items"][:8]],
        "trips": dash["trip_count"], "top_items": [t["name"] for t in dash["top_items"][:8]],
        "items": pats,
        "review_pending": len(state.review_queue()["lines"]),
    }


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
            skipped.append(f"You have no list called {a['list']}, so {a.get('item')} went to Everything else.")
        dest = f" to {target['name']}" if target else " to your list"
        if not item_id and a.get("type") == "add_to_list":
            # Add is a list act, not a history lookup: a name Arya
            # has never seen joins the list as a typed item, the same
            # as the Add box does (QA 2026-10-28).
            import re
            from api.list.intake import existing_item_id
            name = str(a.get("item") or "").strip()[:60]
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
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
                applied.append(f"Added {name}{dest}.")
                continue
        if not item_id:
            skipped.append(f"I don't track {a.get('item')} yet — it will appear after its first receipt.")
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
            applied.append(f"Added {nm}{dest}.")
        elif t == "ran_out":
            fl["out"] = today
            applied.append(f"Marked {nm} as out — it's on the list.")
        elif t == "mark_expired":
            fl["expired"] = today
            applied.append(f"Marked {nm} as expired — it's on the list.")
        elif t == "never_suggest":
            fl["never"] = True
            applied.append(f"I won't suggest {nm} again.")
        elif t == "snooze":
            days = int(a.get("days") or 14)
            fl["snoozed_until"] = (date.today() + timedelta(days=days)).isoformat()
            applied.append(f"Snoozed {nm} for {days} days.")
        else:
            continue
        state.set_flag(item_id, fl)
    return applied, skipped


RISKY = {"ran_out", "mark_expired", "never_suggest", "snooze"}


def _risky_text(a, name):
    t = a.get("type")
    if t == "ran_out":
        return f"Mark {name} as out? It goes on your list as due now."
    if t == "mark_expired":
        return f"Mark {name} as expired? It goes on your list as due now."
    if t == "never_suggest":
        return f"Stop suggesting {name}?"
    return f"Snooze {name} for {int(a.get('days') or 14)} days?"


def chat(history, client, surface=None, context=None):
    """One Ask Arya turn. On the Ask tab every action applies at once.
    From the List or a hunt (surface "list"/"hunt"; owner, 2026-10-29)
    adds still apply at once, with the added items returned so the
    client can offer Undo, but the riskier actions (out, expired,
    never, snooze) come back as `proposed` and wait for a yes."""
    from api import state
    system = open(PROMPT_PATH).read().split("SYSTEM:", 1)[1].strip()
    ctx = context if isinstance(context, dict) else {}
    messages = [{"role": "system", "content": system},
                {"role": "user", "content": "HOUSEHOLD SNAPSHOT:\n" + json.dumps(snapshot())}]
    if surface and ctx:
        messages.append({"role": "user", "content": "CURRENT SCREEN:\n" + json.dumps(ctx)[:2000]})
    for h in (history or [])[-10:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": str(h["content"])[:2000]})
    out, _u, _c = client.chat(messages, mode="standard", personal=True)
    try:
        dec = json.loads(out)
    except Exception:
        dec = json.loads(out[out.find("{"): out.rfind("}") + 1])
    actions = [a for a in (dec.get("actions") or []) if isinstance(a, dict)]
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
                skipped.append(f"I don't track {a.get('item')} yet — it will appear after its first receipt.")
    return {"reply": dec.get("reply", ""), "applied": applied, "skipped": skipped,
            "added": added, "proposed": proposed}


def apply_confirmed(actions):
    """The yes to a proposed action: only the risky types apply here."""
    ok = [a for a in actions or [] if isinstance(a, dict) and a.get("type") in RISKY]
    applied, skipped = apply_actions(ok)
    return {"applied": applied, "skipped": skipped}
