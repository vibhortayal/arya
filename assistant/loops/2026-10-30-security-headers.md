# 2026-10-30 — API docs off, Range dropped, Permissions-Policy

From the 2026-10-30 audit (owner approved M2, L9 and the H2 stopgap).

- M2: `api/main.py` builds FastAPI with `docs_url`, `redoc_url` and
  `openapi_url` off. `/docs`, `/redoc` and `/openapi.json` listed every
  route, admin ones included, to anyone. The Lists API keeps
  `/api/v1/openapi.json` (its own app). `tests/test_api_docs_off.py`.
- H2 stopgap: Starlette 0.46 handles a crafted `Range` header in
  quadratic time (PYSEC-2026-1942, no sign-in needed). Caddy drops
  `Range` (`request_header -Range`); every file now comes whole, and
  nothing in the app asks for parts. The real fix (FastAPI and Starlette
  upgrade) waits until after Nov 4.
- L9: `Permissions-Policy` allows camera, microphone and geolocation for
  this site only and turns off payment and USB; `-Server` hides
  `server: uvicorn`.
- Tests: `test_caddy_limits` (3 new), `test_api_docs_off` (new),
  `test_csp`, `test_compose_env`, `test_lists_api_v1`,
  `test_developers_page`: green.
- Not validated with a Caddy binary here. On the VM, before reload:
  `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile`.
