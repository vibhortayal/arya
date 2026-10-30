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
                        intake, items, lists, lists_v1, mcp_connector, prices, quest,
                        questmap, receipts, review, shelf, storemap, stores, town)

app = FastAPI(title="Arya API")
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


@app.get("/health")
def health():
    # No receipt count: /health runs with no account, so it counted the
    # root plane, which holds none (review M11). Liveness only.
    return {"status": "ok", "service": "arya-api", "stage": 3}


# Order matters only where two paths could match the same request; this
# is the order the routes were registered in before the split.
for _router in (pack.router, auth.router, intake.router, review.router,
                home.router, quest.router, items.router, eyes.router,
                mcp_connector.router, chat.router, lists.router,
                expiry.router, account.router, stores.router,
                album_routes.router, shelf.router, friends.router,
                avatar.router, receipts.router, hunt_routes.router,
                storemap.router, haul_routes.router, prices.router,
                groups.router, questmap.router, town.router):
    app.include_router(_router)

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


@app.get("/developers", include_in_schema=False)
@app.get("/developers/", include_in_schema=False)
def _developers_page():
    """The public developer page is a screen of the React app: the shell
    answers /developers and the app shows it before sign-in."""
    index = os.path.join(_WEB, "index.html")
    if not os.path.isfile(index):
        return JSONResponse({"detail": "the app is not built"}, status_code=404)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})


class _AppFiles(StaticFiles):
    """StaticFiles over several folders, first match wins. The shell
    (index.html) and the worker are revalidated on every load, so a
    new build's hashed file names are never asked for by an old page."""

    def __init__(self, *dirs):
        self._dirs = [d for d in dirs if os.path.isdir(d)]
        super().__init__(directory=self._dirs[0], html=True)

    def get_directories(self, directory=None, packages=None):
        return list(self._dirs)

    def file_response(self, full_path, *args, **kwargs):
        resp = super().file_response(full_path, *args, **kwargs)
        if os.path.basename(full_path) in ("index.html", "sw.js"):
            resp.headers["Cache-Control"] = "no-cache"
        return resp


if os.path.isdir(_WEB) or os.path.isdir(_PWA):
    app.mount("/", _AppFiles(_WEB, _PWA), name="app")
