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

export function money(n: number, cur: Currency = { code: "USD", symbol: "$" }): string {
  return cur.symbol + Math.abs(n).toFixed(2);
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
export const asset = (p: string) => "/" + p.replace(/^\/+/, "");
