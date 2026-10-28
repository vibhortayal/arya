"""Crew hauls — a finished haul, posted to accepted friends only.

No chat, no comments, no free text. A post is a trip name, stock
character art for each shown item, and three numbers. A reaction is
one of three stickers (or none). Prices, the store, photos, receipts,
the session id and the private estimate never enter a post: the wire
format is built field by field from a whitelist.

Files (per account):
  crew_posts.json  - my own posts, with reactions ({post_id: post})
  crew_inbox.json  - copies of my friends' posts ({"author:post_id": post})

Cross-account writes use quest._as_user + state.file_lock the way
social._mirror_friend does. Each file's critical section is its own
short block (never nested across accounts), so two phones can post
and react at the same moment without a lock cycle.
"""
import hashlib, json, os, re

from api import haul, quest, social, state

POSTS_FILE = "crew_posts.json"
INBOX_FILE = "crew_inbox.json"
REACTIONS = ("yum", "me_too", "teach_me", "none")
AUDIENCE_MAX = 50
FALLBACK_ART = "basket.webp"

_ART = None


def _art_set():
    """Every character art file the manifest names."""
    global _ART
    if _ART is None:
        found = set()
        p = os.path.join(os.path.dirname(__file__), "..", "pwa", "assets",
                         "characters", "manifest.json")
        try:
            with open(p, encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            data = {}

        def walk(v):
            if isinstance(v, str):
                if re.fullmatch(r"[a-z0-9_\-]+\.webp", v):
                    found.add(v)
            elif isinstance(v, dict):
                for x in v.values():
                    walk(x)
            elif isinstance(v, list):
                for x in v:
                    walk(x)
        walk(data)
        found.add(FALLBACK_ART)
        _ART = found
    return _ART


def clean_art(art):
    """A character webp the manifest knows, else the basket."""
    return art if isinstance(art, str) and art in _art_set() else FALLBACK_ART


def _account():
    return state._current_user.get() or ""


def post_id_for(session_id):
    return "hp-" + hashlib.sha1(
        (session_id + _account()).encode()).hexdigest()[:10]


def _norm_handle(h):
    return (h or "").strip().lstrip("@").lower()


def audience():
    """My accepted friends whose account I can reach, as handles."""
    out = []
    for f in social.list_friends():
        h = f.get("handle")
        if f.get("status") == "accepted" and h \
                and quest.username_for_handle(h) and h not in out:
            out.append(h)
    return out[:AUDIENCE_MAX]


# --- the public post -----------------------------------------------------------

def _new_finds(session_id, shown):
    """How many of the SHOWN items are stickers first minted on this
    trip. Hidden and removed items never count, so the number a friend
    sees matches the stickers in the post."""
    try:
        from api import stickers
        fresh = stickers.new_in_session(session_id)
    except Exception:
        return 0
    marks = set()
    for st in fresh:
        for v in (st.get("name"), st.get("key")):
            k = haul.key_of(v)
            if k:
                marks.add(k)
    return sum(1 for i in shown if i["key"] in marks)


def build_public_post(sess, view, arts, post_id, posted_at):
    """The wire format, field by field. Item names come from the
    server's own haul view; the client only picks the art, and the art
    must be a manifest file. Hidden items stay out."""
    shown = [i for i in view["items"] if not i["hidden"]]
    items = [{"name": i["name"], "art": clean_art((arts or {}).get(i["key"]))}
             for i in shown]
    return {
        "post_id": post_id,
        "author": quest.my_handle(),
        "name": view["name"],
        "items": items,
        "stats": {"items": len(items),
                  "new_finds": _new_finds(sess["id"], shown),
                  "level": view["stats"]["level"]},
        "posted_at": posted_at,
    }


def _arts_from(post_items, view):
    """Map item key -> art from a list of {name, art}."""
    return {haul.key_of(i.get("name")): i.get("art")
            for i in post_items or [] if isinstance(i, dict)}


# --- publish / unpublish ----------------------------------------------------------

def publish(session_id, items=None):
    """Post (or update in place) the haul of a closed hunt. `items` is
    the client's [{name, art}] for the haul's stickers: it supplies ART
    only. Names come from the server's own view, so nothing else the
    client sends can reach a post. Which stickers go out is the haul
    record's hidden list. Idempotent: one post per trip. Returns the
    public post, or None when the trip does not exist. Raises
    ValueError for an open hunt or when every sticker is hidden."""
    sess = quest.get_session(session_id)
    if sess is None:
        return None
    view = haul.haul_view(session_id)       # ValueError while open
    rec = haul.record(session_id)
    old = rec["post"] or {}
    # Art per item: what the client just sent wins, then what an
    # earlier post stored; anything else becomes the basket.
    arts = dict(old.get("arts") or {})
    arts.update({k: v for k, v in _arts_from(items, view).items() if k})
    if not [i for i in view["items"] if not i["hidden"]]:
        raise ValueError("Pick at least one sticker to post.")
    pid = post_id_for(session_id)
    posted_at = old.get("posted_at") or quest._now()
    post = build_public_post(sess, view, arts, pid, posted_at)
    friends = audience()
    # 1. my own copy (reactions survive an update)
    with state.file_lock(POSTS_FILE):
        posts = state._load(POSTS_FILE, {})
        prev = posts.get(pid) or {}
        mine = dict(post)
        mine["session_id"] = session_id          # private; never mirrored
        mine["audience"] = friends
        mine["reactions"] = prev.get("reactions") or {}
        posts[pid] = mine
        state._save(POSTS_FILE, posts)
    # 2. each accepted friend's inbox copy (errors per friend are swallowed)
    gone = [h for h in (prev.get("audience") or []) if h not in friends]
    for h in friends:
        _write_inbox(h, post)
    for h in gone:
        _drop_inbox(h, post["author"], pid)
    haul.set_post(session_id, {"post_id": pid, "audience": friends,
                               "posted_at": posted_at,
                               "items": [{"name": i["name"], "art": i["art"]}
                                         for i in post["items"]],
                               "arts": {k: clean_art(v)
                                        for k, v in arts.items()}})
    return post


def _write_inbox(handle, post):
    try:
        user = quest.username_for_handle(handle)
        if not user:
            return
        with quest._as_user(user):
            with state.file_lock(INBOX_FILE):
                inbox = state._load(INBOX_FILE, {})
                k = f"{post['author']}:{post['post_id']}"
                cur = inbox.get(k) or {}
                entry = dict(post)
                entry["my_reaction"] = cur.get("my_reaction")
                inbox[k] = entry
                state._save(INBOX_FILE, inbox)
    except Exception:
        pass


def _drop_inbox(handle, author, post_id):
    try:
        user = quest.username_for_handle(handle)
        if not user:
            return
        with quest._as_user(user):
            with state.file_lock(INBOX_FILE):
                inbox = state._load(INBOX_FILE, {})
                if inbox.pop(f"{author}:{post_id}", None) is not None:
                    state._save(INBOX_FILE, inbox)
    except Exception:
        pass


def unpublish(session_id):
    """Take the post down everywhere: my copy and every inbox copy.
    True when a post existed."""
    pid = post_id_for(session_id)
    me = quest.my_handle()
    with state.file_lock(POSTS_FILE):
        posts = state._load(POSTS_FILE, {})
        mine = posts.pop(pid, None)
        if mine is not None:
            state._save(POSTS_FILE, posts)
    targets = set((mine or {}).get("audience") or []) | set(audience())
    for h in targets:
        _drop_inbox(h, me, pid)
    haul.set_post(session_id, None)
    return mine is not None


# --- my post's state ------------------------------------------------------------------

def reaction_counts(reactions):
    """Counts per kind only: who reacted stays private to the reactor."""
    out = {"yum": 0, "me_too": 0, "teach_me": 0}
    for kind in (reactions or {}).values():
        if kind in out:
            out[kind] += 1
    return out


def post_state(session_id):
    rec = haul.record(session_id)
    p = rec["post"]
    if not p:
        return {"posted": False, "post_id": None, "audience": [],
                "reactions": reaction_counts({})}
    posts = state._load(POSTS_FILE, {})
    mine = posts.get(p.get("post_id")) or {}
    return {"posted": True, "post_id": p.get("post_id"),
            "audience": list(p.get("audience") or []),
            "reactions": reaction_counts(mine.get("reactions"))}


# --- the friends' feed and reactions ----------------------------------------------------

_PUBLIC = ("post_id", "author", "name", "items", "stats", "posted_at")


def _public(entry):
    out = {k: entry.get(k) for k in _PUBLIC}
    out["items"] = [{"name": i.get("name"), "art": clean_art(i.get("art"))}
                    for i in entry.get("items") or []]
    out["my_reaction"] = entry.get("my_reaction")
    return out


def _friend_handles():
    return {f["handle"] for f in social.list_friends()
            if f.get("status") == "accepted"}


def feed():
    """Posts my accepted friends made, newest first."""
    inbox = state._load(INBOX_FILE, {})
    friends = _friend_handles()
    rows = [_public(e) for e in inbox.values()
            if isinstance(e, dict) and e.get("author") in friends]
    rows.sort(key=lambda p: p.get("posted_at") or "", reverse=True)
    return rows


def inbox_post(author, post_id):
    """One friend's post from my inbox, or None."""
    author = _norm_handle(author)
    if author not in _friend_handles():
        return None
    e = state._load(INBOX_FILE, {}).get(f"{author}:{post_id}")
    return _public(e) if isinstance(e, dict) else None


def react(author, post_id, kind):
    """One sticker reaction (or none) on a friend's post. ValueError for
    any other kind; LookupError when there is no such post."""
    if kind not in REACTIONS:
        raise ValueError("kind must be yum, me_too, teach_me or none")
    author = _norm_handle(author)
    me = quest.my_handle()
    if inbox_post(author, post_id) is None:
        raise LookupError("no such post")
    user = quest.username_for_handle(author)
    if not user:
        raise LookupError("no such post")
    with quest._as_user(user):
        with state.file_lock(POSTS_FILE):
            posts = state._load(POSTS_FILE, {})
            p = posts.get(post_id)
            if p is None or me not in (p.get("audience") or []):
                raise LookupError("no such post")
            reactions = p.setdefault("reactions", {})
            if kind == "none":
                reactions.pop(me, None)
            else:
                reactions[me] = kind
            state._save(POSTS_FILE, posts)
    with state.file_lock(INBOX_FILE):
        inbox = state._load(INBOX_FILE, {})
        e = inbox.get(f"{author}:{post_id}")
        if e is not None:
            e["my_reaction"] = None if kind == "none" else kind
            state._save(INBOX_FILE, inbox)
    return inbox_post(author, post_id)
