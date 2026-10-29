"""Arya API — FastAPI entry point.
All Meta calls go through api.meta_client; all money math is code.

Event-loop rule (review 2026-10-28, H1): MetaClient is blocking
urllib with timeouts up to 120 s, so no route may call a model —
or judge_pending, which calls the judge — on the event loop.
Model work runs through run_in_threadpool; a slow photo read then
stalls one worker thread, never every other request."""
import logging, os
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from api import album_routes, haul_routes, hunt_routes, pack, state
from api.demo_guard import require_login
from api.deps import _PWA
from api.routes import (account, auth, avatar, chat, expiry, eyes, friends, groups, home,
                        intake, items, lists, mcp_connector, prices, quest,
                        receipts, review, shelf, storemap, stores)

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
                groups.router):
    app.include_router(_router)

if os.path.isdir(_PWA):
    app.mount("/", StaticFiles(directory=_PWA, html=True), name="pwa")
