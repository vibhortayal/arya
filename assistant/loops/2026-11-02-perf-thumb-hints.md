# 2026-11-02 Two small speed fixes (performance report, findings 3 and 7)

Owner "yes" on /mnt/project-files/arya-researcher/PERFORMANCE-REPORT-2026-11-02.md, items 3 and 7. Neither changes the data path or the layout.

- **Finding 3:** `pwa/assets/scenes/storefront-thumb.webp` is 198x132 and 1.9 KB, made from the 1920x1280, 84 KB `storefront.webp` with Pillow at WebP quality 80. It serves the 44 px Quest row on Today (`.rowimg`) and the 40 px Quest choice on a list's Start shopping sheet (`.rowface`), which is enough for a 3x screen. Mapper and the Quest hub keep the big file.
- **Finding 7:** with Demo Town off, `GET /api/town/hints` answers `null` (200) for the demo account instead of a 404. The client (`lib/town.ts`) takes null as "town off" and stops asking. A real account still gets 404, and the director and report routes still 404 when the town is off.

Tests:
- `test_fun_pass` (rows use the thumbnail, which is at most 200 px and under 8 KB; Mapper keeps the big one);
- `test_demo_town` (flag off gives null for the demo hints and 404 for director);
- `web/src/lib/town.test.ts` (null asks once and stops).
