# Scalability design

Status: a plan, not shipped. Nothing on this page is built unless it says
"today". Written 2026-11-02 against `main` after #489. It extends the
one-line plan in [`ROADMAP.md`](ROADMAP.md) ("Scale out as the community
grows") and the Known limits entry in the [README](../README.md#what-are-the-known-limits).
Where this page says more, it does not contradict them. No provider, dates
or costs are named. Each phase is chosen when the number of shoppers asks
for it.

One idea shapes every choice here: Arya is a community app that grows
with its users. The design keeps one codebase and one set of product rules
(`assistant/docs/SPEC.md`). The operator turns each phase on with
settings, one at a time, with a way back.

## 1. What runs today

One container, one process, one VM, as recorded in
[`assistant/docs/ARCHITECTURE.md`](../assistant/docs/ARCHITECTURE.md) sections
0.5, 0.10 and 11.

```
phone (PWA)  --https-->  CDN / DNS proxy  --->  Caddy (TLS)  --->  uvicorn, 1 process
                                                                   |  FastAPI routes
                                                                   |  engines ($0 code)
                                                                   |  model client
                                                                   v
                                      data volume (JSON per account, photos, caches)
                                      Postgres on Supabase (mirror, ARYA_STORE=dual)
                                      Meta Model API, Baseten (model calls)
```

Where state lives today, and why each one matters for scale:

| State | Where it lives today | Shared across processes? |
|---|---|---|
| Account documents (receipts, lists, flags, quest, ...) | JSON files under `data/users/<account>/`, mirrored to `arya.user_docs` in Postgres (`dual`) | No: file locks are per process, mirror is write-only |
| Group documents | `data/groups/<id>/`, same mirror | No |
| Sign-in sessions | `sessions.json` plus a parsed copy in process memory | Through the file only |
| Demo sessions and sandboxes | Process memory (`auth._demo_sessions`, `demo_guard._demo_sandboxes`) | No |
| Rate-limit and door buckets | Process memory (`api/deps.py`, `api/demo_guard.py`) | No |
| Cost ledger | JSON lines file, scanned whole for "spent today" | Through the file only |
| Receipt originals, shelf frames, map images | Files on the data volume (`storemap_img.json` is rewritten per photo) | No |
| Receipt and scan jobs | One worker thread per process, pending list in a file | No |
| Group live sync | Postgres `NOTIFY arya_group` (one listener thread per process) | Yes, when `DATABASE_URL` is set |
| Push reminders | A daily cron line on the VM | n/a |

### 1.1 Bottlenecks, in the order they will bite

Measured numbers are from the read-only performance pass of 2026-11-02 on a
development machine with a 117-receipt account, not the live server (the
README says the same). The ordering below is a judgment, not a measurement.

1. **One process, one GIL.** The Today payload is computed in Python on each
   read (the derived list, ledger and patterns are rebuilt from receipts, with
   a per-request memo only). Alone it takes about 65 ms. With 10 people at
   once the median is about 1.1 s, and with 30 about 4 s. Threads share the
   interpreter, so more threads do not help. The fix is more processes,
   which the next three items block.
2. **Process memory holds visitor state.** Demo sessions, demo sandboxes
   and rate-limit buckets live in the process. A second process would not
   see a demo visitor's session. A restart drops every demo visit.
3. **Files have one writer.** `_file_lock` is a process-local lock. Two
   processes writing the same account's `lists.json` would race. Dual mode
   mirrors the whole document, so the mirror carries no version and
   cannot detect a lost update. `pg` mode (not live) is a whole-document
   read-modify-write with the same process-local locks.
4. **Saves wait for the mirror.** In `dual` mode each save upserts the whole
   document to Postgres inside the request thread (connect timeout 5 s, one
   retry). A slow database slows every tick on a list.
5. **Model calls share the request thread pool.** Reads of receipts, Ask and
   shelf scans run in the default thread pool beside sync routes. A burst of
   receipt reads can starve plain page loads, and provider rate limits are
   handled per call, not per app.
6. **Big blobs rewrite on every change.** `storemap_img.json` is rewritten per
   mapping photo; receipt originals live on one disk; the nightly backup
   is on the same disk unless `ARYA_BACKUP_REMOTE` is set.
7. **No shared cache.** The Today payload is recomputed per request. The
   per-request memo saves repeat work inside one request only.
8. **Observability is logs and `/health`.** There is a cost ledger and an ops
   digest, but no request timing, no queue depth and no alert.

## 2. Target architecture

The target is plain on purpose: stateless app processes behind a load
balancer, one database as the master copy, one shared store for short-lived
state, one queue for background work, and one object store for files. Every box
below is a role, not a product.

```
phone (PWA) --> CDN / edge cache (static shell, images)
                     |
                     v
              load balancer (TLS, health checks, sticky nothing)
                     |
        +------------+------------+------------+
        |            |            |            |
     app proc     app proc     app proc     app proc      (N identical, stateless)
        |            |            |            |
        +-----+------+-----+------+-----+------+
              |            |            |
              v            v            v
        Postgres        shared        queue        object storage
        (master copy,   key-value     (jobs,       (receipt originals,
        per-doc         store         reminders,   shelf frames, map
        versions,       (sessions,    model calls) images; private
        LISTEN/NOTIFY)  demo boxes,                buckets, signed URLs)
                        rate buckets,
                        hot cache)
                                      |
                                      v
                                 worker procs (same image, no HTTP)
                                      |
                                      v
                             model gateway (one place for
                             concurrency, retries, provider
                             rate limits, cost ledger rows)
                                      |
                                      v
                          Meta Model API, Baseten (unchanged)

        metrics + logs + traces from every box --> one dashboard, a few alerts
```

### 2.1 Stateless app processes

- Same container image as today, started with N processes behind the load
  balancer. A process keeps nothing between requests except read caches it
  can lose. Any process can serve any request, so a crash or a deploy takes
  one process out, not the site.
- Health check stays `/health`; the load balancer stops sending to a process
  that fails it. Rolling deploys replace processes one at a time, and the
  in-memory demo state no longer matters because it has moved out (2.3).
- Code change: none to routes. The seams already exist: `state._load/_save`,
  `auth.new_session/session_info`, `demo_guard._demo_sandbox`, `deps` rate
  buckets, `receiptjobs`/`scanjobs` queues, `live.changed`. Each gets a
  shared backend behind the same function names.

### 2.2 Postgres as the master copy

Today Postgres mirrors files (`dual`). The target makes it the only writer
path (`pg`), with these additions that `pgstore.py` does not have yet:

- **A version per document.** `user_docs` gains a `version` integer. A save
  sends the version it read, and the update is `where version = $read`. Zero rows
  means someone else saved first. The request then re-reads, re-applies and
  retries a few times, then fails plainly. This replaces the process-local
  file lock and is the one change that makes several processes safe.
- **Connection pool.** One pool per process with a small cap, instead of one
  connection per thread. Timeouts short, so a slow database degrades a
  request, never hangs a worker.
- **Rows for the things that are not documents.** Sessions, the cost ledger,
  job state and the pending lists become ordinary tables, so "spent today" is
  one indexed `sum`, not a whole-file scan. Stockout reports, friends and
  store maps can follow later (stage 2 in
  `assistant/loops/2026-10-28-supabase-seam.md`); they
  can stay as documents for a long time.
- **Group live sync** keeps `LISTEN/NOTIFY`; with N processes each holds one
  listener, which is already how `live.py` is written.

Migration from JSON, in order, each step reversible:

1. Keep `dual`. Add `version` with a default of 0 and the versioned update
   path behind a flag; files remain the truth. Nothing observable changes.
2. Re-run `assistant/tools/migrate_json_to_pg.py`, compare every document (it reports
   mismatches), and fix any drift. Back up both sides (`backup.sh` already
   dumps the schema when `ARYA_BACKUP_DATABASE_URL` is set).
3. Flip `ARYA_STORE=pg` on one process while the others stay on `dual`,
   but only if the versioned path is on. Otherwise flip the whole site in a
   quiet hour. Keep writing files for a while as a shadow copy (a new
   `pg+shadow` mode, or the same `dual` logic with Postgres first and the file
   second) so rollback is a flag flip, not a restore.
4. Stop the shadow file writes once a full backup cycle has passed with no
   mismatch. From here the files are a backup format, not a store.

Rollback at any step: set `ARYA_STORE` back one mode and redeploy. Before
step 4 the files are current; after step 4 rollback means restore the
latest file export from the database (a small export tool is part of the
phase, see 4).

### 2.3 Session and demo state in a shared store

- **Sign-in sessions** move to a table or the key-value store, keyed by the
  token hash, with the expiry as a TTL. `session_info` reads one key. The
  parsed-file cache (`_SESSIONS_SEEN`) goes away; a short per-process cache
  with a TTL of seconds is fine.
- **Demo sessions and sandboxes** move to the key-value store with a TTL of
  one visit (hours), keyed by the demo cookie. The sandbox overlay is already
  a dict keyed by file path with a 2 MB cap, so it serialises as one value
  per visit. Reads load the overlay once per request; writes save it back at
  the end of the request. This is the change that lets a demo visit survive a
  deploy and lets two processes serve one visitor.
- **Rate-limit and door buckets** move to the same store with atomic
  increments and TTLs, so a cap of "240 door hits per IP per hour" holds
  across processes.
- Keep the in-process path as the fallback when no shared store is set, so
  a laptop run (`compose.yaml`) and the tests stay as they are.

### 2.4 Background jobs and reminders

- Today: one worker thread per process for receipt batches and store scans,
  with a pending list in a file, and a cron line for reminders.
- Target: a queue with named job types (`receipt.read`, `scan.read`,
  `reminders.daily`, `backup.nightly`, `export.account`) and worker processes
  that run the same code as today's thread loops. A job carries the account,
  a lease and a retry count. A crashed worker's lease expires and another
  worker picks the job up. Idempotency keys (the job id plus the frame
  number, which `receiptjobs` already uses) make a retry safe.
- Reminders become a scheduled job that enqueues one `reminders.account` job
  per opted-in account. A slow push to one phone then does not delay the rest,
  and the cron line on the VM goes away.
- The "Your receipts are ready" and "Your map is ready" cards keep polling
  the job list exactly as now; only the producer of that list changes.

### 2.5 Model calls: one gateway, queued, rate-limited

- Every model call already goes through `api/meta_client.py` (and
  `open_client.py` for the open model). The target puts a small gateway
  behind those two modules: a per-model concurrency cap, a per-provider
  token-bucket for the published request limits, retries with backoff on
  429 and 5xx, and a timeout per job kind (Wonder re-reads are long, Ask is
  short).
- Interactive calls (Ask, a single receipt from the camera) keep a reserved
  share of the concurrency so a batch upload never blocks a question.
- Batch calls (bulk receipt reads, scans, judge runs, dictionary enrichment)
  go through the queue (2.4) and the gateway's batch share.
- Budgets stay as they are in policy (`ARYA_DAILY_BUDGET_USD`, demo buckets,
  per-account limits); their counters move to the database (2.2) so they hold
  across processes. A **spend reservation** is taken before the call and
  settled after, so two processes cannot both spend the last dollar.
- The ledger row per call stays the audit record; the gateway writes it.

### 2.6 Caching

Three layers, each safe to lose:

1. **Edge.** The built shell and static images already carry immutable
   cache headers; the CDN serves them. Nothing under `/api/` is cached at
   the edge.
2. **Shared hot cache.** The Today payload per account (and per group plane)
   is cached in the key-value store for a few seconds and dropped on any
   save to that account or group (`save_at` is the one choke point, so the
   invalidation is one line). The same for the price facts and the derived
   list. This is the cheapest win on bottleneck 1 and needs no process
   change; the per-request memo stays as the last layer.
3. **Per-process.** Short TTL caches for sessions and settings.

Rule: cache derived data only. Receipts, lists and flags are read from the
master copy, never from a cache, on a write path.

### 2.7 Object storage for photos

- Receipt originals, shelf frames and map images move to a private bucket,
  one key per account and file (`users/<account>/receipts/<id>.<ext>`),
  with signed, short-lived URLs for "View receipt". The database row keeps
  the key, the size and a content hash.
- `storemap_img.json` stops being one rewritten blob: each image is its own
  object and the map document keeps keys only.
- Uploads keep going through the API (the people-scrubbing step must run
  before anything is stored, as today); the API streams the result to the
  bucket. Deletion of an account deletes its prefix.
- Backups: the bucket has versioning or a nightly copy to a second bucket;
  the database dump is the other half. `restore.sh` restores the volume
  today and would restore the dump plus point at the bucket.

### 2.8 Observability

- **Metrics per process:** request count and latency by route (p50, p95),
  in-flight requests, thread pool queue length, database pool wait, cache
  hit rate, queue depth and job age by type, model calls by model with
  latency, error and 429 counts, spend per bucket. Exposed on a
  `/metrics` endpoint the load balancer does not route to the public.
- **Logs:** one JSON line per request with a request id, account hash (not
  the name), route, status, duration and the job id when one applies. The
  same id goes into model calls and ledger rows.
- **Traces:** optional; a request id in logs covers most of what a trace
  would, until there are several services.
- **Alerts, few and plain:** `/health` red for a few minutes; p95 of
  `/api/today` above a line; queue age above a line; model error rate above
  a line; daily spend near the ceiling. The existing ops digest
  (`harness/ops.py`) becomes a reader of the same metrics.
- **Privacy:** no receipt content, no names and no photos in logs or
  metrics; the people-scrubbing and personal-data rules in `meta_client`
  stay the boundary.

## 3. Phased migration plan

Each phase is turned on by settings on the current image, has a
measurement that says whether it worked, and has a rollback that is a flag
flip or a redeploy of the previous image. Phases go in this order because
each one removes the blocker for the next. None has a date.

| Phase | What changes | Blocker it removes | Rollback | What to measure |
|---|---|---|---|---|
| 0. Baseline | Add request timing and a `/metrics` endpoint; run the Today load script against the live site in a quiet hour; set `ARYA_BACKUP_REMOTE` and prove one restore off the VM | Nothing is known about the live ceiling | Remove the endpoint | p50 and p95 of `/api/today` at 1, 10, 30 concurrent on the live server; restore time |
| 1. Hot cache | Today, price facts and derived list cached per plane for a few seconds, invalidated on save; mirror writes moved off the request path (a background queue in-process, with a circuit breaker on failure) | Bottlenecks 1 (partly), 4 and 7 | Flag off the cache; flag off the async mirror | Same load test: median at 10 and 30 concurrent; cache hit rate; save latency with the mirror slow or down |
| 2. Postgres master | `version` column and versioned updates; connection pool; sessions and ledger as tables; `pg` with shadow file writes; then shadow off | Bottleneck 3 and the one-writer rule | `ARYA_STORE` back one mode; restore from files until shadow is off | Mismatch count from the migration check (must be 0); lost-update retries per hour; database pool wait |
| 3. Shared short-lived state | Demo sessions, sandboxes and rate buckets in a shared key-value store, with the in-process path as fallback | Bottleneck 2 | Unset the store address; the process path returns | A demo visit survives a deploy; door caps hold across two processes |
| 4. Several processes | Start N processes behind the load balancer on the same VM first, then on more than one machine; rolling deploys | Bottleneck 1 | N back to 1 | p50 at 30 concurrent falls in step with N; zero demo visits dropped during a deploy |
| 5. Queue and workers | Receipt, scan and reminder jobs on the queue; worker processes; cron line retired | Bottleneck 5 (partly) | `ARYA_*_JOBS_INLINE` style flags back to the thread loop | Job age p95; retries; jobs lost on a worker restart (must be 0) |
| 6. Model gateway | Concurrency caps, provider rate buckets, spend reservation, interactive reserve | Bottleneck 5 | Caps to unlimited; reservation off | 429s per hour; Ask latency while a batch runs; spend over the ceiling (must be 0) |
| 7. Object storage | Originals, frames and map images in a bucket; `storemap_img.json` split | Bottleneck 6 | Keep files on the volume until the copy is verified; read from the volume on a bucket miss | Bytes on the volume; map save latency; signed-URL errors |
| 8. Cloud provider | Move the whole set (processes, database, store, queue, bucket) to a provider with managed versions of each; the VM becomes a fallback until a full week passes | Hardware ceiling | DNS back to the VM | Same dashboard, same alerts, same load test |

Phases 0 and 1 can happen on the current VM with no new service.
Phase 2 uses the database that already exists. Phase 3 is the first new
service. From phase 4 on, the choice of provider matters, and the design
above lets any of them fit.

## 4. Risks and how the plan answers them

| Risk | Answer |
|---|---|
| Lost updates when two processes save one document | Versioned updates (2.2) before any second process (phase 2 before 4). Never the other order. |
| A migration that silently drops a document | The migration tool already counts mismatches; phase 2 requires zero before `pg`, and shadow file writes keep a second copy. |
| Demo visits dropped during judging | Not a risk here: no phase runs before judging ends. Later, phase 3 removes it. |
| Cost spike from more processes | The budgets are per app, not per process, once counters live in the database (phase 2) and a reservation exists (phase 6). Until then, run one process. |
| Privacy rules weaken as state moves | Each move keeps the same boundary: scrub before store, hashes not names in sessions and logs, personal data only to Meta Standard mode as recorded in `AGENTS.md`. A phase that touches photos (7) needs a privacy review first. |
| Vendor lock-in | Every box is a role with a plain interface (SQL, key-value with TTL, a queue with leases, object keys with signed URLs). Nothing uses a provider-only feature. |
| More moving parts than one person can run | Each phase stays optional and off by default; a laptop run and the tests keep the in-process path. The dashboard and alerts (2.8) come in phase 0, before anything else. |
| Reads stay slow because the engines are Python | The hot cache (phase 1) and N processes (phase 4) are the first answers. Precomputing the derived state on save instead of on read is a later option the memo design already allows. |

## 5. What stays the same

The product rules, the engines in code at $0, the one model client, the
cost policy, the privacy boundary, the PWA, the connector and the API. A
shopper would not see a phase happen, except that Today loads as fast with
hundreds of neighbours as it does alone today.

## 6. Related pages

- [`ROADMAP.md`](ROADMAP.md): the one-line plan this page expands.
- [`../README.md#what-are-the-known-limits`](../README.md#what-are-the-known-limits): the limit as
  judges read it.
- [`../assistant/docs/ARCHITECTURE.md`](../assistant/docs/ARCHITECTURE.md):
  what runs today, section by section.
- [`../assistant/docs/SCALE-SIM.md`](../assistant/docs/SCALE-SIM.md): the
  simulator and its earlier findings.
- `assistant/docs/OPS.md`: the runbook that each phase updates.
