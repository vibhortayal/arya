"""Postgres backend for the document store (Supabase seam, stage 1).

Every former JSON file is one row of arya.user_docs, keyed (owner, name):
owner is the account name, or '' for the root plane (users.json,
stores.json, ...). state._load/_save call in here when ARYA_STORE asks
for it; nothing else in the app knows the database exists.

ARYA_STORE:
  json (default)  files only, exactly as before.
  dual            files stay the source of truth; every save is mirrored
                  to Postgres (a mirror failure is logged, never raised).
  pg              Postgres is the source of truth; files are not touched.
The demo account and the file-only names below always use files.

Connects with DATABASE_URL (role arya_app, search_path=arya), read from
the server environment file. Never commit it.
"""
import json, logging, os, threading

log = logging.getLogger("arya.pgstore")

# Kept on disk in every mode: caches and big blobs. The map image blobs
# move to object storage in a later stage.
FILE_ONLY = {"shelf_matches.json", "storemap_img.json"}
# Shipped read-only household; its writes go to the sandbox overlay.
FILE_ONLY_OWNERS = {"demo"}

_local = threading.local()


def mode():
    m = os.environ.get("ARYA_STORE", "json").strip().lower()
    return m if m in ("json", "dual", "pg") else "json"


def uses_pg(owner, name):
    return (mode() != "json" and name not in FILE_ONLY
            and owner not in FILE_ONLY_OWNERS)


def _conn():
    import psycopg
    c = getattr(_local, "conn", None)
    if c is None or c.closed:
        c = psycopg.connect(os.environ["DATABASE_URL"], autocommit=True,
                            connect_timeout=5)
        _local.conn = c
    return c


def _run(fn):
    """One retry on a dropped connection (Supabase closes idle ones)."""
    import psycopg
    try:
        return fn(_conn())
    except psycopg.OperationalError:
        _local.conn = None
        return fn(_conn())


_MISSING = object()


def read(owner, name):
    """The stored document, or _MISSING when no row exists."""
    def go(c):
        row = c.execute("select doc from user_docs where owner=%s and name=%s",
                        (owner, name)).fetchone()
        return _MISSING if row is None else row[0]
    return _run(go)


def write(owner, name, obj):
    from psycopg.types.json import Jsonb

    def go(c):
        c.execute(
            "insert into user_docs(owner, name, doc) values (%s,%s,%s) "
            "on conflict (owner, name) do update "
            "set doc = excluded.doc, updated_at = now()",
            (owner, name, Jsonb(obj)))
    _run(go)


def mirror(owner, name, obj):
    """dual mode: best-effort copy of a file save."""
    try:
        write(owner, name, obj)
    except Exception:  # the file already holds the truth
        log.exception("pg mirror failed for %s/%s", owner, name)


def list_docs(owner=None):
    def go(c):
        q = "select owner, name from user_docs"
        args = ()
        if owner is not None:
            q += " where owner=%s"
            args = (owner,)
        return c.execute(q + " order by owner, name", args).fetchall()
    return _run(go)
