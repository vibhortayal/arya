# After the hackathon: roadmap and to-do

What is not finished, said plainly. Nothing here is promised for the
submission; each item is built in the code or planned, as noted.

## Use your own Meta key (bring your own key): built, switched off
- **State.** The code is on `main`: a Settings row, a Help topic, an Ask
  answer, and an "I have my own Meta key" sign-up door. All of it stays hidden
  because it needs a key vault secret (`ARYA_KEY_VAULT_SECRET`) that the live
  app does not have. With no secret nothing is stored and nobody sees it.
- **Why it is off.** There was not enough time during the hackathon to finish
  and test it, and the owner is still working out how it should work.
- **To do.** Decide the account model (shared account with an optional key, or
  key-only accounts), finish the Tester's pass, set the secret, and turn on the
  guide card. Operator notes are in `assistant/docs/OPS.md`, "Own Meta keys".
- **For someone running Arya themselves,** the key that matters today is
  `MODEL_API_KEY` (see "Run it yourself" in the README). That is a server key,
  not this feature.

## Other planned work
- Item and store profile pages.
- Off-site backups with rclone to an object-storage bucket
  (`ARYA_BACKUP_REMOTE` exists; the bucket is not set up).
- A staging address, so a deploy can be checked before the live one.
- Security review items that were deferred (tracked as GitHub issues).
- Cost proposals from the cost watcher (tracked as GitHub issues).
- A non-English Ask currently sends the whole feature guide (about 19 KB) on
  each question; trimming that is planned.
- A community tier with user opt-in is only an idea and is not built
  (`assistant/docs/MODEL-POLICY.md`).
- A replay mode (recorded answers, so the AI parts work without a key) is
  planned, not built.
- The licence is undecided; the repository is all rights reserved for now
  (`LICENSE`).
