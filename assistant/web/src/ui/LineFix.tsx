import { useEffect, useState } from "react";
import { Sheet } from "./Sheet";
import { useTranslation } from "../i18n";
import { money, type Currency } from "../lib/format";

/* "Fix this line" on a filed receipt (owner, 2026-11-01, picked "full"):
 * name, quantity and price paid. The printed total never changes; when a
 * new price stops the lines adding up, the sheet says so before saving.
 * The server is POST /api/receipts/{id}/lines/{idx} (#407). */

export type FixLine = { idx: number; name: string; raw?: string; qty?: number; line_total?: number | null; line_type?: string };
export type FixValues = { name?: string; qty?: number; line_total?: number };

/* Do the lines still add up to the printed subtotal (or total less tax)?
 * The same rule as api/state.py lines_add_up. null when nothing to check. */
export function linesMatch(lines: { line_total?: number | null }[], printed: { subtotal?: number | null; total?: number | null; tax?: number | null }) {
  const target = printed.subtotal ?? (printed.total != null ? printed.total - (printed.tax || 0) : null);
  if (target == null) return null;
  const sum = Math.round(lines.reduce((a, l) => a + (Number(l.line_total) || 0), 0) * 100) / 100;
  return { ok: Math.abs(sum - target) <= 0.05, diff: Math.round((sum - target) * 100) / 100 };
}

const num = (s: string) => {
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return String(s).trim() === "" || !isFinite(n) ? null : n;
};

export function LineFixSheet({ line, lines, printed, currency, onClose, onSave }: {
  line: FixLine | null; lines: { line_total?: number | null }[];
  printed: { subtotal?: number | null; total?: number | null; tax?: number | null };
  currency: Currency; onClose: () => void; onSave: (v: FixValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const item = !line?.line_type || line.line_type === "item";

  useEffect(() => {
    if (!line) return;
    setName(line.name || "");
    setQty(line.qty != null ? String(Math.abs(line.qty)) : "1");
    setPrice(line.line_total != null ? Math.abs(line.line_total).toFixed(2) : "");
    setBusy(false);
  }, [line]);

  const q = num(qty), p = num(price);
  const badQty = item && (q == null || q <= 0);
  const badPrice = price.trim() !== "" && p == null;
  const signed = p == null ? null : (line && (line.line_type === "return" || line.line_type === "discount") ? -p : p);
  const after = line ? lines.map((l, i) => (i === line.idx && signed != null ? { line_total: signed } : l)) : lines;
  const before = linesMatch(lines, printed);
  const now = linesMatch(after, printed);
  /* Warn only when this change is what breaks (or keeps) a mismatch. */
  const warn = !!now && !now.ok && !!line && signed != null && Math.abs((line.line_total ?? 0) - signed) > 0.004;

  const changes = (): FixValues => {
    const v: FixValues = {};
    if (line && name.trim() && name.trim() !== line.name) v.name = name.trim();
    if (line && item && q != null && q !== Math.abs(line.qty ?? 1)) v.qty = q;
    if (line && p != null && Math.abs(p - Math.abs(line.line_total ?? 0)) > 0.004) v.line_total = p;
    return v;
  };
  const save = async () => {
    const v = changes();
    if (!Object.keys(v).length) { onClose(); return; }
    setBusy(true);
    try { await onSave(v); } finally { setBusy(false); }
  };

  return (
    <Sheet open={!!line} onClose={onClose} id="line-fix" labelledBy="lf-title">
      <span className="sheetgrip" />
      <h3 id="lf-title" className="largetitle" style={{ fontSize: 22, margin: "0 0 6px" }}>{t("lineFix.title")}</h3>
      {line?.raw && <p className="lf-raw">{t("lineFix.printed", { raw: line.raw })}</p>}
      <label className="field" htmlFor="lf-name">{t("lineFix.name")}</label>
      <input type="text" id="lf-name" value={name} onChange={e => setName(e.target.value)} autoComplete="off" />
      <div className="lf-two">
        {item && <div><label className="field" htmlFor="lf-qty">{t("lineFix.qty")}</label>
          <input type="text" id="lf-qty" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} aria-invalid={badQty} /></div>}
        <div><label className="field" htmlFor="lf-price">{item ? t("lineFix.price") : t("lineFix.amount")}</label>
          <input type="text" id="lf-price" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} aria-invalid={badPrice} /></div>
      </div>
      {badQty && <p className="lf-err">{t("lineFix.badQty")}</p>}
      {warn
        ? <p className="lf-warn" id="lf-warn">{t(now!.diff > 0 ? "lineFix.warnMore" : "lineFix.warnLess", { amount: money(Math.abs(now!.diff), currency) })}</p>
        : <p className="muted small" style={{ margin: "10px 0" }}>{before && !before.ok && now?.ok ? t("lineFix.nowMatches") : t("lineFix.nameNote")}</p>}
      <button className="btn primary wide" id="lf-save" type="button" disabled={busy || badQty || badPrice || !name.trim()} onClick={save}>
        {warn ? t("lineFix.saveAnyway") : t("common.save")}
      </button>
    </Sheet>
  );
}
