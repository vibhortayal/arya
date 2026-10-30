"""List export and import formats: CSV, JSON and a text checklist.

Pure functions over plain rows, so the Lists API (and the in-app Share
and Export, when it ships) write and read one layout. A row is
{name, qty, unit, checked, department, list}. $0: no model."""
import csv
import io
import re

CSV_COLUMNS = ["name", "qty", "unit", "checked", "department", "list"]
_BOXES = "☐☑✓✔"
_CHECKED_LEAD = re.compile(r"^\s*(?:[☑✓✔]|\[[xX]\])\s*")
_BOX_LEAD = re.compile(r"^\s*[" + _BOXES + r"]\s*")


def _qty_text(qty):
    return str(int(qty)) if float(qty) == int(qty) else str(qty)


def item_line(row):
    """One checklist line: "☐ eggs x 2", "☑ milk 1.5 gal", "☐ bread"."""
    qty, unit = row.get("qty") or 1, row.get("unit") or ""
    tail = ""
    if unit:
        tail = f" {_qty_text(qty)} {unit}"
    elif qty != 1:
        tail = f" x {_qty_text(qty)}"
    return f"{'☑' if row.get('checked') else '☐'} {row['name']}{tail}"


def to_text(rows):
    return "\n".join(item_line(r) for r in rows) + ("\n" if rows else "")


def to_csv(rows):
    out = io.StringIO(newline="")
    w = csv.writer(out, lineterminator="\n")
    w.writerow(CSV_COLUMNS)
    for r in rows:
        w.writerow([_cell(r.get("name")), _qty_text(r.get("qty") or 1),
                    r.get("unit") or "", "true" if r.get("checked") else "false",
                    _cell(r.get("department")), _cell(r.get("list"))])
    return out.getvalue()


def _cell(v):
    """A spreadsheet runs a cell that starts with = + - @ as a formula:
    prefix an apostrophe so a list name cannot."""
    v = "" if v is None else str(v)
    return "'" + v if v[:1] in ("=", "+", "-", "@") else v


def _uncell(v):
    v = (v or "").strip()
    return v[1:] if v[:1] == "'" and v[1:2] in ("=", "+", "-", "@") else v


def _truthy(v):
    return str(v or "").strip().lower() in ("true", "1", "yes", "y", "x")


def parse_text(text):
    """A checklist or plain list -> rows. Boxes set the checked state."""
    from api.list.intake import split_list_items_units
    rows, skipped = [], 0
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        checked = bool(_CHECKED_LEAD.match(line))
        line = _BOX_LEAD.sub("", _CHECKED_LEAD.sub("", line, count=1), count=1)
        found = split_list_items_units(line)
        if not found:
            skipped += 1
        for name, qty, unit in found:
            rows.append({"name": name, "qty": qty, "unit": unit,
                         "checked": checked, "department": "", "list": ""})
    return rows, skipped


def parse_csv(text):
    """CSV with a header row (any column order; only name is needed)."""
    from api.list.intake import amount, clean_unit
    reader = csv.DictReader(io.StringIO(text or "", newline=""))
    fields = {(f or "").strip().lower(): f for f in (reader.fieldnames or [])}
    if "name" not in fields:
        raise ValueError("the CSV needs a header row with a name column")
    rows, skipped = [], 0

    def cell(rec, key):
        return _uncell(rec.get(fields[key])) if key in fields else ""
    for rec in reader:
        name = " ".join(cell(rec, "name").split())[:120]
        if not name:
            skipped += 1
            continue
        try:
            qty = amount(cell(rec, "qty") or 1)
        except ValueError:
            qty = 1
        unit = clean_unit(cell(rec, "unit"))
        if not unit:
            qty = max(1, min(int(qty), 99))  # a bare count stays whole
        rows.append({"name": name, "qty": qty, "unit": unit,
                     "checked": _truthy(cell(rec, "checked")),
                     "department": " ".join(cell(rec, "department").split())[:40],
                     "list": " ".join(cell(rec, "list").split())[:40]})
    return rows, skipped
