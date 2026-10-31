# Arya Lists API v1

Read and write your own Arya lists from another app or a script, and take
your data with you. The same personal API token that the agent connector
uses works here. Make one in Arya under Settings › Use Arya in another AI
app. The code shows once; a new code replaces it.

Base URL: `https://arya.teamnightshift.org/api/v1`

The same guide, shorter, is the public page at `/developers`, with a
five-minute quickstart in curl, Python and JavaScript. The interactive
reference (try the calls from the browser) is at `/developers/reference`.

`/api/v1` is frozen. Changes after it ships are additive only: new
endpoints, new optional fields, new response fields. Clients must ignore
fields they do not know. The machine-readable schema is at
`/api/v1/openapi.json` (public, no token needed).

```bash
export ARYA=https://arya.teamnightshift.org/api/v1
export TOKEN=...   # your code
```

Every call sends `Authorization: Bearer $TOKEN`. The token reaches only
your own account's data. Cookie sign-in does not work on `/api/v1`.

## Lists and items

A list is `{id, name, stores, open_count}`. `open_count` is the number of
items not yet checked. The id `unfiled` is "Everything else": the items
that sit on no named list. An item is
`{id, name, qty, unit, checked, aisle, added_at, list_id}`.

- `aisle` is the department you set yourself, else `null`. Arya's own
  guess from the name is not part of the API.
- `added_at` is a UTC time. It is `null` for items added before the API
  existed and for items Arya suggested.
- `checked` is for the current shopping cycle, as in the app.
- An item sits on one list at a time.

### GET /lists

```bash
curl -s -H "Authorization: Bearer $TOKEN" $ARYA/lists
# [{"id":"unfiled","name":"Everything else","stores":[],"open_count":1},
#  {"id":"l-1a2b3c4d","name":"Costco","stores":["Costco"],"open_count":3}]
```

### GET /lists/{id}

The list, plus `items`.

```bash
curl -s -H "Authorization: Bearer $TOKEN" $ARYA/lists/l-1a2b3c4d
```

### POST /lists/{id}/items

Add items. Send `items` (structured) or `text` (free text), not both.
At most 50 items per call.

```bash
# structured: a name, or an object with qty, unit and aisle
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"items":["oat milk",{"name":"rice","qty":2,"unit":"kg","aisle":"Pantry"}]}' \
  $ARYA/lists/l-1a2b3c4d/items

# free text: split the way the app splits typed lists ("eggs x 3, bread")
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"milk\neggs x 3\nbread"}' $ARYA/lists/l-1a2b3c4d/items
```

Reply:

```json
{"added": 2, "already": 1, "already_names": [{"name": "milk", "list": "Costco"}],
 "also_on": [], "skipped": [], "items": [ ... ]}
```

- `already`: names that were already on this list. They are not added twice.
- `also_on`: names that are already on a **different** list. The API does
  not move them and does not add them to this list; the reply says where
  they are. To move one, `PATCH` its `list_id`. (In the app a person can
  keep an item on more than one list. The API shows such an item once, under
  its main list, and its ticks there are the main list's.)
- `skipped`: pieces of `text` that were not items (a bare number). A line with a sentence in it is skipped whole, so no piece of it is added.
- `items`: the items now on the list for the names you sent.
- `text` is split by fixed rules. The API makes no model calls.

### PATCH /items/{id}

Change any of `checked`, `qty`, `unit`, `list_id` (a list id, `unfiled`, or
`null` for Everything else), `aisle` (`""` clears it).
Nothing changes if any field is bad.

```bash
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"checked":true}' $ARYA/items/manual-milk
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"list_id":"l-9f8e7d6c","qty":2,"aisle":"Dairy"}' $ARYA/items/manual-milk
```

Reply: the item.

### DELETE /items/{id}

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" $ARYA/items/manual-milk
# {"deleted":"manual-milk"}
```

## Export and import

### GET /lists/{id}/export?format=csv|json|text

`json` (the default) is `{"list": {id, name, stores}, "items": [...]}`.
`text` is a checklist, one item per line: `☐ rice 2 kg`, `☐ eggs x 12`,
`☑ milk`. `csv` has this header and these columns, in this order:

```
name,qty,unit,checked,department,list
rice,2,kg,false,Pantry,Costco
```

`checked` is `true` or `false`. A cell that starts with `= + - @` gets a
leading apostrophe so a spreadsheet does not run it as a formula. Import
removes it.

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$ARYA/lists/l-1a2b3c4d/export?format=csv" > costco.csv
```

### POST /lists/import

Send the file as the request body. The format is `csv` when the
`Content-Type` contains `csv`, else `text`; `?format=csv|text` overrides.
`?list=Name` is the list to fill (default `Imported`). It is created if you
do not have it; names match without regard to case. In a CSV, a `list`
column per row wins over `?list=`. Only `name` is required in a CSV. A
text body takes the checklist lines above or any plain list. At most 500
rows.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/csv" \
  --data-binary @costco.csv "$ARYA/lists/import?list=Costco"
# {"created":3,"skipped":0,"lists":[{"id":"l-1a2b3c4d","name":"Costco"}]}
```

`created` is the number of new items. `skipped` counts rows that were
empty, not items, repeated, over the 500 limit, or already on a list.
Checked state and department are applied to new items only.

## Your receipts and totals

Your own data only: the receipts **you** filed. Receipts filed by other
members of your household group are not returned. Nothing here is
inferred by Arya; totals are sums of what your receipts say.

A receipt is `{id, merchant, date, total, subtotal, tax, items, reconciles,
has_photo}`. The detail adds `lines`: `{name, qty, unit_price, line_total,
line_type}` with `line_type` `item`, `discount` or `return` (returns are
negative).

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$ARYA/receipts?limit=20&offset=0"   # newest first, max 200
curl -s -H "Authorization: Bearer $TOKEN" $ARYA/receipts/ext-1a2b3c4d5e
curl -s -H "Authorization: Bearer $TOKEN" $ARYA/receipts/ext-1a2b3c4d5e/original > receipt.jpg
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" $ARYA/receipts/ext-1a2b3c4d5e
```

`GET /receipts/export?format=csv|json` returns every receipt you filed.
The CSV has one row per line, with columns
`receipt_id,merchant,date,name,qty,unit_price,line_total,line_type`.

`/receipts/{id}/original` is the photo or PDF you uploaded, if Arya kept one
(`has_photo`). Filing a receipt through the API is not in v1; use the app
or the agent connector.

### GET /analysis/spending

```bash
curl -s -H "Authorization: Bearer $TOKEN" $ARYA/analysis/spending
# {"trips":2,"spend_total":11.5,"returns_total":4.0,
#  "by_month":{"2026-10":11.5},"by_store":{"Costco":11.5,"Trader Joe's":0.0}}
```

`spend_total` adds up the receipt totals. `by_store` groups by the merchant
name printed on the receipt.

### GET /analysis/purchases?limit=50

What you bought and when, by the name Arya read from the receipt (max 500):
`{"items":[{"name","times_bought","qty","spent","first_bought","last_bought"}]}`,
most often bought first. Returns and discounts are not counted as buys.

## Errors

Errors are JSON, with the matching HTTP status:

```json
{"error": {"code": "not_found", "message": "no such list"}}
```

| Status | `code` | When |
|---|---|---|
| 400 | `bad_request` | a bad or unknown field, bad JSON, bad format |
| 401 | `unauthorized` | no token, a wrong token, or a revoked token |
| 404 | `not_found` | no such list or item (also for another account's ids) |
| 413 | `too_large` | body over 256 KB |
| 429 | `rate_limited` | over the hourly limit; see `Retry-After` |
| 500 | `internal_error` | our fault; try again |

## Limits

- 600 calls per account per hour, shared with the agent connector and
  every other route a token reaches (`ARYA_MCP_RATE`). Over it you get `429` with a `Retry-After` header
  in seconds.
- 256 KB per request, 50 items per add call, 500 rows per import.

## Later

Not in v1: webhooks, OAuth, sharing a list with another account, filing a
receipt, and Quest data. Arya's own inference (what is running low,
suggestions, aisle and store maps, prices from other households) is not
part of the API by design: the API is for your own data.
