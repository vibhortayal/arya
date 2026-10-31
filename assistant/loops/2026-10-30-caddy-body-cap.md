# 2026-10-30 — Caddy caps request bodies at 40 MB

From the 2026-10-30 audit (owner approved H4).

- Every upload route reads the whole body (`await req.body()`) before it
  checks the size (12 MB photo, 10 MB PDF or recording), and Caddy had
  no limit, so a multi-GB body could fill the VM's memory. A demo
  session, open to anyone, reaches the photo doors.
- `deploy/Caddyfile`: `request_body { max_size 40MB }` on the app's
  site; Caddy answers 413. 40 MB is above the largest real upload (a
  12 MB photo as base64 is about 16 MB; Costco order imports are JSON).
- `tests/test_caddy_limits.py` pins it. Ran it with `test_csp` and
  `test_compose_env`: green.
- Not validated with a Caddy binary here (none installed). On the VM,
  before reload: `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile`.
