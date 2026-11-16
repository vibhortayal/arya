# 2026-11-16 Done shopping, step by step

**Ask (owner, 2026-11-16, iPhone test on the Trader Joe list):** ticking items without a trip was confusing ("Nothing to get", a receipt banner, "checked off · Clear"); the clear sheet came up before the camera; after the photo the app showed "photo too large", "could not read the date" and "stay on this screen"; and "This looks like a receipt. Add it as a receipt" appeared when he was already adding a receipt. He wants the app to use the trip: match the receipt to his list, with his item names, and say something only when a list item is missing or the receipt has an extra.

**Changes**
- Done shopping is now in steps: Add your receipt opens the camera and nothing else. The trip ends when the photo is chosen. The clear question comes after the receipt is filed (Skip the receipt still goes straight to it).
- The photo goes to the background receipt reader (`/api/receipts/jobs`) with the list's item names, so the person can leave the screen. The demo reads on screen, as before. The "is this a receipt?" step and the "Add it as a receipt" button are gone; a receipt seen by the add-bar camera is read in the background at once.
- `api/tripcheck.py` matches the receipt lines to the list with the hunt's own matcher (`haul.match`) plus one lenient pass for names with extra words ("Eggs - Pasture Raised" and "EGGS LARGE BROWN ORGANIC"). A full match shows one line; only a missing list item or an extra receipt line is named.
- A receipt with no readable date is filed under today's date and marked `date_assumed`. A picture with no purchase lines fails with "This doesn't look like a receipt. It may be the wrong picture." (job path).
- Ticking without a trip: the header reads "N ticked off, M to get" or "All N ticked off" (not "Nothing to get"); the card says "ticked off" and Clear ticked.
- Help (Add an item to a list, note 4) and the Ask feature sheet updated.

**Not done:** the date-assumed receipt has no edit-date control yet; push notifications when a receipt finishes (the result shows on the list and on the Receipts card). The real model was not run in this session (no key): the Trader Joe receipt photo is saved at /mnt/project-files/arya-trip-receipt/ for a live check.
