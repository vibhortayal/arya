# 2026-11-03 Shared "Not here" reports

Owner: "fix the store reports for sharing", then "build it" on SHARED-NOT-HERE-DESIGN.md, plus: news only for items on my list, no spam, quorum of 3. Fable design review must-fixes folded in.

- `api/shared_reports.py`: root-plane `store_reports.json`, keyed by store family (else normalized name) and item match key (normalized name, plural last word made singular). An entry is {store_key, item_key, kind, at, by}; `by` is an 8-hex account hash that never leaves the server. Lock and every load/save run with the user context cleared (storemap pattern). 3-day expiry; one open entry per account per store and item; 30 a day per account; 500 per store.
- Quorum: `ARYA_REPORT_QUORUM` (default 3) distinct accounts with a fresh entry before anyone else sees it.
- Writes: Not here adds; take-back removes the account's entry; a check-off (no substitute) or a scan sighting clears the item for everyone.
- Reads: `store_reports` (hunt stop flags, New list) and `store_news` (Today alerts) show other shoppers' groups only for items on the viewer's list, in the viewer's own words. News also needs a store the viewer uses (My stores or a list's stores), folds into "N shoppers say not here", never alerts on the viewer's own reports, shows for 12 hours, then waits for a newer report. Feed only.
- Demo: writes land in the sandbox overlay; tests check a demo report and a demo find change nothing on disk.
- Text: Help news note, guide news card, Ask knowledge line, privacy page paragraph, Today alert count string.
- Tests: tests/test_shared_reports.py (21). Old own-report news tests updated.
