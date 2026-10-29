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
    pats = []
    for p in d["patterns"]:
        if p["purchase_count"] >= 2:
            pats.append({"name": nm.get(p["item_id"], p["item_id"]),
                         "every_days": round(p["median_interval_days"]) if p["median_interval_days"] else None,
                         "last_bought": p["last_bought"], "buys": p["purchase_count"],
                         "due": p["due"], "seen_in_fridge": (p.get("seen") or {}).get("date")})
    return {
        "as_of": state.as_of(),
        # Running low = what the patterns say is due: not the checked
        # rows, not what the user typed in by hand (QA 2026-10-28).
        "running_low": [i.get("name") or nm.get(i["item_id"], i["item_id"])
                        for i in d["smart_list"]["items"]
                        if not i.get("checked") and i.get("source") != "user"],
        "on_list": [i.get("name") or nm.get(i["item_id"], i["item_id"])
                    for i in d["smart_list"]["items"] if not i.get("checked")],
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


def apply_actions(actions):
    from api import state
    applied, skipped = [], []
    today = date.today().isoformat()
    for a in actions or []:
        item_id = _resolve(a.get("item"))
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
                target = existing_item_id(name, state.dictionary()["entries"],
                                          state.flags()) or "manual-" + slug
                fl = dict(state.flags().get(target, {}))
                fl.update({"manual": True, "dismissed_on": None})
                if target.startswith("manual-"):
                    fl.setdefault("name", name)
                state.set_flag(target, fl)
                applied.append(f"Added {name} to your list.")
                continue
        if not item_id:
            skipped.append(f"I don't track {a.get('item')} yet — it will appear after its first receipt.")
            continue
        nm = state.names().get(item_id, item_id)
        fl = dict(state.flags().get(item_id, {}))
        t = a.get("type")
        if t == "add_to_list":
            fl["manual"] = True
            applied.append(f"Added {nm} to your list.")
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


def chat(history, client):
    system = open(PROMPT_PATH).read().split("SYSTEM:", 1)[1].strip()
    messages = [{"role": "system", "content": system},
                {"role": "user", "content": "HOUSEHOLD SNAPSHOT:\n" + json.dumps(snapshot())}]
    for h in (history or [])[-10:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": str(h["content"])[:2000]})
    out, _u, _c = client.chat(messages, mode="standard", personal=True)
    try:
        dec = json.loads(out)
    except Exception:
        dec = json.loads(out[out.find("{"): out.rfind("}") + 1])
    applied, skipped = apply_actions(dec.get("actions"))
    return {"reply": dec.get("reply", ""), "applied": applied, "skipped": skipped}
