# 2026-10-28 Supabase storage seam (stage 1)

Changed: api/pgstore.py (Postgres document backend, arya.user_docs in
the team's Supabase project), state._load/_save and auth._load/_save route through it
by ARYA_STORE (json default | dual | pg), tools/migrate_json_to_pg.py,
tests/test_pgstore_seam.py, compose and .env.example.
Models run: none. Cost: $0.
Next: owner sets arya_app password and DATABASE_URL on the VM; run dual,
migrate, compare, then pg. Real community tables (stage 2) after Nov 4.
