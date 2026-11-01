# 2026-11-01 — Re-audit fixes: smaller first visit

Owner's Oct 31 re-audit, items #13, #21, #24, #25 (#16 left, see below).
No model calls, $0.

## What changed
- #13: the vendored three.js r160 (`pwa/vendor/three.module.js`, 670 KB)
  is gone. `scene.js` gets three.js from the build (`window.__aryaThree`,
  set by `ui/Scene.tsx` to `import("three")`, the chunk the Quest world
  already uses). scene.js uses only stable classes (Scene, Points,
  BufferGeometry, Raycaster, Sprite...), unchanged r160 to r186.
- #24: the service worker no longer precaches three r160, the 512 px
  icons or the four scene pictures (about 1.85 MB less on a first
  visit). The small icons, scene.js, boot.js and the character art stay.
- #21: pictures under `/assets/` answer from the cache at once and
  refresh behind (stale-while-revalidate), so a redrawn picture shows
  on the next view.
- #25: icons through pngquant (quality 85-98): icon-512 274 KB to
  127 KB, maskable-512 194 KB to 93 KB, apple-touch 38 KB to 16 KB,
  icon-192 43 KB to 18 KB. Compared at 2x zoom: no visible change. A
  harder squeeze (40 KB) showed banding in the cart's shadow, so no.

## Not changed
- #16 (split the CSS per screen, lazy i18n namespaces): about 7 KB gzip
  of CSS and 10 KB of strings. The four stylesheets share class names
  with other screens, and lazy strings can flash keys; the files are
  cached after the first visit. Not worth the risk before Nov 4.

## Checks
`tests.test_pwa_install`, `test_static_cache`, `test_motion_nav`,
`test_photo_driver` green; `tsc -b`, `vite build` ok.
