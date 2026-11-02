/* Display helpers, ported 1:1 from pwa/app.js. */
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function fmtShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  // The year shows when it is not this year: an archive spans years.
  return y && y !== new Date().getFullYear() ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* "Tue, Oct 27" for a receipt's date; the year shows when it is not this year. */
export function fmtWeekday(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${DAYS[new Date(y, m - 1, d).getDay()]}, ${fmtShort(iso.slice(0, 10))}`;
}

export type Currency = { code: string; symbol: string };
export const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", CAD: "C$", AUD: "A$" };

/* Grouping per currency (owner, 2026-11-01: "$13,243.58"). Rupees group
 * the Indian way (₹1,23,456.00); the rest group in thousands. The dot
 * stays the decimal mark everywhere, to match the English screens. */
const GROUPING: Record<string, string> = { INR: "en-IN" };
export function money(n: number, cur: Currency = { code: "USD", symbol: "$" }): string {
  const abs = Math.abs(Number(n) || 0);
  return cur.symbol + abs.toLocaleString(GROUPING[cur.code] || "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function qtyFmt(q: unknown): string {
  const n = Number(q);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/* The amount of a row as people say it: "x2", or "2 kg" when the row
 * carries a free-text unit. "" for a plain single. */
export function qtyTag(it?: { qty?: number; unit?: string } | null): string {
  const unit = String((it && it.unit) || "").trim();
  if (unit) return `${qtyFmt(it!.qty)} ${unit}`;
  return it && (it.qty || 0) > 1 ? `x${qtyFmt(it.qty)}` : "";
}

/* Asset URLs come from the current PWA's static mount, shared by both apps. */
/* "Paper Towels 6 ct" never breaks between "6" and "ct" (audit L5):
 * a no-break space joins a number to the unit after it. */
export function keepUnit(name: string): string {
  return name.replace(/(\d)\s+(?=(?:ct|count|pk|pack|lb|lbs|oz|fl oz|gal|qt|pt|kg|g|ml|l|dozen|doz)\b)/gi, "$1\u00a0");
}
export const asset = (p: string) => "/" + p.replace(/^\/+/, "");

/* What coupons, deals and discounts took off a filed receipt (the same
 * rule as api/ledger/build.py receipt_savings): discount lines, plus the
 * discount a photo read kept on a line. A positive number, or 0. */
export function lineSavings(lines: { line_type?: string; line_total?: number | null; discount_amount?: number | null }[]): number {
  const sum = lines.reduce((a, ln) => a + Math.abs((ln.line_type === "discount" ? ln.line_total : ln.discount_amount) || 0), 0);
  return Math.round(sum * 100) / 100;
}
