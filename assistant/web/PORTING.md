# Working on the app (`web/`)

The React app (`web/`) is the only app. The API serves its build
(`web/dist`) at `/`. The port from the plain-JS app (`pwa/*.js`) is
complete. The old app stays in git history: the tag `plain-js-app`, and
commit 80bd79d (the last main commit before the switch, with #151 and
#152). The old address `/next/...` answers 302 to the same path at `/`.

The static folder `assistant/pwa/` now holds only the files that the app
loads at run time: images (`/assets`), store models (`/models`),
three.js (`/vendor`), `scene.js`, the manifest and the icons. The API
serves it at `/` beside the build. The build wins on a name clash.

## Rules

1. **Same look.** The screens use the old class names and ids, and the
   old stylesheets (now `src/styles/*.css`) apply as they are. A screen
   whose design changes needs an approved wireframe first.
2. **One screen per file** in `src/screens/<Name>.tsx`. Add it to
   `SCREENS` in `src/screens/registry.tsx` and its id to `VIEWS` in
   `src/app/views.ts`. The type checker stops a view with no screen.
3. **Shared pieces live in `src/ui`** (kit, Sheet, Toast, Info, Scene,
   icons) and `src/lib` (api, format, stores, language). Add to them;
   do not copy them.
4. **Navigation** goes through `useNav()`: `show`, `replace`, `back`,
   `reset`, and `setChrome(false)` for full-screen modes. Back is a
   stack. Session data (user, demo, currency, language) comes from
   `useSession()`.
5. **Pure logic is exported and tested.** Put a rule that a test must
   run in a function that the screen exports (for example
   `storeAlerts` in `Today.tsx`, `resolveDriver` in `Hunt.tsx`). Test it
   with vitest beside the code (`*.test.ts` or `*.test.tsx`).
6. **No cache name to bump.** The service worker (`src/sw.js`, built to
   `/sw.js`) precaches the build with hashed file names. When the app
   loads a new file from the static folder at run time, add it to
   `STATIC` in `src/sw.js`.
7. **No inline script** in `index.html`: the CSP allows script files
   only (`tests/test_csp.py`).
8. **No literal English in components; use t('key') and add the string
   to en.json.** Strings live in `src/i18n/en.json`, keyed by screen
   (`today.*`, `lists.*`, `quest.*`, `hunt.*`, `settings.*`, ...) with
   shared words under `common.*`. In a component, call
   `const { t } = useTranslation()` (import it from `src/i18n`); in a
   helper outside a component, import `t` from `src/i18n`. Build
   sentences with interpolation (`t("x", { name })`) and plurals
   (`t("x", { count })` with `x_one` / `x_other` keys), never by
   joining pieces; use `<Trans>` when a sentence holds markup. Server
   text, user data, and store or item names are not keys.
   `src/i18n/i18n.test.ts` fails on JSX text with two or more letters
   under `src/screens` or `src/ui`, and on a literal key missing from
   en.json. Its `ALLOWED` list (a brand or a name) stays small.

## Coach-mark tours (`src/ui/Tour.tsx`)

Any screen can run a tour over any part of the page:

```ts
const { startTour } = useTour();
startTour(steps, { onDone, onSkip });
```

A step is data: `{ id, target, titleKey, bodyKey, onEnter?, placement? }`.
`target` is a CSS selector or a function that returns the element.
`titleKey` and `bodyKey` are en.json keys. `onEnter` runs before the
target is measured (for example `nav.show(view)`); the tour waits up to
a second for the target to appear. `placement` is `"above"`, `"below"`
or `"auto"` (the side with more room). The tour scrolls the target into
view and follows resize and scroll. Esc and Skip call `onSkip`; Done on
the last step calls `onDone`. Keep a tour's steps in one file, as
`src/onboarding/firstRunTour.ts` does for the first-run tour. A step
can also carry `more: { labelKey, onClick }`: a link under the line
that ends the tour as Done does, then runs `onClick`.

## The Arya guide (`src/ui/Guide.tsx`)

`useGuide().open(id?)` opens the full-screen guide, at a card id from
`src/guide/cards.ts` (the cards are data there; their text is in
en.json under `guide.*`). Code outside React calls `openGuide(id)`.
Try it (`src/ui/GuideTry.tsx`) runs on the sample data in `cards.ts`
only: it never calls the server.

## Checks for every change

```sh
# API on :8000 (serves the build at /)
npx tsc -b && npx vitest run              # types + unit tests
npm run build
npm run e2e -- <view>                     # e2e/<view>.e2e.mjs: the screen's main taps work
cd .. && python -m unittest discover -s tests   # the string pins read web/src
```

The Python string pins read the source through `tests/frontend.py`
(`src("screens/Hunt.tsx")`, `read("styles.css")`). When you rename a
function or an id that a pin names, change the pin in the same commit.

## Screenshot parity against the old app

`npm run parity` compares a screen with the same screen in the old app.
Run the old app's API (commit 80bd79d) on another port and point
`PARITY_OLD_URL` at it:

```sh
git worktree add /tmp/arya-old 80bd79d
(cd /tmp/arya-old/assistant && python -m harness.make_demo_household /tmp/arya-old-data \
  && ARYA_DATA_DIR=/tmp/arya-old-data uvicorn api.main:app --port 8001)
npm run build && PARITY_OLD_URL=http://localhost:8001 npm run parity -- home list
```

Give the old server an account too (as on the new one), or the old
Login opens its first-run sheet. `parity-out/` holds `<view>-old.png`,
`-new.png` and `-diff.png`. Review the diff, not only the number.
