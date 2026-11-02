# Run Arya on your own computer

For judges and anyone who wants to try Arya locally with their own Meta key.
The live demo needs none of this: https://arya.teamnightshift.org, then "Try it
now".

## What you need
- **Docker** with Compose (Docker Desktop, or Docker Engine and the Compose
  plugin). Nothing else: no Python, no Node.
- **A Meta Model API key** for the AI parts. Make one at dev.meta.ai (API keys,
  then Create API key); it starts with `LLM_`. It is optional: without it the
  app and the demo household open and work, but anything that reads a photo,
  answers in Ask or listens to your voice says it cannot reach Meta.
- A phone-size window. On a laptop, make the browser about 390 px wide. Camera
  and microphone steps need a phone.

## Start it
From the repository root:

```
cp .env.local.example .env       # then put your key on the MODEL_API_KEY line
docker compose up --build
```

Open http://localhost:8080. The first build takes a few minutes. On the first
visit a "Create your account" sheet opens. That makes the one real account on
this copy: a username (lowercase letters, digits and `_ % + @ -`, and `.` after the first character) and a password. Use it
to snap or upload your own receipts and see them read and saved, which is
Arya's core feature. Or close the sheet and tap **Try it now** for the demo
household. The demo keeps nothing, so it cannot add receipts; Ask, photos of a
list and voice work there with your key. The first start also writes the demo
household into a Docker volume; later starts keep what is there.

## Settings (`.env`)
Only one is required.

| Setting | What it does | Default |
|---|---|---|
| `MODEL_API_KEY` | Your Meta key. Receipts, Ask, voice, notes and store scans use it | empty (AI off) |
| `ARYA_STORE` | Where data is kept. `json` means files in a Docker volume | `json` |
| `ARYA_PHOTO_READER` | `auto`: Muse Spark reads a photo first, Muse Wonder re-reads one the checks flag. Or `spark`, `wonder` | `auto` |
| `ARYA_SPARK_TIER` | Spark runs on Meta's Standard plan | `standard` |
| `BASETEN_API_KEY` | Optional. Muse Spark Open, the staple judge's second seat. Leave empty to skip that check | empty |
| `ARYA_LOCAL_PORT` | Use another port if 8080 is taken | `8080` |

Ignore everything else in `assistant/deploy/.env.example`: Supabase, email,
Google, push and the other settings are for the live site. They default off.

## What it costs you
Every model call runs on your key and your Meta account. The demo household
keeps its visit limit locally too: about $0.40 of live reads per visit and
$2 a day for the demo (`ARYA_DEMO_SESSION_BUDGET_USD`,
`ARYA_DEMO_DAILY_BUDGET_USD`). Pricing is in
[`assistant/docs/MODEL-POLICY.md`](../assistant/docs/MODEL-POLICY.md).

## Stop, reset, change the port
- After editing `.env`, run `docker compose up -d`. `docker compose restart` does
  not re-read `.env`.
- Stop: press Ctrl+C, or `docker compose down`. Your data stays.
- Start over (wipes the volume; the next start writes the demo household again):
  `docker compose down -v`.
- Another port: set `ARYA_LOCAL_PORT` in `.env`.

## What is different from the live site
- One container, plain `http://localhost`, no Caddy and no certificate. The
  session cookie is set to work over plain http (`ARYA_INSECURE_COOKIE=1`).
- JSON files in a volume instead of Supabase. No email, so you sign in with the
  username and password you made on the first visit.
- Demo Town (the simulated neighborhood) is off, so the demo household shops at
  its own stores. Registration is closed. The `compose.yaml` here does not
  touch the live deploy, which uses `assistant/deploy/docker-compose.yml`.

## Without Docker
You need Python 3.12 and Node 22. From the repository root:

```
python3 -m venv .venv && .venv/bin/pip install -r assistant/api/requirements.txt
cd assistant/web && npm ci && npm run build && cd ..
../.venv/bin/python -m harness.make_demo_household data
MODEL_API_KEY=<your key> ../.venv/bin/python -m uvicorn api.main:app --port 8000
```

Open http://localhost:8000. For front-end work, `npm run dev` in
`assistant/web` starts Vite.

## Tests
```
(cd assistant && ../.venv/bin/python -m unittest discover -s tests)
(cd assistant/web && npm test)
```
Current counts and known failures: [`STATUS.md`](../STATUS.md). CI is
manual-only (`.github/workflows/tests.yml`).

## If something goes wrong
- **"This copy of Arya has no Meta key, so AI features are off. Put your key from
  dev.meta.ai after MODEL_API_KEY= in the .env file, then run: docker compose up -d"**
  `MODEL_API_KEY` is empty, or the container was not recreated after you
  edited `.env`. Fix `.env`, then `docker compose up -d`.
- **Receipts says "Reading paused" and there is no key.** The same cause as
  above: add the key and run `docker compose up -d`.
- **Port already in use.** Set `ARYA_LOCAL_PORT` to a free port.
- **A model error with a key set.** The key was rejected or has no credit;
  check it at dev.meta.ai.
- **Status check.** `http://localhost:8080/health` answers when the app is up.

This is not the feature "Use your own Meta key" in the live app's Settings,
which is built and switched off (see [After the hackathon](ROADMAP.md)). Here
the key is the server's key, set in `.env`.
