# 2026-11-02 Run Arya on a laptop with Docker

Owner, 2026-11-02, approved: a judge can run Arya locally in a few steps, using their own Meta key.

- `compose.yaml` at the repo root runs one service, `arya`. It is built from `assistant/deploy/Dockerfile.api`, the same image as live, and serves http://localhost:8080 (`ARYA_LOCAL_PORT` changes the port).
  - There is no Caddy and no `/home/ubuntu` mounts.
  - `ARYA_INSECURE_COOKIE=1` is set, because the session cookie has to work over plain http.
  - It keeps a healthcheck on `/health`, and `ARYA_HEALTH_MIN_FREE_MB=50`, since laptops run fuller disks.
  - The first start writes the demo household (`harness.make_demo_household`) into the empty `arya-local-data` volume. Later starts keep that data, and `down -v` resets it.
- `.env.local.example` (copy it to `.env`) sets only:
  - `MODEL_API_KEY`, the only required setting;
  - `ARYA_STORE=json`, `ARYA_PHOTO_READER=auto` and `ARYA_SPARK_TIER=standard`;
  - optional `BASETEN_API_KEY` (without it the staple judge's second seat is skipped: `/api/judge/second-seat` answers `provisioned: false`);
  - optional `ARYA_LOCAL_PORT`.
- Steps: `cp .env.local.example .env`, add the key, `docker compose up --build`, open http://localhost:8080, tap Try it now. `docker compose --profile local up --build` also works, since no service has a profile.
- The live deploy (`assistant/deploy/docker-compose.yml`, run from `deploy/`) is unchanged. `tests/test_local_compose.py` checks that the two stay apart.
- Verified in the build sandbox: the image builds, the demo is seeded, the container reports healthy, "Try it now" opens Today, and `/api/home` returns 200. A restart did not re-seed. Without a key, Ask answers 503 "MODEL_API_KEY not provisioned on this runtime".
- Also: the "Meta may train" wording is gone from the meta_client comment and from the Ops strings `ai.readerWarn` and `ai.tierWarn`, per the owner's wording rule.
