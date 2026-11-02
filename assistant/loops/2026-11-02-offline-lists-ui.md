# 2026-11-02 Offline lists UI

The owner approved the offline lists mockup (claude.ai/artifact/KDHn88Jb5t5EsMhPZB4GoR). The backend (#412: queue, applyQueued, and the Synced/skipped/failed toasts) is on main.

- app/listSync.tsx adds QueueNote, the yellow note on Lists and on a list page. It shows one of three messages: offline, N changes waiting to sync, or Syncing N changes. The demo never shows it.
- It also adds useWaitingIds, which reads lib/listQueue pendingIds(). Every item named by a waiting change shows "⏳ Waiting to sync".
- Help (lists n3) and Ask (offline section) describe the note and the tag.
- Tests: app/queuenote.test.tsx.
