# The agent connector (MCP)

Arya does not compete with the list apps and notes you already use.
It collects from them. The collection point is your own assistant:
any MCP-capable agent connects to Arya once, with your account token,
and from then on anything you capture anywhere — a note, a reminder,
a chat message, an email receipt — can become part of your Arya list,
and your assistant can answer from Arya's model instead of a stale
note.

Arya's list is the shared list: the one place the pattern engine can
compute on. Other apps are doors in and mirrors out, never a second
source of truth.

## Connect

1. In Arya, open Profile → Connect your agent and create your connector
   token. It is shown once. (The screen is named for the showcased
   client; the token works with any MCP client.)
2. Add Arya as a remote MCP server in your assistant:

   - URL: `https://arya-pilot.duckdns.org/api/mcp`
   - Transport: streamable HTTP (stateless; one POST per message)
   - Header: `Authorization: Bearer <your token>`

3. The token acts as your account and nothing else. Revoke it from
   the same screen at any time; minting a new one replaces the old.

## Tools

| Tool | What it does |
|---|---|
| `get_snapshot` | Running-low items, spend and returns totals, trip count, top items. |
| `get_list` | The current shopping list, with quantities and check-offs. |
| `add_items` | Add items by name, as a person would say them. |
| `check_item` | Check an item off (or uncheck it) by name. |
| `file_receipt` | File a receipt the agent has already read. Arya verifies the arithmetic, files the lines, and learns from them; it spends no perception tokens of its own. |
| `get_receipts` | Recent filed receipts: merchant, date, total. |

## The showcased client

Muse Spark is the reference client: in chat, "add oat milk to my
list" files through `add_items`, "what am I low on?" answers from
`get_snapshot`, and a receipt photo read in chat files through
`file_receipt`. The protocol is the standard one — nothing in the
connector is specific to a single assistant.
