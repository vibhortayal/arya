# 2026-11-02 "Edit Today" left over after #446

Owner phone check on live f379690: Today still said "Edit Today". #446
renamed the Help, guide and Ask topics to Customize your "Today" screen
but missed the app strings themselves (today.edit.title, editToday,
menu.edit, Tour today_edit and today_tab). Fixed: header button reads
"Customize" (the full phrase does not fit beside "Today" at 390 px and
clipped), edit-mode title, card menu and Tour use the full phrase. Help
and Ask say "tap Customize on Today" (they said "tap Edit" while the
button read "Edit Today"). Lesson: a rename PR greps every user string,
not just the docs topics.
