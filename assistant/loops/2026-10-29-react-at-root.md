# 2026-10-29 — The React app is the app at /

Branch `feat/react-at-root`. The React app (`assistant/web`) replaces the
plain-JS app (`assistant/pwa/*.js`). The API serves the React build at
`/`. The old app stays in git history: the tag `plain-js-app`, and commit
80bd79d (main with #151 and #152, the last commit before the switch).

## What changed

- **Serving** (`api/main.py`). `_AppFiles` serves `web/dist` first, then
  the static folder `pwa/`. `index.html` and `sw.js` go out with
  `Cache-Control: no-cache`. The app has no path routes: it reads the
  query (`?join=`) and the hash (`#list`). A path with no file is a 404,
  as `/next/list` was on main.
- **Old address.** `/next` and `/next/...` answer 302 to the same path at
  `/`. The query stays (`/next/?join=CODE` still opens the invite).
  `/next//evil.example` goes to `/evil.example`,
  never to another host.
- **Static folder.** `pwa/` keeps only the files that the app loads at
  run time: `scene.js`, `vendor/three.module.js`, `assets/`, `models/`,
  the icons, `manifest.json` and `auth-callback.js`. The manifest
  `start_url` and `scope` are `/`.
- **Deleted.** 23 files in `pwa/`, 15,171 lines: `app.js` (2,221),
  `quest.js` (3,858), `pack.js` (1,191), `index.html` (870), `haul.js`
  (875), `huntmenu.js` (817), `mapper.js` (709), `share.js` (450),
  `album.js` (431), `lists.js` (387), `group.js` (384), `powers.js` (289),
  `expiry.js` (250), `push.js` (126), `aryaask.js` (117), `a2hs.js` (77),
  `huntask.js` (67), the old `sw.js` (73) and five stylesheets (`styles.css`
  1,389, `hunt.css`, `haul.css`, `pack.css`, `album.css`; their text
  moved to `web/src/styles/`). `web/src/screens/NotPorted.tsx` is deleted: every
  view has a screen.
- **Last gaps ported** (before the switch). Group live sync
  (`app/groupLive.ts`), the approved curator card on Receipts, and the
  #151 "Turn on" and #152 language changes from main.
- **CSP** (`deploy/Caddyfile`). `script-src 'self'`. The theme-script
  hash is gone: `web/index.html` has no inline script.
- **Docker** (`deploy/Dockerfile.api`). A `node:22-slim` stage runs
  `npm ci` and `npm run build`. The API image copies `web/dist` and the
  static folder. No secret or env change.
- **e2e** (`web/e2e/*.e2e.mjs`). All 34 files open `base + "/"`.
- **Parity** (`web/tools/parity.mjs`). It needs `PARITY_OLD_URL` (the old
  app on another port). Without it, it stops with exit code 2 and a
  message. It reads the views from `SCREENS`.
- **CI** (`.github/workflows/tests.yml`). Node 22 and a new `web` job:
  `npm ci`, `tsc -b`, `vitest run`, `build`. The trigger is still
  `workflow_dispatch` only.
- **Docs.** `web/PORTING.md` is now the guide for app work. `AGENTS.md`
  layout, `STATUS.md`, `DESIGN.md` (token path), `docs/ARCHITECTURE.md`
  §0.1 and §0.10, `docs/USER-JOURNEYS.md`, `docs/MULTILINGUAL-ASK.md` and
  `docs/quest/MAP-MY-STORE.md` point to `web/`.

## Service worker

Source: `web/src/sw.js`. vite-plugin-pwa (`injectManifest`, iife) builds
it to `/sw.js`, the same URL as the old worker. Installed phones get it
on their next update check.

1. **Precache.** `self.__WB_MANIFEST` (the build: `index.html` and the
   hashed bundles) plus `STATIC` (the run-time files from `pwa/`). The
   cache name is `arya-web-` plus a hash of the manifest revisions. No
   person bumps a cache name. A missing `STATIC` file does not stop the
   install (`c.add(u).catch(() => {})`).
2. **Install.** `skipWaiting()`. **Activate.** Delete every other cache
   (the old `arya-v*` caches too), then `clients.claim()`.
3. **Fetch.**
   - Not GET: the worker does not answer (the iOS empty-upload bug).
   - `/api/group/live`: the worker does not answer (an event stream).
   - `/api/`, `/auth/`, `/decode`, `/import`, `/eyes`: the worker does
     not answer. The browser sends them as if there were no worker.
   - Other GETs: network first, then the cache, then `/index.html` for a
     page load when offline.
   - There is one `respondWith` only (pinned in `test_pwa_install`).
4. **Push.** `push` and `notificationclick` are kept unchanged.

A bug was found during the e2e sweep and fixed. The first version
answered the bypass paths with `respondWith(fetch(...))`, so
`page.route` in Playwright did not see `/auth/token` (muse e2e). Now the
handler returns before `respondWith`.

## Python tests: migration table

Rule: no test is skipped or disabled. A pin that read `pwa/*.js` now reads
the React source through `tests/frontend.py` (`src`, `read`,
`index_html`, `app`). A node harness that ran old app code now runs as a
vitest test beside the React code. A pin is dropped only when the thing
it guarded no longer exists. The table gives the reason for each.

| test file | what happened |
|---|---|
| test_add_surface | 3 shell pins -> Lists.tsx / Receipts.tsx / whole app source |
| test_add_to_home_screen | 4 pins -> ui/A2hs.tsx, app/a2hs.ts, Today/Profile; sw.js SHELL pin dropped (no file list now: the build is precached) |
| test_album | 2 "feature marker exists" checks read web/src instead of pwa/*.js |
| test_album_client | pins -> Album.tsx, album/StickerCard.tsx, album/levelup.tsx, Quest.tsx; CSS pins unchanged (album.css moved); node harness (60+ checks) ported to vitest web/src/screens/album/album.test.tsx (7 tests); quest.js-load-order pins dropped (no script tags) |
| test_ask_in_hunt | 3 shell pins -> Hunt.tsx, hunt/AskSheet.tsx; sw/script-tag pins dropped |
| test_ask_in_list | 2 shell pins -> Lists.tsx, lists/AskCard.tsx |
| test_avatar_news | sample-label pin -> Quest.tsx + haul/CrewFeed.tsx |
| test_brain_restyle | 9 pins -> App.tsx/views.ts/registry/screens; CACHE-bump pin -> new sw drops old caches; curator wireframe pins -> Receipts.tsx (PORT FIX: React showed the pre-wireframe curator card with "Ask the Curator"; restored the approved card); dead staplesLine pin -> Today "Open Lists" line; "removeItem(arya-theme)" boot-script pin dropped (no theme switch exists to clear) |
| test_celebration | shell pins -> Hunt.tsx/Express.tsx/hunt/fx.ts; sw precache pin -> new sw STATIC list; node harness (17 resolution checks + disabled hook) ported to vitest web/src/screens/hunt/fx.test.ts |
| test_check_list_choice | 4 pins -> Optimize.tsx (CSS pin unchanged) |
| test_crew_visibility | 5 pins -> App.tsx, views.ts, Profile.tsx, Quest.tsx, Today.tsx, Optimize/Score, haul/Share.tsx |
| test_csp | theme-script hash test -> "web/index.html has no inline script and CSP script-src is 'self'" (Caddyfile hash removed); inline-handler scan covers web/index.html, static files and every TSX |
| test_decode | TestReceiptInputsAcceptPdf: 2 pins -> Receipts.tsx, ui/AddReceiptSheet.tsx, haul/state.ts (the rest of the file is server tests, unchanged) |
| test_expiry | TestClientWiring -> Today.tsx (expiry.js was ported into Today); "not on Lists" pins -> Lists.tsx + lists/ListSheets.tsx; sw pin dropped (the build is precached) |
| test_express_mode | shell pins -> Express.tsx, hunt/Scan.tsx, Mode.tsx, Score.tsx (the same checks: Show me, Not here, Teach Arya, plain Score) |
| test_feature_sheet | pins -> ui/Info.tsx and the screens that open it |
| test_finish_flow | pins -> Finish.tsx, Score.tsx, haul/state.ts |
| test_fun_pass | 26 pins -> Today/Quest/Mapper/Lists/Score/NewList/hunt fx; sw precache pin -> new sw STATIC list; CACHE-name pin dropped (merge with #151 kept the new-scheme side) |
| test_group_live | client pins -> app/groupLive.ts, lib/api.ts (PORT FIX: the React app had no live sync; ported group.js EventSource + X-Arya-Client) |
| test_groups | client pins -> GroupJoin.tsx, Profile.tsx, App.tsx (invite link) |
| test_haul_client | 34 pins -> screens/haul/*, Finish.tsx, Score.tsx, haul.css; node HaulCore + e-receipt harnesses -> vitest web/src/screens/haul/haul.test.tsx (8 + 5 tests) |
| test_howto | pins -> Hunt.tsx (sheet, ?, first-Quest-only auto-open), ui/Sheet.tsx (Esc); behaviour -> hunt.test.tsx "How to play" (2 tests) |
| test_hunt_nav | shell pins -> Hunt.tsx, Express.tsx, styles.css, scene.js; DRIVER + DRIVER_ANYORDER node harnesses (40 checks) -> vitest web/src/screens/hunt/hunt.test.tsx (14 tests: any-order grab, wrap, put back, marker tap, walk/hold, no auto Finish, Back stack, rail -> Score, Express rows); now also exports read/src/section helpers on frontend.py; NODE/PRELUDE removed (no consumer left) |
| test_hunt_menu | server half of the shared fixture kept, fixture moved to web/src/screens/hunt/menu-cases.json (read by both); shell/copy/CSS pins -> Hunt.tsx, hunt/HuntMenu.tsx, hunt/menu.ts, ui/Toast.tsx, ui/Sheet.tsx, hunt.css; QUEST_DRIVER, OUTBOX_DRIVER, MIRROR_DRIVER and toastMs -> vitest hunt/model.test.ts (42 tests incl. 23 fixture cases); MENU_DRIVER -> hunt.test.tsx "the hunt menu and the row" (16 tests); Finish wording -> haul.test.tsx; capture-phase interceptor pins replaced by the React equivalents (Sheet owns keys, onFinish asks first) |
| test_landing | pins -> Login.tsx |
| test_offline_hunt | shell pins -> Hunt.tsx, hunt/model.ts, lib/api.ts; node outbox harness -> hunt/model.test.ts "the offline outbox" |
| test_pack | shell pins -> NewList.tsx, Mode.tsx, Store.tsx, pack.css; PURE, MACHINE, REVIEW, COMBINED node harnesses -> vitest web/src/screens/pack.test.tsx (21 tests); 13 pure Pack functions now exported from NewList.tsx for it. Helper-mode checks (MACHINE 9 checks, COMBINED photo block) retired: helper mode was off in the old app (HELPER_ENABLED = false) and was never ported |
| test_rewards | pins -> Hunt.tsx, Score.tsx, Quest.tsx, QuestProgress.tsx, Store.tsx, NewList.tsx, hunt/Scan.tsx, styles.css; node rewards harness -> fx.test.ts "rewards" (2 tests) |
| test_hunt_v2_screens | pins -> Quest.tsx (QSTATE_LBL, heroSession, Finished group), QuestProgress.tsx, Profile.tsx, Score.tsx, Receipts.tsx, haul/Reveal.tsx, Finish.tsx, ui/AddReceiptSheet.tsx, Hunt.tsx openSession; Back stack behaviour -> hunt.test.tsx + nav.test.tsx |
| test_list_first | pins -> Today.tsx, Quest.tsx, QuestProgress.tsx, Analysis.tsx, Receipts.tsx, Powers.tsx, ui/Info.tsx, Mode.tsx, Hunt.tsx, Login.tsx; the 2 storeAlertRows node tests -> vitest screens/today.test.ts (3 tests) over the new pure Today.tsx storeAlerts (rows were inline JSX) + 1 pin test |
| test_list_overhaul | server tests unchanged; TestListsClient + TestStartShopping pins -> Lists.tsx, lists/ListSheets.tsx, lists/model.ts, Store.tsx, NewList.tsx, Mode.tsx, styles |
| test_list_pass | server test unchanged; client pins -> Lists.tsx (one /api/home read in reload, ListRow, Loading, list-eyes), Chat.tsx (chat-empty) |
| test_localizer | server tests unchanged; shell pins -> Hunt.tsx, hunt/motion.ts; TestAnchorNode (quest.js qAnchorToU harness, 6 checks) -> vitest hunt/motion.test.ts (2 tests) + a pin that they exist |
| test_motion_nav | shell pins -> Hunt.tsx, hunt/motion.ts (+ motion.test.ts step re-anchor test); the scene.js node harness is unchanged (scene.js stays in the static folder); test_sw_cache_bumped (CACHE = "arya-v97") -> test_pwa_install (the new worker has no hand-bumped CACHE name; its precache is revisioned by the build) |
| test_no_connect_first_run | pins -> App.tsx, app/views.ts, app/session.tsx, Muse.tsx, Profile.tsx |
| test_no_map_stores | server tests unchanged; TestPwaNoMap (9) -> TestWebStoreData (6: lib/stores.ts, Express.tsx, Hunt.tsx, Capture.tsx, hunt.css); its sheet-note, Quest-fallback and Express-nudge pins were already duplicated in TestWebNoMap (kept); test_cache_bumped -> test_pwa_install; TestSettingsRename.test_pwa folded into test_web (+ the "no Profile title" check) |
| test_parity | pins -> app/views.ts, Quest.tsx, Receipts.tsx, Receipt.tsx, Finish.tsx, Mode.tsx, NewList.tsx, Optimize.tsx, Score.tsx; emoji scan now covers every non-test web/src file + scene.js (was 4 files), except the 3 ports of group.js/lists.js that carry content emoji (the old scan never read those files) |
| test_phone_pass | pins -> Store.tsx, Optimize.tsx, lists/model.ts, Lists.tsx, Quest.tsx, Today.tsx (staplesLine was already dead code on main; the pin now checks the Today line is a link, not a name dump) |
| test_phone_pass3 | server tests unchanged; client pins -> NewList.tsx, Hunt.tsx, Quest.tsx, Lists.tsx; split behaviour (old: "mac and cheese" was only a string pin) -> vitest screens/dictation.test.ts (4 tests; splitPreview exported from Lists.tsx) |
| test_photo_driver | scene.js node harness unchanged; QUEST_DRIVER (qResolveDriver, 6 checks) -> vitest hunt/driver.test.ts (3 tests; resolveDriver exported from Hunt.tsx) + a pin; wiring/labels pins -> Hunt.tsx, ui/Scene.tsx; not-precached pin -> web/src/sw.js |
| test_places | server tests unchanged; client pins -> lists/ListSheets.tsx (StorePicker x2), Store.tsx, StoresFind.tsx; TestPickerRefreshOnBack node harness (questBack, 2 tests) -> vitest screens/store.test.tsx (2 tests, mounted the way App.tsx keys screens) + 2 pin tests; qStoreAtAddress pin -> Store.tsx pickStore |
| test_points | QPTS pin -> hunt/model.ts |
| test_prices | server tests unchanged; client pins -> app/views.ts, registry.tsx, Profile.tsx, Today.tsx, Analysis.tsx, ui/Info.tsx (the INFO caveat keys moved there), Powers.tsx; #151 test_turn_on_is_a_button -> Powers.tsx data-pw-act="share" opens the share sheet; sw /powers.js pin dropped (the build is precached whole) |
| test_pwa_install | manifest/icon pins -> pwa/manifest.json (start_url and scope "/" now pinned) + web/index.html + new sw STATIC list; NEW TestServedAtRoot (3: /next/* 302, _AppFiles build-first + no-cache shell/worker, old app files gone) and TestServiceWorker (5: injectManifest at /sw.js, skipWaiting/claim/drop arya-v*, GET-only + /api/group/live + bypass + network first + offline shell, push kept, runtime files precached); keyboard map -> Hunt.tsx; TestGameLoopPrecache (old script/link order and sw list) -> TestGameLoopStyles (main.tsx import order; the build precaches every bundle); integration pins -> Express.tsx, Hunt.tsx, Mode.tsx, NewList.tsx |
| test_profile_simple | pins -> Profile.tsx, app/views.ts, QuestProgress.tsx, Muse.tsx, About.tsx |
| test_push_reminders | server tests unchanged; client pins -> web/src/sw.js (push, notificationclick), Profile.tsx (pf-reminders, serviceWorker.ready, subscribe); the /push.js precache pin dropped (push.js is ported into Profile.tsx) |
| test_qa_high | server tests unchanged; qRevive pins -> hunt/model.ts (qSetState and qCheck both revive) |
| test_qa_low | pins -> Hunt.tsx (key map, wild-find Enter, grab before start), lib/api.ts, Lists.tsx, Feedback.tsx; placeholder scan over the whole app (+ no NotPorted) |
| test_qa_med | server tests unchanged; staplesLine pin (dead code on main) -> the suggestions rule in lists/model.ts; scroll-to-top -> app/nav.tsx; CSS pin unchanged |
| test_qa_signed_in | server tests unchanged; pins -> Receipts.tsx, lib/format.ts (+ vitest format.test.ts year test), Analysis.tsx |
| test_receipt_dedupe | server tests unchanged; pins -> web/src/sw.js (GET only), Receipts.tsx |
| test_receipt_media | server tests unchanged; viewer pins -> Receipt.tsx, styles.css |
| test_share_look | server tests unchanged; client pins -> haul/Share.tsx |
| test_shares | server tests unchanged; client pins -> haul/Share.tsx, score/HaulPhoto.tsx, Score.tsx, Hunt.tsx, Profile.tsx; NOTE: test_share_at_finish_settled_or_not was indented inside the `if __name__` block, so it never ran on main (and it contradicts main, which shows Share your haul only once the receipt is attached); the dead method was removed, not ported |
| test_shelf_scan | server tests unchanged; shell pins -> hunt/Scan.tsx, Hunt.tsx, Express.tsx; TestScanLiveNode (quest.js harness, 11 checks) -> vitest hunt/scan.test.tsx (6 tests: sampler x4, pops+status copy, camera+wake lock life) + a pin that they exist |
| test_small_ux | server tests unchanged; pins -> app/session.tsx, QuestProgress.tsx; CSS pins unchanged |
| test_stores | server tests unchanged; TestStoreShell -> app/views.ts, registry.tsx, Store*.tsx, Profile.tsx, Mode.tsx; test_sw_cache_bumped -> test_pwa_install |
| test_tester_pass | server tests unchanged; prepared-cart scan over the whole app |
| test_today_clock | pins -> Today.tsx |
| test_theme | token/CSS pins -> web/src/styles (same text); forbidden-colour scan widened from 6 files to every file under web/src + web/index.html + scene.js; repflag -> Hunt.tsx + Express.tsx; receiptbtn -> Finish.tsx |

## Verification (2026-10-29, after the merge of main with #151 and #152)

- `npx tsc -b`: no errors.
- `npx vitest run`: 17 files, 152 tests, all pass.
- `npm run build`: the worker precaches 3 build entries (722.72 KiB).
- Python: `python -m unittest discover -s tests`: 1,195 tests, 2 skipped
  (the baseline), 3 errors. The 3 errors are `test_decode`
  `TestScannedPdfIntake` (no PDF renderer in this sandbox). They are the
  known sandbox baseline.
- e2e: `ARYA_URL=http://localhost:8004 node e2e/run.mjs`: 34 of 34 pass.
  `powers` now also taps "Turn on" (#151). `language` covers #152.
- Playwright switch-over checks (22, all pass):
  - `/` is the React build with `no-cache`.
  - `/next`, `/next/`, `/next/list` and `/next/list?x=1` answer 302.
  - `/sw.js` is the new worker with `no-cache`. The manifest has
    `start_url` and `scope` `/`.
  - The worker registers at scope `/`, controls the page and keeps one
    `arya-web-*` cache.
  - A POST and an API GET do not go through the worker. A shell GET
    does.
  - Today, Lists, a Trader Joe's photo-walk hunt and Settings load with
    no 404.
  - The shell opens offline.
  - An old `arya-v97` cache is deleted when the new worker activates.
- Screenshot parity against the old app (80bd79d on port 8001): 31 ok,
  3 mid-flow screens skipped (the e2e covers them), 1 over the limit:
  `newlist` (0.51%, the limit is 0.5%). Both differences are old-app
  state, not a regression:
  - The old pack card shows `basket.webp` because `qFaceFor` is not
    loaded yet. The React card shows the item face (`faceFor`).
  - The old tab bar keeps "Today" active, because `lists.js` opened the
    screen without `show()`. In React, no tab is active on a sub-screen,
    the same as every other sub-screen.
- Docker: `deploy/Dockerfile.api` builds when the sandbox proxy CA is
  added to a copy of the file (pip and npm cannot reach the registries
  through the proxy without it). The repo file is not changed. The
  image has `web/dist` (`index.html`, `sw.js`, `app/`) and the static
  folder. The container serves `/` (200, `no-cache`), `/next/list` (302
  to `/list`), `/sw.js` (200, `no-cache`) and `/scene.js` (200).

## Deploy notes

1. `docker compose up -d --build`. The api image now builds `web/`
   (node stage). There is no new secret or env.
2. The first load after the deploy installs the new worker from
   `/sw.js`. It takes control (`skipWaiting`, `clients.claim`) and
   deletes the old `arya-v*` cache. An installed phone gets it on its
   next update check. The manifest `start_url` is now `/`.
3. Caddy: the CSP is `script-src 'self'` (no hash). Reload Caddy with
   the new `Caddyfile`.
4. Demo: `python -m harness.make_demo_household <data dir>` if the data
   dir has no demo household (Today, Lists and the hunts need it).

## Risks

- `scene.js` is still a classic script in the static folder. The React
  hunt loads it at run time. It is precached in `STATIC`.
- Installed PWAs update through the same `/sw.js` URL. If a phone keeps
  the old worker for a long time, it serves the old cached shell until
  its update check. The old worker is network first, so an online load
  gets the new `index.html`.
- The remote tag `plain-js-app` (bcdfb4e, #146) is older than #151 and
  #152. For parity with the last old app, use commit 80bd79d.
- The app has no path routes. A link to `/list` (or the old
  `/next/list`) is a 404, as `/next/list` was on main. Links use the
  query or the hash.
