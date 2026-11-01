"""Arya API — FastAPI entry point.
All Meta calls go through api.meta_client; all money math is code.

Event-loop rule (review 2026-10-28, H1): MetaClient is blocking
urllib with timeouts up to 120 s, so no route may call a model —
or judge_pending, which calls the judge — on the event loop.
Model work runs through run_in_threadpool; a slow photo read then
stalls one worker thread, never every other request."""
import logging, os
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from api import album_routes, haul_routes, hunt_routes, pack, state
from api.demo_guard import require_login
from api.deps import _PWA
from api.routes import (account, auth, avatar, chat, expiry, eyes, friends, groups, home,
                        intake, items, lists, lists_v1, mcp_connector, ops, prices, quest,
                        questmap, receiptjobs, receipts, review, shelf, storemap, stores, town)

# No /docs, /redoc or /openapi.json: they listed every route, admin
# ones included, to anyone (audit M2, 2026-10-30). The public Lists
# API keeps its own schema at /api/v1/openapi.json.
app = FastAPI(title="Arya API", docs_url=None, redoc_url=None, openapi_url=None)
app.middleware("http")(require_login)
_log = logging.getLogger("arya.api")


@app.exception_handler(RuntimeError)
async def _model_failure(request, exc):
    """MetaClient and parse_json raise RuntimeError when a model call
    fails or its answer cannot be read. Routes that do not catch it
    answer 502 with a plain sentence instead of a bare 500 (codebase
    map 2026-10-29). The traceback still goes to the log."""
    _log.exception("unhandled RuntimeError on %s", request.url.path,
                   exc_info=exc)
    return JSONResponse({"detail": "Arya could not finish that read. Try again."},
                        status_code=502)


def _commit():
    """The git commit this image was built from (build arg GIT_COMMIT),
    so the owner can tell what is deployed. "unknown" when not passed."""
    return os.environ.get("GIT_COMMIT") or "unknown"


@app.get("/health")
def health():
    # No receipt count: /health runs with no account, so it counted the
    # root plane, which holds none (review M11). Liveness, plus two cheap
    # checks the outside uptime monitor can alert on (ops review
    # 2026-10-31): the data folder is writable and the disk is not nearly
    # full. Healthy answers keep the same body; a problem answers 503.
    import shutil
    problems = []
    base = state.base_dir()
    if not os.access(base, os.W_OK):
        problems.append("data folder not writable")
    try:
        floor = float(os.environ.get("ARYA_HEALTH_MIN_FREE_MB", "500")) * 1024 * 1024
        if shutil.disk_usage(base).free < floor:
            problems.append("disk nearly full")
    except (OSError, ValueError):
        problems.append("disk check failed")
    if problems:
        return JSONResponse({"status": "degraded", "service": "arya-api",
                             "commit": _commit(), "problems": problems},
                            status_code=503)
    return {"status": "ok", "service": "arya-api", "stage": 3,
            "commit": _commit()}


# Order matters only where two paths could match the same request; this
# is the order the routes were registered in before the split.
for _router in (pack.router, auth.router, intake.router, review.router,
                home.router, quest.router, items.router, eyes.router,
                mcp_connector.router, chat.router, lists.router,
                expiry.router, account.router, stores.router,
                album_routes.router, shelf.router, friends.router,
                avatar.router, receipts.router, hunt_routes.router,
                storemap.router, haul_routes.router, prices.router,
                groups.router, questmap.router, town.router, ops.router,
                receiptjobs.router):
    app.include_router(_router)

def _resume_scan_jobs():
    """Background store scans a deploy restart interrupted carry on."""
    from api import scanjobs
    try:
        scanjobs.resume()
    except Exception:
        _log.exception("could not resume scan jobs")


app.router.on_startup.append(_resume_scan_jobs)


def _resume_receipt_jobs():
    """Background receipt batches a deploy restart interrupted carry on."""
    from api import receiptjobs
    try:
        receiptjobs.resume()
    except Exception:
        _log.exception("could not resume receipt jobs")


app.router.on_startup.append(_resume_receipt_jobs)

# The open Lists API is its own small app, so its errors and schema
# (/api/v1/openapi.json) stay separate from the app's routes.
app.mount("/api/v1", lists_v1.v1)

# The app is the React build (web/dist) at /. The static folder
# (pwa/: images, store models, three.js, scene.js, the manifest and
# icons) is served at / beside it; the build wins on a name clash.
# /next/ was the app's address while it was being ported: old links
# and home-screen icons land on the same path at /.
_WEB = os.path.join(os.path.dirname(__file__), "..", "web", "dist")


@app.api_route("/next", methods=["GET", "HEAD"], include_in_schema=False)
@app.api_route("/next/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def _next_moved(request: Request, path: str = ""):
    # lstrip: "/next//evil.example" must not become "//evil.example".
    q = request.url.query
    return RedirectResponse("/" + path.lstrip("/\\") + ("?" + q if q else ""), status_code=302)


@app.get("/team", include_in_schema=False)
@app.get("/team/", include_in_schema=False)
def _team_page():
    """Team sign-in (owner, 2026-10-30): the password form for beta testers
    and test agents lives here, off the public sign-in page. Not a secret:
    the password route stays rate limited. The shell shows the form."""
    index = os.path.join(_WEB, "index.html")
    if not os.path.isfile(index):
        return JSONResponse({"detail": "the app is not built"}, status_code=404)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})


@app.get("/privacy", include_in_schema=False)
@app.get("/terms", include_in_schema=False)
def _legal_redirect(request: Request):
    """The public privacy policy and terms are static pages (pwa/privacy/,
    pwa/terms/); the bare path goes to the folder so relative links work."""
    return RedirectResponse(request.url.path + "/", status_code=301)


@app.get("/developers", include_in_schema=False)
@app.get("/developers/", include_in_schema=False)
def _developers_page():
    """The public developer page is a screen of the React app: the shell
    answers /developers and the app shows it before sign-in."""
    index = os.path.join(_WEB, "index.html")
    if not os.path.isfile(index):
        return JSONResponse({"detail": "the app is not built"}, status_code=404)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})


@app.get("/developers/reference", include_in_schema=False)
def _developers_reference():
    """The interactive Lists API reference: Scalar (vendored, served from
    /vendor, no inline script) drawing /api/v1/openapi.json. Public."""
    page = os.path.join(_PWA, "developers", "reference.html")
    if not os.path.isfile(page):
        return JSONResponse({"detail": "not found"}, status_code=404)
    return FileResponse(page, headers={"Cache-Control": "no-cache"})


_BUILT_DIR = os.path.realpath(os.path.join(_WEB, "app"))
_PWA_CACHED = tuple(os.path.realpath(os.path.join(_PWA, d)) + os.sep
                    for d in ("assets", "icons"))
_PWA_VENDOR = os.path.realpath(os.path.join(_PWA, "vendor")) + os.sep


def _static_cache_control(full_path):
    """Hashed build files (web/dist/app/) never change under their name,
    so they are cached for a year and a repeat visit skips the round
    trip; a new build names new files and index.html (no-cache) points
    at them. Images and icons keep their names across edits: a day,
    then the browser revalidates by ETag. Vendored files (/vendor) change
    only with a deliberate upgrade: a week (audit M7)."""
    p = os.path.realpath(full_path)
    if p.startswith(_BUILT_DIR + os.sep):
        return "public, max-age=31536000, immutable"
    if p.startswith(_PWA_VENDOR):
        return "public, max-age=604800"
    if p.startswith(_PWA_CACHED):
        return "public, max-age=86400"
    return None


_NOT_FOUND_PAGE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · Arya</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:17px/1.5 system-ui,-apple-system,sans-serif;background:#EFEFF1;color:#1B1B1E}
main{max-width:320px;padding:24px;text-align:center}h1{font-size:24px;margin:0 0 8px}p{margin:0 0 20px;color:#5f5f66}
a{display:inline-block;padding:12px 22px;border-radius:12px;background:#C2410C;color:#fff;text-decoration:none;font-weight:600}</style>
</head><body><main><h1>This page isn't here</h1><p>The link may be old or mistyped.</p><a href="/">Open Arya</a></main></body></html>"""


class _AppFiles(StaticFiles):
    """StaticFiles over several folders, first match wins. The shell
    (index.html) and the worker are revalidated on every load, so a
    new build's hashed file names are never asked for by an old page."""

    def __init__(self, *dirs):
        self._dirs = [d for d in dirs if os.path.isdir(d)]
        super().__init__(directory=self._dirs[0], html=True)

    def get_directories(self, directory=None, packages=None):
        return list(self._dirs)

    async def get_response(self, path, scope):
        """A page that does not exist gets a plain page with a way home,
        not {"detail":"Not Found"} (retest 2026-10-31 #12). API paths
        and non-browser requests keep the JSON 404."""
        from starlette.exceptions import HTTPException as _StarletteHTTP
        from fastapi.responses import HTMLResponse
        try:
            return await super().get_response(path, scope)
        except _StarletteHTTP as e:
            accept = dict(scope.get("headers") or []).get(b"accept", b"").decode("latin-1")
            if e.status_code != 404 or scope.get("method") != "GET" or "text/html" not in accept or path.startswith("api"):
                raise
            return HTMLResponse(_NOT_FOUND_PAGE, status_code=404, headers={"Cache-Control": "no-cache"})

    def file_response(self, full_path, *args, **kwargs):
        resp = super().file_response(full_path, *args, **kwargs)
        if os.path.basename(full_path) in ("index.html", "sw.js", "boot.js"):
            resp.headers["Cache-Control"] = "no-cache"
        else:
            cc = _static_cache_control(full_path)
            if cc:
                resp.headers["Cache-Control"] = cc
        return resp


if os.path.isdir(_WEB) or os.path.isdir(_PWA):
    app.mount("/", _AppFiles(_WEB, _PWA), name="app")
