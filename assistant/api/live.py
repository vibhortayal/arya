"""Live sync for groups (owner, 2026-10-29): when one member changes a
shared list, the other members' open apps hear about it at once.

Every save to a group's shared stores (and every receipt a member
files) calls changed(group_id). Each open app holds one Server-Sent
Events stream (/api/group/live) and reloads its list when its group
changes. Nothing is sent but the fact of a change; the app then reads
the list the normal way, through the normal login checks.

Delivery: with DATABASE_URL set (Supabase), a change is a Postgres
NOTIFY on channel arya_group and one listener thread per server
process LISTENs and wakes that process's streams. So any number of
server processes stay in step. Without a database (tests, plain JSON
on one process), a change wakes this process's streams directly.
ARYA_LIVE_PG=0 forces the in-process path.
"""
import asyncio, contextvars, json, logging, os, threading, time

log = logging.getLogger("arya.live")

CHANNEL = "arya_group"
MAX_STREAMS = 2000
MAX_STREAMS_PER_USER = 6
PING_SECONDS = 25

# The app sends X-Arya-Client (one random id per open tab) so a tab can
# skip the echo of its own change.
client_id = contextvars.ContextVar("arya_client", default="")

_subs = {}            # group id -> set of _Sub
_subs_guard = threading.Lock()
_listener = None
_listener_guard = threading.Lock()


class _Sub:
    def __init__(self, gid, user, loop):
        self.gid, self.user, self.loop = gid, user, loop
        self.queue = asyncio.Queue(maxsize=50)

    def push(self, event):
        def put():
            try:
                self.queue.put_nowait(event)
            except asyncio.QueueFull:
                pass  # the app reloads on any one of them
        try:
            self.loop.call_soon_threadsafe(put)
        except RuntimeError:
            pass  # the loop is gone; the stream is over


def _use_pg():
    return bool(os.environ.get("DATABASE_URL")) and os.environ.get("ARYA_LIVE_PG", "1") != "0"


def _deliver(gid, event):
    with _subs_guard:
        subs = list(_subs.get(gid, ()))
    for s in subs:
        s.push(event)


def changed(gid, by=None, what="list"):
    """Tell every open app in group gid that something changed. Never
    raises: a missed signal only means a later reload."""
    if not gid:
        return
    # by is a handle (never an email); the app only shows it.
    event = {"group": gid, "by": by or "", "client": client_id.get(),
             "what": what, "at": int(time.time())}
    if _use_pg():
        try:
            from api import pgstore
            pgstore._run(lambda c: c.execute("select pg_notify(%s, %s)",
                                              (CHANNEL, json.dumps(event))))
            return
        except Exception:  # the database is away: this process still hears it
            log.exception("live: notify failed, delivering locally")
    _deliver(gid, event)


def _listen_forever():
    """One thread per process: LISTEN on the channel and fan each
    notification out to this process's streams. Reconnects with a
    growing pause when the connection drops (Supabase closes idle ones)."""
    import psycopg
    pause = 1
    while True:
        try:
            with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True,
                                 connect_timeout=5) as conn:
                conn.execute(f"LISTEN {CHANNEL}")
                pause = 1
                for n in conn.notifies():
                    try:
                        event = json.loads(n.payload)
                    except ValueError:
                        continue
                    _deliver(event.get("group"), event)
        except Exception:
            log.exception("live: listener dropped; retrying in %ss", pause)
        time.sleep(pause)
        pause = min(pause * 2, 60)


def _ensure_listener():
    global _listener
    if not _use_pg():
        return
    with _listener_guard:
        if _listener is None or not _listener.is_alive():
            _listener = threading.Thread(target=_listen_forever, name="arya-live",
                                         daemon=True)
            _listener.start()


def subscribe(gid, user):
    """A new stream for user in group gid, or None when the server is
    at its cap (the app falls back to reloading when it comes back to
    the front)."""
    with _subs_guard:
        total = sum(len(v) for v in _subs.values())
        mine = sum(1 for v in _subs.values() for s in v if s.user == user)
        if total >= MAX_STREAMS or mine >= MAX_STREAMS_PER_USER:
            return None
        s = _Sub(gid, user, asyncio.get_running_loop())
        _subs.setdefault(gid, set()).add(s)
    _ensure_listener()
    return s


def unsubscribe(s):
    with _subs_guard:
        group = _subs.get(s.gid)
        if group is not None:
            group.discard(s)
            if not group:
                del _subs[s.gid]


async def stream(s, still_member, is_gone):
    """The SSE body for one subscription. still_member() re-checks the
    group after each change (a removed member's stream ends);
    is_gone() is the request's disconnect check."""
    try:
        yield "retry: 5000\n\n"
        while True:
            try:
                event = await asyncio.wait_for(s.queue.get(), PING_SECONDS)
            except asyncio.TimeoutError:
                if await is_gone():
                    return
                yield ": ping\n\n"
                continue
            if not still_member():
                yield "event: left\ndata: {}\n\n"
                return
            yield f"event: change\ndata: {json.dumps(event)}\n\n"
    finally:
        unsubscribe(s)
