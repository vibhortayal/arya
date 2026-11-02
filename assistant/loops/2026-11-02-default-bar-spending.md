# 2026-11-02 Default bar: Today, Spending, Quest, Ask, More

Owner asked for Spending in place of Lists on the default bar (Today already shows the list; better for the demo), and for Lists to show only the lists. Mockup approved 00:29Z (claude.ai/artifact/RtJ7LeuEZUmqiXA2ouTLdM).

- lib/bar.ts and api/chat_service.py: DEFAULT_BAR = home, analysis, community, chat. Receipts and Stores light Spending.
- Lists: the Stores, Receipts and Spending rows are gone. Spending: Receipts and Stores rows at the top (#an-places); no Back when Spending is a bar tab.
- Tour: Today's line says the lists are in More; Spending's line names Receipts and Stores; demo Tour gets two Spending stops.
- Help, Arya guide and Ask knowledge name the new places.
- Saved bars are untouched; only the default changes.
