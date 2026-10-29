# 2026-10-29 — compose env flags

- Found while mapping the repo: `deploy/docker-compose.yml` lists the api
  environment explicitly and has no `env_file`, so eight switches the app
  reads never reached the container (photo reader, registration, the
  three budget caps, feedback cap, push reminders and VAPID keys).
- Added them with defaults equal to the code defaults, so nothing changes
  until `.env` sets them. `.env.example` now lists them.
- New `tests/test_compose_env.py` fails when code reads an env var that
  compose does not pass, and checks the numeric defaults parse.
- Next: after merge, deploy (`git pull` + `compose up -d --build`). On
  Nov 4, set `ARYA_PHOTO_READER=spark` in `deploy/.env` and rebuild.
