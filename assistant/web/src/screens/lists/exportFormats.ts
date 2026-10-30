import type { Item } from "./model";

/* The three ways out (owner, 2026-10-30): a checklist for Notes and
 * messages, a CSV for spreadsheets, and JSON for other apps. The CSV
 * columns match the Lists API: name, qty, unit, checked, department, list. */
export type ExportRow = { name: string; qty: number; unit: string; checked: boolean; department: string };

export const toRows = (items: Item[], dept: (i: Item) => string): ExportRow[] =>
  items.map(i => ({ name: i.name, qty: i.qty || 1, unit: i.unit || "", checked: !!i.checked, department: dept(i) }));

const amount = (r: ExportRow) => (r.unit ? ` ${r.qty} ${r.unit}` : r.qty > 1 ? ` ×${r.qty}` : "");

export const toChecklist = (listName: string, rows: ExportRow[]) =>
  [listName, ...rows.map(r => `${r.checked ? "✓" : "☐"} ${r.name}${amount(r)}`)].join("\n");

const cell = (v: string | number | boolean) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const CSV_HEAD = "name,qty,unit,checked,department,list";
export const toCsv = (listName: string, rows: ExportRow[]) =>
  [CSV_HEAD, ...rows.map(r => [r.name, r.qty, r.unit, r.checked ? "yes" : "no", r.department, listName].map(cell).join(","))].join("\n");

export const toJson = (listName: string, rows: ExportRow[]) => JSON.stringify({ list: listName, items: rows }, null, 2);

export const fileName = (listName: string, ext: string) =>
  `${(listName || "list").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "list"}.${ext}`;
