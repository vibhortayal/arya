# Glossary

The words Arya uses, in plain terms. Names in quotes are the exact words on screen.

## In the app

- **Today**: the first tab. What is running low, store alerts and what to use soon. You can change what it shows with Customize your "Today" screen.
- **Navigation tab**: the row of tabs at the bottom of the phone: Today, Spending, Quest, Ask and More. "Customize navigation tab" changes which ones sit there.
- **Lists**: under More, one card per store list, with suggestions underneath. Every item belongs to a list.
- **Suggestions**: items Arya thinks you may need, each with a reason. Arya never adds to a list by itself; you tap Add.
- **Running low**: staples that are due again, worked out from how often you buy them.
- **Use soon**: food you bought that should be eaten soon. "Used it" moves an item back to Suggestions.
- **Ask Arya**: the chat, on the tab named "Ask". Ask how to do something in Arya, or about your lists and spending.
- **Help tab**: the ask box, first steps, a how-to topic for each feature, and links to the Arya guide, Arya's powers, the Tour and Send feedback.
- **Arya guide**: the swipeable cards that explain each feature.
- **Tour**: the first-run walk-through, shown as bubbles over a dark screen.
- **Quest**: the optional game. It turns a shopping trip into a hunt through a model of your store and ends on a photo of your receipt. It has no clock and no way to lose.
- **Use Arya in Muse**: the Settings, About Arya row that connects the Muse assistant to your Arya account through the MCP connector.
- **Demo Town**: the simulated neighborhood of invented stores the demo household shops in. It is labelled as simulated.

## How it works

- **Model proposes, code checks**: a model reads the receipt; plain code then checks every line against the printed total before anything posts.
- **Staple judge**: decides whether an item is a staple you buy again and again. Muse Spark is the main seat and Muse Spark Open a second seat.
- **Curator**: proposes product merges and splits for you to apply.
- **Crowd map**: the aisle layout built from shoppers' own store scans.
- **MCP connector**: lets an AI assistant add items and read lists through Arya's MCP endpoint.
- **Lists API**: a small bearer-token API to read and write your lists from a script. See the API reference.
- **PWA**: a web app you add to your phone's home screen. Arya is a PWA only.

## The Meta models

Model ids, jobs and measured numbers live in [the model map on the judges page](../JUDGES.md#which-model-does-which-job); this list only says the words.

- **Muse Spark**: reads receipt photos first, and also runs the staple judge, the Curator, Ask Arya and photo reading. Arya uses the Standard tier.
- **Muse Wonder**: re-reads a receipt only when the arithmetic checks flag it, or when Spark fails.
- **SAM 3.1**: finds shelves and signs in a store scan, boxes items for Find it for me and pixelates the people it detects.
- **Muse Voice Transcribe**: turns speech into text for the list mic and Ask Arya.
- **Muse Image**: made the grab-celebration characters in Quest, once.
- **Muse Spark Open**: the open-weights model, hosted on Baseten. It is the second seat of the staple judge and sees item names only (no prices, dates, stores or account details).
- **Meta Model API**: the one client every server call goes through, with a daily spend ceiling.

## Not live

Community prices, Deals and Arya shoppers (seeing other shoppers nearby) are not live. Muse Glimmer is not used. Muse Code, running Muse Wonder, wrote the first version of the engine; it is not part of the shipped app.
