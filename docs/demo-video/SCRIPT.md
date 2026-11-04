# Arya demo video script

Status: locked by the owner on 2026-11-04 (version 9.1). Spoken text is the owner's, verbatim. The runbook with the beats, timings and fallbacks is `assistant/docs/DEMO.md`.

Groceries are an integral part of our lives. Hunters and gatherers did it to survive. Think about what it takes today. You have many lists in your notes, your partner adds items over text while they are shopping at a different store. Both of you bought yogurt, and neither bought the toilet paper that ran out. Oh, the store shelf for the milk your kids need is empty. And the receipts end up in the trash, so you never see how the money was spent, or that the same item was cheaper at another store. That cheese you bought a few weeks ago went bad before anyone used it. You hold all of it in your head, and it's still never quite right.

I built Arya for this hackathon to manage groceries in one place — shared lists, guided store routes, spend and usage insights, and community powered alerts. The idea is simple, when shoppers share what they learn — where items are located, what's cheaper, what's out of stock — every trip gets a little easier.

Arya is not just a chatbot on a grocery list. Using Muse Wonder, I created Arya's learning engine to understand my household usage from my Costco receipts.

Arya showed me patterns in my shopping: Egg whites in 35 of 114 trips, spinach prices up by 18% since June and the same bag of almond flour: $13.59 at one Costco, $16.99 at another.

Arya also drafts my next list based on what we use. I can add items by typing, speaking, or taking a photo of a handwritten list. And it makes the chore more fun with Quest mode, which turns shopping into a game.

Before heading out for my quest, Arya warns me that eggs are out of stock.

In the store, it guides me aisle by aisle. If I need help spotting an item, I can use Arya to point the camera at a shelf: SAM finds the item, Spark points me to it and I move forward with my quest. If an item is out of stock, I tap "Not here", and the next shopper knows. At checkout I snap the receipt. Spark reads it, and if needed, Muse Wonder takes a second look. And the learning engine improves with every trip.

Back home, Arya tells me that the milk is about to go bad. And I just finished the yogurt, so I tell Arya we're out, and it's on the list automagically.

Arya is soft launched — the demo is open to everyone, but accounts are invite-only for beta testers. I also integrated Meta Muse AI agent over MCP to talk to Arya. A developer portal is live for API integrations. During the hackathon, I built the first step. Arya gets wiser with every shared list, every receipt, every "not here" tap. Humans helping humans. This is Arya.

Stack card (3 s): Built on Meta models — Muse Spark 1.3 · Muse Wonder 1.0 · SAM 3.1 · Muse Voice Transcribe · Muse Image · Muse Spark Open (open weights) · via the Meta Model API

End card (3 s): Arya · Team Nightshift · arya.teamnightshift.org · Try the demo, no sign-up · Join the waitlist · Animations: Meta AI Vibes
