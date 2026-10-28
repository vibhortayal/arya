# The pitch — Arya (Team Nightshift, Indie track)

Spoken pitch, plain language. ~320 words, about 2 minutes. Screen beats in brackets.

## Hook

"Every week, you walk into a grocery store that knows nothing about you. Your list is half in your head. Google Maps stops at the door — inside, you're on your own."

## Problem

"List apps start blank. They don't know what you buy, what you returned, or where anything is. Stores like Trader Joe's publish no layout data at all, so no app can help you inside them. Same slow trip, every week."

## Solution

"To fix that, someone has to map these stores and track what's on their shelves. That data doesn't exist. Stores won't give it out. Paying people to scan shelves has been tried — those apps shut down.

So it has to come from shoppers. People won't do that work for free — they'll do it if it's fun.

So we made shopping a game. Your list becomes a treasure hunt in your real store — you walk it in photos of the actual aisles, with a 3D model one tap away. Kids who hate the grocery trip fight to hold the phone. Every hunt checks the shelves, reports what's missing, and ends with a photo of the receipt. The receipt is the proof, and the score."

## Demo

"This is Arya. The list doesn't start blank. Arya learned what your house buys from your receipts, and it reminds you what's about to run out — raspberries, mandarins, almonds. Add items any way you like: a photo of a note, your voice, typing, or a chat with Muse. **Muse Spark** reads it. If something is unclear, Arya asks instead of guessing.

This Trader Joe's was rebuilt in 3D from a walkthrough video — any shopper can map a store that way. **SAM 3.1** found the shelves, **Spark** labeled them: cheese, pasta, pasta sauce, in walking order.

Now the hunt. My kid holds the phone and collects each item where it sits. Lose your place? Take one photo of the shelf — Arya places you at the right stop. Tap 'not here' and you've reported a stockout.

And if your store has no map yet, nothing stops: the camera watches the shelf as you shop, and when it spots something on your list, the item pops up on screen, ready to grab.

At the end, photograph the receipt. Muse Wonder reads it — on our test set it read every price right. Arya checks every line against the total, and anything you returned comes off your list for good. That receipt teaches Arya too — next week's list is already half written."

## Meta fit

"Meta's models do the work: Spark reads and reasons, **Muse Voice Transcribe** takes dictation, SAM 3.1 sees the shelves, **VGGT** builds the 3D store. Wonder reads the receipt photos — and it wrote the code that places you in the aisle. **Muse Image** paints the characters that cheer each collect. And stores get mapped by the people who shop in them — the way open-source software gets built by its users."

## Future + close

"Next: whole-store maps, open sign-ups, and the same shelf eyes on Ray-Ban glasses.

We're Team Nightshift. This is Arya — grocery shopping, as a game. We're ready for your questions."

---

## Delivery notes

- Demo account on a phone. The Trader Joe's hunt starts in the photo view and can switch to the 3D view or drop to the flat view live — say so if it happens.
- Build the demo hunt list from what the mapped stretch actually contains (cheese, oils, pasta, sauce, peanut butter, bread, frozen pizza) so each stop's shelf label agrees with the item.
- Keep one receipt already read as the fallback for the finish beat; a live photo read takes up to a minute on Wonder, and the app says so while it works.
- Numbers, if asked: 114 real receipts behind the brain; 373,630 points in the shipped store model; 40 named shelf regions of 55 found by SAM; the staple judge's precision is 0.79 against purchase cadence on those 114 receipts; receipt photo decode scores 98.98% identity+price (Wonder, Gate 0 public set) against Spark's 93.88%; the localizer placed 42 of 45 held-out photos at the right stop, the rest one stop over.
