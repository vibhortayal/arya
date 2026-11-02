# 2026-11-02 Receipt reading: one file in the background too, plus a clear bar on screen

**Ask (owner, 2026-11-01 23:45Z):** "design is a go". The approved mockup is /mnt/project-files/arya-receipt-progress/, states a to e. He added that the demo should say to stay on the screen, because demo receipts aren't stored, while your own account reads in the background. He also asked for a UI pass on the whole flow.

**Changes**
- Signed in, a single file now goes through the same background batch as several files: Sending your receipt, then Reading your receipt in the background. Before, one file was read on the screen. `ReceiptJobCard` uses singular wording when the batch has one file.
- On-screen reading (the demo, or when a batch can't be opened):
  - Add receipts turns into a greyed "Reading…" while it works.
  - A progress block shows "Reading the receipt…" with a sliding bar and "Usually 10 to 30 seconds, up to a minute. Stay on this screen."
  - With several files it shows "Reading receipt 2 of 5" with a filling bar, the file name, and how many are filed so far.
  - In the demo, a note explains why to stay.
- Afterwards: "Read 3 of 5 receipts · 2 could not be read" with each file's reason, then **Try again**, which reads only the failed and not-tried files, and Dismiss. A new pick clears the last preview.
- The common "Reading the receipt…" line, also used by the after-trip sheet, Lists and Finish, now says to stay on the screen.
- Help: receipt step s2. Ask: the receipts lines.

**Tests:** receiptjobs.test (one file goes to a batch) and bulkreceipts.test (Read 3 of 5, Try again reads only the 2 that failed). Web: 483 tests pass. Python: 0 failures. Checked at 360x640 and 390x844 with a slowed decode.
