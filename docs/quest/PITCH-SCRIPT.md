# The pitch — Arya (Team Nightshift, Indie track)

Spoken pitch, plain language. About 330 words, about 2 minutes. List first;
Quest is the optional fun part. Screen beats in brackets. The 3-minute
video follows the same order (beats in `SUBMISSION.md`).

## Hook

"Every week your list app starts blank. It doesn't know what you buy, what you returned, or where you buy it. Your receipts know all of that, and nobody reads them."

## Problem

"So the list lives half in your head. You forget the milk, you buy the yogurt you still have, and the trip takes longer than it should. Same thing, every week."

## Solution

"Arya is a grocery list that learns from your receipts. It reads every receipt, checks each line against the printed total, nets out returns, and learns what your household buys, how often, and at which store. Then the list mostly writes itself."

## Demo

"[Receipt] I snap this week's receipt. **Muse Spark** reads it, and Arya checks that every line adds up to the total. If the check fails, or Spark is unsure, **Muse Wonder** reads it again. On our 98-line test set, Wonder made zero price errors. Nothing posts silently: the doubtful lines wait for me to check.

[Today] Here's Today. Arya says the milk and the sourdough are running low, and why: about every seven days, last bought ten days ago. A **Muse Spark** judge decides what may be suggested, and **Muse Spark Open** double-checks it from the item names alone.

[Lists] One list per store. I add items any way I like: I say it (**Muse Voice Transcribe**), or I snap a handwritten note (**Spark** vision).

[Ask] I tell Ask Arya, 'We finished the Greek yogurt.' It goes on the list. 'What did we spend on coffee?' The answer comes from my receipts, not from a guess.

[Quest] And if you want the trip itself to be fun, tap Start shopping. Quest turns the list into a hunt through your store. If you can't find something, **SAM 3.1** and **Spark** find it on the shelf for you. Shoppers can map their store with a guided scan, and SAM blurs every person first. At the checkout, the receipt photo finishes the trip and teaches Arya for next week."

## Meta fit

"Meta's models do the reading and the talking: Spark for receipts, lists, labels and chat, Wonder as the careful second reader for receipts, Spark Open as a second judge, Voice Transcribe for dictation, SAM 3.1 for shelves and privacy, and Muse Image for the characters and share cards. The math is plain code. The model never calculates."

## Future + close

"Next: open sign-ups, prices shared by Arya shoppers, and whole-store maps.

We're Team Nightshift. This is Arya, the grocery list that learns. Try it now at arya.teamnightshift.org."

---

## Delivery notes

- Use the demo household on a phone (fictional, no account). For the receipt beat, use one real receipt, and keep one receipt already read as the fallback; a Spark read takes about 10 seconds, and a Wonder re-read up to a minute; the app says so while it works.
- No store ships pre-mapped, so the quest plays a labelled typical layout. Show Find it for me on a real shelf or a shelf photo.
- Numbers, if asked: 114 real receipts behind the brain; the staple judge's precision is 0.79 against purchase cadence on those 114 receipts; receipt photo decode scores 98.98% identity+price (Wonder alone, Gate 0 public set) against Spark's 93.88%; the Spark-first reader with Wonder as backup is not yet measured.
