# 2026-11-01 Group invites: single use, link survives sign-in, one group, removed notice

From the owner's group test (approved "do all").

- Codes work for one person: joining clears the group's code; the next person gets a new one. Join answers 410 for a used or an expired code (each says which) and 404 for a wrong one. Public preview GET /auth/group-invite/{code} → {group_name, inviter_handle, member_count, status: ok|used|expired} for the invite page before sign-in.
- An invite link keeps its code on the phone for two days (`stashJoinCode`), so it survives signing in and opens Join with the group's name (the existing confirm) after sign-in. The share text tells people they can also enter the code in Arya (iPhone links open in Safari, not the Home Screen app).
- Already in a group: preview and join answer 409 "You're already in X. Arya has one group per person: leave it first (Settings, Group, Leave group), then use the code." The Join screen shows it.
- Removing a member: the confirm's cancel reads "No, keep"; the removed person sees "You were removed from X" once (server note kept a week, cleared on joining a group).
- Help topic, guide card and Ask knowledge updated.

Tests: test_groups (updated + new). Python suite same failures as main; web 481 pass.
