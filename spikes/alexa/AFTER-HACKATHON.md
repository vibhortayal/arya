# After the hackathon: how we continue

Hackathon submission is Nov 4, 9PM ET. Nothing below ships before the code and deploy freezes lift. Alexa stays hidden and undocumented until the owner says it works.

## Alexa, in order
1. **Real-device test.** Set the VM env (see `BUILD-LOG.md`), recreate the API, enable the skill in the Alexa app (More > Skills & Games > Your Skills > Dev), link the account, and run the four checks in `CONSOLE-STEPS.md` step 7. Include a misheard name and a Spark failure.
2. **Wording check.** Listen to the replies on a real device. Check "Added X to Y", "Sent to Arya", and the error and unlinked responses. Test the invocation name with several voices; switch to "arya shopper" if "my arya" is unreliable.
3. **Fix what the test finds,** then re-run the Tester pass on the From Alexa card (Right, Fix, Undo, 7-day clearing, Customize toggle).
4. **Document Alexa once it works.** Only then update Help, guide cards, Ask Arya knowledge (`prompts/arya_features.md`), STATUS and the feature docs in the same PR, and send reader-facing docs through the Editor.
5. **Flag-on rollout.** Set `ARYA_ALEXA=1` in production, watch `/health`, Spark spend and the review queue for a week, and keep the rollback line: if `/health` is down for 10 minutes, roll back. Decide whether to submit the skill for certification so other users can enable it.
6. **Optional:** a flagged "Paste from Alexa" import, reusing the unclear-add fixing (see `ALEXA-LISTS-SYNC-DESIGN.md`, option D). Revisit native list access only if Amazon announces it.

## List import, in the order from `LIST-IMPORT-DESIGN.md`
1. **Shared pipeline.** One adapter interface, the shared fixing pipeline and an import ledger (about 1.5 days). Generalize the "From Alexa" card into "Needs a look" per source (UI/UX mockup first).
2. **No-API fallbacks first** (about 2 days plus mockup and Tester): paste (already built), file upload (CSV, text, JSON), iOS Shortcut POST for Apple Reminders, email-in. Skip the share sheet on iPhone.
3. **Todoist connector** (about 3 days), the only OAuth connector recommended, and only after Nov 4.
4. **Later, only if asked:** Google Tasks and Microsoft To Do (about 3 days each, with provider verification waits).
5. **Never:** unofficial connectors (Bring, AnyList, Alexa cookies). They break terms and mean storing passwords.

Call it "import", not "sync", on anything user-facing.

## Open owner decisions (from the list-import design)
- Approve the order above.
- Is the iOS Shortcut route acceptable for Apple Reminders?
- Any OAuth connector beyond Todoist?
- Confirm generalizing the From Alexa card.
