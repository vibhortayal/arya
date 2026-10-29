# 2026-10-29 — i18n groundwork (English only)

Owner (via coordinator): add i18next plumbing so the app can be
translated later. English only now; no translations, no visible change.

- i18next + react-i18next (pinned). `web/src/i18n/index.ts` starts it
  synchronously, English fallback; `applyLanguage()` follows settings.json
  "language" ("auto" = browser) through session.tsx.
- `web/src/i18n/en.json`: 1,621 strings, namespaced by screen. Built
  sentences are one key with interpolation and `_one`/`_other` plurals;
  markup sentences use `<Trans>`. Side effect: "1 lines" style counts now
  read "1 line".
- Guard: `web/src/i18n/i18n.test.ts` fails on JSX text of 2+ letters in
  screens/ or ui/ (allowlist: "Arya" on Login, the author name on About)
  and on t() keys missing from en.json. Rule 8 in web/PORTING.md.
- Python pins read en.json through tests/frontend.py (`src()`/`app()`
  substitute keys with their English; `words()`, `english()`, `src_raw()`).
- Left in English on purpose: date/month names (later Intl pass), hunt
  menu errors that mirror the API, lib/ strings, item/aisle data, the Muse
  setup prompt, server text and store/item names.

Checks: tsc clean; vitest 159; Python 1,195 (3 sandbox test_decode
errors); e2e 34/34; 32 views screenshot-compared at 390x844, no visible
change (only sub-pixel anti-aliasing where text nodes merged).
