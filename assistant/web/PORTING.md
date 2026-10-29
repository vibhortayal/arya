# Porting a screen to the React app

The React app (`web/`) is a straight port of the current PWA (`pwa/`).
It is served at `/next/` next to the current app at `/` until the
switch-over. The two apps share one API, one set of images (`/assets`,
`/models`, `/vendor`) and one set of stylesheets: `src/main.tsx` imports
`pwa/*.css` unchanged.

## Rules

1. **Same look.** Use the old markup's class names and ids, so the old
   CSS applies as is. A straight port needs no wireframe, but it must
   pass screenshot parity. A screen whose design *changes* still needs
   an approved wireframe first.
2. **One screen per file** in `src/screens/<Name>.tsx`. Register it with
   one line in `PORTED` in `src/screens/registry.tsx`.
3. **Shared pieces live in `src/ui`** (kit, Sheet, Toast, icons) and
   `src/lib` (api, format). Add to them instead of copying.
4. **Navigation** goes through `useNav()`: `show`, `replace`, `back`, and
   `setChrome(false)` for full-screen modes. Session data (user, demo,
   currency) comes from `useSession()`.
5. **Do not touch `pwa/`** while porting. The old app stays the live
   app until the switch-over.

## Checks for every screen

```sh
# API on :8000 (serves / and /next/)
npm run typecheck && npm test           # types + unit tests (vitest)
npm run build
npm run parity -- <view>                 # old vs new at 390x844, <= 0.5% pixels differ
npm run e2e -- <view>                    # e2e/<view>.e2e.mjs: the screen's main taps work
```

`parity-out/` holds `<view>-old.png`, `-new.png` and `-diff.png`. Review
the diff, not just the number.

## Switch-over (later, owner's call)

When every screen is ported, mount `web/dist` at `/`, register the
service worker in `main.tsx`, and retire `pwa/*.js`.
