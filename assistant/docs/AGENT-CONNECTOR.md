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

Tested by the owner on Muse, 2026-11-02: ask the Muse agent to connect, and
paste the code into its secure credentials step. No terminal and no settings
file.

1. In Arya, open Settings → About Arya → Use Arya in another AI app and tap
   **Make my code**. Copy it; it is shown once and starts with `arya_`. A new
   code replaces the old one. (The code works with any MCP client, not only
   Muse.)
2. In your AI app, ask it to connect to Arya at
   `https://arya.teamnightshift.org/api/mcp`. When it asks for your code,
   paste it into the app's secure credentials step, never into the chat.
   Apps that take a server list instead use transport streamable HTTP
   (stateless; one POST per message) and the header
   `Authorization: Bearer <your code>`.
3. Ask it "What is on my Arya list?" Then try "Add oat milk to my Arya list"
   and "What am I running low on in Arya?" The list answer shows only what is
   on your list, and oat milk also appears on the Lists screen in Arya.

If the app says it cannot connect, make a new code (the old one stops
working) and paste it again. Tap **Turn off this code** in Arya to switch it
off.

Backup path, for Muse Code when the agent flow is not available: it reads
remote MCP servers from `~/.config/muse/settings.json`. Keep the code in an
environment variable (`read -rs ARYA_TOKEN; export ARYA_TOKEN`), keep
`"schema_version": 1` in the file, and add:

```
"mcp_servers": { "arya": { "transport": "streamable_http",
  "url": "https://arya.teamnightshift.org/api/mcp",
  "headers": { "Authorization": "Bearer ${ARYA_TOKEN}" } } }
```

Run `muse` from the same terminal window and type `/mcp` to see the six
tools. This path follows dev.meta.ai/docs/muse-code/extending and has not
been run by us.

What the code can and cannot reach: it acts as your account: it is accepted on the MCP door and on
   the app's routes under `/api`, but never on `/auth` (it cannot mint tokens
   or delete the account). A short list of routes is closed to tokens and
   answers 403: calls that spend model credits in bulk (chat, photo and
   shelf reads, avatars, the judge), groups, friends, push, feedback,
   settings changes, price sharing, account export and receipt delete
   through the app (`ARYA_TOKEN_GUARDS`). Revoke it from
   the same screen at any time; minting a new one replaces the old.

## Limits

- 600 calls per account per hour (`ARYA_MCP_RATE`), shared by the connector,
  the Lists API (`docs/API.md` in the repo root) and every other route a token
  reaches; over it, 429 with `Retry-After`. 256 KB per request,
  50 items per `add_items`, 200 lines per `file_receipt`.

## Tools

| Tool | What it does |
|---|---|
| `get_snapshot` | Running-low items, spend and returns totals, trip count, top items. |
| `get_list` | The current shopping list, with quantities and check-offs. |
| `add_items` | Add items by name, as a person would say them. |
| `check_item` | Check an item off (or uncheck it) by name. |
| `file_receipt` | File a receipt the agent has already read. Arya verifies the arithmetic, files the lines, and learns from them; it spends no perception tokens of its own. |
| `get_receipts` | Recent filed receipts: merchant, date, total. |

`get_list` and `add_items` work on one flat list and take no list id. The Lists API (`/api/v1`, see `docs/API.md`) is list-aware: it reads and writes each list by id.

## The showcased client

Muse Spark is the reference client: in chat, "add oat milk to my
list" files through `add_items`, "what am I low on?" answers from
`get_snapshot`, and a receipt photo read in chat files through
`file_receipt`. The protocol is the standard one — nothing in the
connector is specific to a single assistant.
