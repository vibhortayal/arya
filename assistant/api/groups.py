"""Groups — people who shop for one home share one set of lists
(owner, 2026-10-29). Flag ARYA_GROUPS=1; off, nobody is in a group and
every account works exactly as before.

The registry is groups.json in the data root:
  {"groups": {id: {name, owner, members: [{user, joined}], created,
                   invite: {hash, expires, by} | None}},
   "member_of": {user: id}}

While an account is in a group, state._plane() sends the shared stores
(state.GROUP_DOCS: lists, flags, cart, product knowledge) to the
group's plane, and state.receipts() reads every member's receipts.

The owner's rules for leaving (2026-10-29):
  - lists are duplicated: the leaver gets a copy, the group keeps its own;
  - receipts belong to the account that filed them and go with it;
  - everything else (running low, patterns, spend) is recomputed,
    which happens on its own because it is derived from receipts.
Joining merges the joiner's lists into the group's: lists with the
same name become one. A group holds up to MAX_MEMBERS people. When the
owner leaves, the member who joined first becomes owner; when the last
member leaves, the group is gone.
"""
import hashlib, os, re, secrets, shutil, time

from api import state

MAX_MEMBERS = 6
MAX_NAME = 40
INVITE_TTL = 48 * 3600
# No 0/O, 1/I/L: a code read aloud or typed from a photo stays right.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LEN = 6
_FILE = "groups.json"


def enabled():
    return os.environ.get("ARYA_GROUPS", "0").strip() == "1"


# --- registry (root plane) ---------------------------------------------------

def _root_lock():
    return state.lock_for(os.path.join(state.base_dir(), _FILE))


def _registry():
    reg = state.load_at(state.base_dir(), "", _FILE, None) or {}
    reg.setdefault("groups", {})
    reg.setdefault("member_of", {})
    return reg


def _save_registry(reg):
    state.save_at(state.base_dir(), "", _FILE, reg)


def group_id_for(user):
    """The group an account is in, or None. Off unless ARYA_GROUPS=1."""
    if not enabled() or not user:
        return None
    if not os.path.exists(os.path.join(state.base_dir(), _FILE)) \
            and state.pgstore.mode() != "pg":
        return None
    gid = _registry()["member_of"].get(user)
    return gid or None


def member_names(gid):
    g = _registry()["groups"].get(gid)
    return [m["user"] for m in g["members"]] if g else []


def handle(user):
    """What other members see: the part before any @, never an email."""
    return (user or "").split("@")[0].strip().lower() or "someone"


def _hash(code):
    return hashlib.sha256(normalize_code(code).encode()).hexdigest()


def normalize_code(code):
    return re.sub(r"[^A-Z0-9]", "", (code or "").upper())


def _clean_name(name):
    name = re.sub(r"\s+", " ", (name or "").strip())[:MAX_NAME]
    if not name:
        raise ValueError("give the group a name")
    return name


# --- the shared stores --------------------------------------------------------

def _user_plane(user):
    return state.user_dir(user), user


def _group_plane(gid):
    return state.group_dir(gid), state.group_owner(gid)


def _copy_docs(src, dst):
    for name in state.GROUP_DOCS:
        doc = state.load_at(src[0], src[1], name, None)
        if doc is not None:
            state.save_at(dst[0], dst[1], name, doc)


def _merge_into_group(user, gid):
    """Fold a joiner's shared stores into the group's. The group's copy
    wins where both hold the same thing; lists with the same name
    (any case) become one list, and the joiner's items follow."""
    up, gp = _user_plane(user), _group_plane(gid)

    def load(plane, name, default):
        return state.load_at(plane[0], plane[1], name, default)

    def save(name, doc):
        state.save_at(gp[0], gp[1], name, doc)

    g_lists = load(gp, "lists.json", {"lists": []}).get("lists", [])
    u_lists = load(up, "lists.json", {"lists": []}).get("lists", [])
    by_name = {l["name"].strip().lower(): l for l in g_lists}
    remap = {}
    for l in u_lists:
        same = by_name.get(l["name"].strip().lower())
        if same:
            remap[l["id"]] = same["id"]
            for s in l.get("stores", []):
                if s not in same.setdefault("stores", []) \
                        and len(same["stores"]) < state.MAX_LIST_STORES:
                    same["stores"].append(s)
        elif len(g_lists) < state.MAX_LISTS:
            g_lists.append(l)
            by_name[l["name"].strip().lower()] = l
    save("lists.json", {"lists": g_lists})

    g_flags = load(gp, "flags.json", {})
    for item_id, f in load(up, "flags.json", {}).items():
        f = dict(f)
        if f.get("list") in remap:
            f["list"] = remap[f["list"]]
        cur = g_flags.get(item_id)
        if cur is None:
            g_flags[item_id] = f
        else:
            for k, v in f.items():
                cur.setdefault(k, v)
            if f.get("manual"):
                cur["manual"] = True
    save("flags.json", g_flags)

    g_dict = load(gp, "dictionary.json", {"entries": []})
    have = {e["item_id"] for e in g_dict["entries"]}
    g_dict["entries"] += [e for e in load(up, "dictionary.json", {"entries": []})["entries"]
                          if e["item_id"] not in have]
    save("dictionary.json", g_dict)

    for name in ("judged.json", "grocery_verdicts.json"):
        merged = load(up, name, {})
        merged.update(load(gp, name, {}))
        save(name, merged)
    # cart, curator and second_seat are working state: the group's stand.


# --- the operations -------------------------------------------------------------

def view(user):
    """The caller's group as the app shows it, or None."""
    reg = _registry()
    gid = reg["member_of"].get(user)
    g = reg["groups"].get(gid) if gid else None
    if not g:
        return None
    return {"id": gid, "name": g["name"],
            "me": handle(user), "is_owner": g["owner"] == user,
            "max_members": MAX_MEMBERS,
            "members": [{"handle": handle(m["user"]), "me": m["user"] == user,
                         "owner": m["user"] == g["owner"],
                         "joined": m["joined"]} for m in g["members"]]}


def create(user, name):
    name = _clean_name(name)
    with _root_lock():
        reg = _registry()
        if reg["member_of"].get(user):
            raise ValueError("you are already in a group; leave it first")
        gid = secrets.token_hex(6)
        now = int(time.time())
        reg["groups"][gid] = {"name": name, "owner": user, "created": now,
                              "members": [{"user": user, "joined": now}],
                              "invite": None}
        # The founder's lists become the group's lists.
        _copy_docs(_user_plane(user), _group_plane(gid))
        reg["member_of"][user] = gid
        _save_registry(reg)
    return gid


def rename(user, name):
    name = _clean_name(name)
    with _root_lock():
        reg = _registry()
        gid = reg["member_of"].get(user)
        if not gid:
            raise LookupError("you are not in a group")
        reg["groups"][gid]["name"] = name
        _save_registry(reg)
    _signal(gid, user)


def invite(user, fresh=False):
    """The caller's group's live code, so reopening the invite sheet
    never changes a code someone already holds. A new code is made only
    when none is live (none yet, or it expired) or when asked for with
    fresh=True; it replaces the old, which stops working. Any member may
    ask. Returns (code, expires)."""
    with _root_lock():
        reg = _registry()
        gid = reg["member_of"].get(user)
        if not gid:
            raise LookupError("you are not in a group")
        live = reg["groups"][gid].get("invite")
        if not fresh and live and live.get("code") and live["expires"] > time.time():
            return live["code"], live["expires"]
        code = "".join(secrets.choice(_ALPHABET) for _ in range(CODE_LEN))
        expires = int(time.time()) + INVITE_TTL
        reg["groups"][gid]["invite"] = {"hash": _hash(code), "code": code,
                                        "expires": expires, "by": user}
        _save_registry(reg)
    return code, expires


def _find_by_code(reg, code):
    if len(normalize_code(code)) != CODE_LEN:
        return None, None
    h, now = _hash(code), time.time()
    for gid, g in reg["groups"].items():
        inv = g.get("invite")
        if inv and inv["expires"] > now and secrets.compare_digest(inv["hash"], h):
            return gid, g
    return None, None


def preview(code):
    """What a code leads to, shown before joining: the group's name,
    who sent the code, how many people and lists. None for a wrong or
    expired code."""
    reg = _registry()
    gid, g = _find_by_code(reg, code)
    if not g:
        return None
    gp = _group_plane(gid)
    lists = state.load_at(gp[0], gp[1], "lists.json", {"lists": []}).get("lists", [])
    return {"name": g["name"], "invited_by": handle(g["invite"]["by"]),
            "people": len(g["members"]), "lists": len(lists),
            "full": len(g["members"]) >= MAX_MEMBERS}


def join(user, code):
    with _root_lock():
        reg = _registry()
        if reg["member_of"].get(user):
            raise ValueError("you are already in a group; leave it first")
        gid, g = _find_by_code(reg, code)
        if not g:
            raise LookupError("that code is wrong or has expired")
        if len(g["members"]) >= MAX_MEMBERS:
            raise ValueError(f"that group is full ({MAX_MEMBERS} people)")
        with state.file_lock_at(state.group_dir(gid), "lists.json"), \
                state.file_lock_at(state.group_dir(gid), "flags.json"):
            _merge_into_group(user, gid)
        g["members"].append({"user": user, "joined": int(time.time())})
        reg["member_of"][user] = gid
        _save_registry(reg)
    _signal(gid, user)
    return gid


def leave_preview(user):
    """The numbers the leave sheet shows: lists the leaver keeps a copy
    of, their own receipts, the receipts that stay, the next owner."""
    reg = _registry()
    gid = reg["member_of"].get(user)
    if not gid:
        return None
    g = reg["groups"][gid]
    gp = _group_plane(gid)
    lists = state.load_at(gp[0], gp[1], "lists.json", {"lists": []}).get("lists", [])
    mine = others = 0
    for m in g["members"]:
        n = len(state.load_at(state.user_dir(m["user"]), m["user"], "receipts.json", []))
        if m["user"] == user:
            mine = n
        else:
            others += n
    rest = [m["user"] for m in g["members"] if m["user"] != user]
    return {"name": g["name"], "lists": [l["name"] for l in lists],
            "my_receipts": mine, "other_receipts": others,
            "last_one": not rest,
            "next_owner": handle(rest[0]) if rest and g["owner"] == user else None}


def leave(user):
    """Take the caller out of their group. They keep a copy of every
    shared store (lists, flags, product knowledge); their receipts were
    always theirs. Returns the group id left, or None."""
    with _root_lock():
        reg = _registry()
        gid = reg["member_of"].get(user)
        if not gid:
            return None
        g = reg["groups"][gid]
        with state.file_lock_at(state.group_dir(gid), "lists.json"), \
                state.file_lock_at(state.group_dir(gid), "flags.json"):
            _copy_docs(_group_plane(gid), _user_plane(user))
        g["members"] = [m for m in g["members"] if m["user"] != user]
        del reg["member_of"][user]
        if not g["members"]:
            del reg["groups"][gid]
            _drop_group_plane(gid)
        elif g["owner"] == user:
            g["owner"] = g["members"][0]["user"]
        _save_registry(reg)
    _signal(gid, user)
    return gid


def remove(owner, member_handle):
    """The owner takes a member out; for that member it is the same as
    leaving (they keep a copy of the lists and their receipts)."""
    reg = _registry()
    gid = reg["member_of"].get(owner)
    if not gid:
        raise LookupError("you are not in a group")
    g = reg["groups"][gid]
    if g["owner"] != owner:
        raise PermissionError("only the group's owner can remove people")
    target = next((m["user"] for m in g["members"]
                   if handle(m["user"]) == (member_handle or "").strip().lstrip("@").lower()), None)
    if target is None:
        raise LookupError("no one with that name is in your group")
    if target == owner:
        raise ValueError("use Leave group to leave")
    leave(target)
    return handle(target)


def _signal(gid, user):
    from api import live
    live.changed(gid, by=handle(user), what="members")


def _drop_group_plane(gid):
    d = state.group_dir(gid)
    if os.path.isdir(d):
        shutil.rmtree(d)
    if state.pgstore.mode() != "json":
        try:
            state.pgstore.delete_owner(state.group_owner(gid))
        except Exception:  # a stale mirror row harms no one
            state.pgstore.log.exception("could not drop group rows %s", gid)


# --- who changed what (the "Priya added Hummus" line on a list card) ----------
ACTIVITY_MAX = 60
_ACTIVITY = "activity.json"


def note(action, item_id):
    """Remember that the caller added, ticked or removed an item, so
    the other members' list cards can say so. Outside a group, or for
    the demo, nothing is kept."""
    gid = state.current_group()
    user = state._current_user.get()
    if not gid or not user or not item_id:
        return
    f = state.flags().get(item_id, {})
    name = f.get("name") or state.names().get(item_id, item_id)
    d, owner = _group_plane(gid)
    with state.file_lock_at(d, _ACTIVITY):
        rows = state.load_at(d, owner, _ACTIVITY, [])
        rows.append({"by": user, "action": action, "item_id": item_id,
                     "name": name, "list": f.get("list"),
                     "at": int(time.time())})
        state.save_at(d, owner, _ACTIVITY, rows[-ACTIVITY_MAX:])


def recent(user):
    """The latest change by someone else on each list (key "" for
    Everything else), newest first: what the Lists cards show."""
    gid = state.current_group()
    if not gid:
        return {}
    d, owner = _group_plane(gid)
    out = {}
    for r in reversed(state.load_at(d, owner, _ACTIVITY, [])):
        if r["by"] == user:
            continue
        out.setdefault(r.get("list") or "", {
            "by": handle(r["by"]), "action": r["action"],
            "name": r["name"], "at": r["at"]})
    return out
