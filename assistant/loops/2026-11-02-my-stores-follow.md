# 2026-11-02 My stores follows where you shop

Owner, 2026-11-02 report: stores he shops at were missing from My stores. The cause was in the code. My stores held only stores added by hand: Places pick, Find a store Add, or a new store. Linking a store to a list did not add it, and `resolve_merchants` deliberately put receipt stores in the directory only. In a group, lists are shared but My stores is personal.

- `api/stores.follow(ids)`: adds directory stores to My stores, skipping unknown ids and stores the shopper removed. It does nothing in the demo sandbox and never raises.
- `remove_from_mine` now remembers removed ids (`my_stores.json` `removed`, the last 500). Adding a store by hand (`add_to_mine`) clears that, so it can be followed again.
- Lists: `/api/lists` create and `/api/lists/update` follow the list's `store_ids`. The store joins the My stores of the person who linked it.
- Receipts: `resolve_merchants` follows the stores it places through Places. It also follows merchants that already match a directory store, including when Places is not set up.
- Backfill: the first `GET /api/stores/mine` after deploy follows every list's `store_ids` and the stores the account's own receipts name (directory matches only, no Places calls). It then sets `backfilled`, so it runs once. Removed stores stay out.

Tests: `tests/test_my_stores_follow.py` covers:
- list create and edit;
- removed never re-added, and a hand add brings a store back;
- unknown ids;
- a receipt store;
- a removed receipt store;
- a one-time backfill that keeps removals;
- favorites kept.
