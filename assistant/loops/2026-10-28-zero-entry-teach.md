# Zero-entry Teach (2026-10-28)

Owner verdict: Teach was data-entry heavy; nobody enters data.
Built: POST /api/storemap/teach (scrub -> section read -> find-or-
create both-sides segment -> ingest -> sightings -> reward),
api/mapread.py (Spark Standard read of the SCRUBBED frame only),
POST /api/storemap/discard (retract own fresh sections only),
mapper leads with "Walk your store", confirm card with one-tap
removal, manual aisle form demoted to a Fine-tune disclosure.
SW arya-v52. Tests: tests/test_teach.py (11).
