import { useEffect, useState, type ReactNode } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { Empty, Row } from "../ui/kit";
import { get, post } from "../lib/api";
import { fmtWeekday, money, qtyFmt } from "../lib/format";
import { useTranslation } from "../i18n";
import { LineFixSheet, type FixLine, type FixValues } from "../ui/LineFix";

/* Port of pwa/index.html #view-receipt and quest.js openReceipt.
 * Opened with nav.show("receipt", { receipt_id, id }). */

type Line = { name: string; raw?: string; edited?: boolean; qty?: number; line_type?: string; status?: string; line_total?: number | null };
type Detail = {
  receipt_id: string; merchant: string; purchased_at: string; source_type?: string; lines: Line[];
  subtotal?: number | null; tax?: number | null; total: number; returns_total?: number; savings?: number;
  totals_reconcile?: boolean; lines_edited?: boolean; photo?: boolean; media_type?: string;
};

/* Where a receipt came from (receipt.source_type), as words. */
const SOURCES = ["photo", "grocery", "order", "muse", "sample"];

export function Receipt() {
  const { t } = useTranslation();
  const nav = useNav();
  const { currency } = useSession();
  const { toast, showErr } = useToast();
  const id = String(nav.params.receipt_id ?? nav.params.id ?? "");
  const [r, setR] = useState<Detail | null>(null);
  const [showImg, setShowImg] = useState(false);
  const [fixing, setFixing] = useState<FixLine | null>(null);

  useEffect(() => {
    let live = true;
    setR(null); setShowImg(false);
    if (!id) return;
    get<Detail>(`/api/quest/receipts/${encodeURIComponent(id)}`).then(d => { if (live) setR(d); }).catch(showErr);
    return () => { live = false; };
  }, [id, nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = (n: number) => money(n, currency);
  const signed = (n: number | null | undefined) =>
    n != null && n < 0 ? <span className="return">−{m(n)}</span> : (n != null ? m(n) : "");

  const reload = () => get<Detail>(`/api/quest/receipts/${encodeURIComponent(id)}`).then(setR).catch(showErr);
  /* Fix this line (owner, 2026-11-01): save, then Undo puts the old
   * values back, and the same name on other receipts too. */
  const saveFix = async (v: FixValues) => {
    if (!r || !fixing) return;
    const ln = fixing;
    const url = `/api/receipts/${encodeURIComponent(r.receipt_id)}/lines/${ln.idx}`;
    try {
      const out = await post<{ also?: number; undo?: unknown[] }>(url, v);
      setFixing(null);
      reload();
      const old: FixValues = {};
      if (v.name !== undefined) old.name = ln.name;
      if (v.qty !== undefined) old.qty = Math.abs(ln.qty ?? 1);
      if (v.line_total !== undefined) old.line_total = Math.abs(ln.line_total ?? 0);
      toast(out.also ? t("lineFix.savedAlso", { count: out.also }) : t("lineFix.saved"), {
        action: t("common.undo"),
        onAction: () => {
          post(url, old)
            .then(() => (out.undo && out.undo.length ? post("/api/review/undo", { changes: out.undo }) : null))
            .then(reload).catch(showErr);
        },
      });
    } catch (e) { showErr(e); }
  };

  const del = async () => {
    if (!confirm(t("receipt.confirmDelete"))) return;
    try {
      await post(`/api/quest/receipts/${encodeURIComponent(id)}/delete`, {});
      toast(t("receipt.deleted"));
      nav.back("receipts");
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };

  const orig = r ? `/api/quest/receipts/${encodeURIComponent(r.receipt_id)}/original` : "";

  return (
    <>
      <p><a href="#" id="rcd-back" className="backlink" onClick={ev => { ev.preventDefault(); nav.back("receipts"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <div id="rc-body">
        {r && <>
          <h1 className="largetitle" style={{ fontSize: 28 }}>{r.merchant}</h1>
          <p className="subtitle">{t("receipt.filedFrom", { when: fmtWeekday(String(r.purchased_at)), source: SOURCES.includes(String(r.source_type)) ? t(`receipt.source.${r.source_type}`) : t("receipt.aReceipt") })}</p>
          {r.lines.length > 0 && <p className="muted small" id="rc-fix-hint" style={{ margin: "0 4px 8px" }}>{t("lineFix.tapHint")}</p>}
          <div className="group" id="rc-lines">
            {r.lines.length ? r.lines.map((ln, i) => {
              const open = () => setFixing({ idx: i, name: ln.name, raw: ln.raw, qty: ln.qty, line_total: ln.line_total, line_type: ln.line_type });
              const tag = ln.edited ? <span className="lf-tag">{t("lineFix.edited")}</span> : null;
              const right = (v: ReactNode) => <>{v}<span className="chev" aria-hidden="true">›</span></>;
              const p = { key: i, className: "lf-row", onClick: open };
              if (ln.line_type === "return") return <Row {...p} name={<>{ln.name}{tag}</>} sub={t("receipt.returned")} right={right(signed(ln.line_total))} />;
              if (ln.line_type === "discount") return <Row {...p} name={<>{ln.name}{tag}</>} sub={t("receipt.savingsOnTheItemAbove")} right={right(signed(ln.line_total))} />;
              return <Row {...p} name={<>{ln.name}{(ln.qty ?? 0) > 1 ? ` × ${qtyFmt(ln.qty)}` : ""}{tag}</>}
                sub={ln.status === "unverified" ? t("receipt.unverified") : ""}
                right={right(ln.line_total != null ? m(ln.line_total) : "")} />;
            }) : <Empty>{t("receipt.noLinesOnThisReceipt")}</Empty>}
          </div>
          <div className="group">
            {r.subtotal != null && <Row name={t("receipt.subtotal")} right={m(r.subtotal)} />}
            {r.tax != null && <Row name={t("receipt.tax")} right={m(r.tax)} />}
            <Row name={t("common.total")} right={m(r.total)} />
            {r.savings ? <Row name={t("receipt.youSaved")} sub={t("receipt.youSavedSub")} right={<span className="saved">{m(r.savings)}</span>} /> : null}
            {r.returns_total ? <Row name={t("receipt.returnsNetted")} right={<span className="return">−{m(r.returns_total)}</span>} /> : null}
          </div>
          <p className="muted">{r.totals_reconcile
            ? <><span aria-hidden="true">✓ </span>{t("receipt.verified", { total: m(r.total) })}</>
            : r.lines_edited ? t("lineFix.linesDontMatch", { total: m(r.total) }) : t("receipt.notReconciled")}</p>
          {r.photo && <p className="nomargin">{String(r.media_type || "").startsWith("image/")
            ? <>
                <button className="btn" id="rc-view-btn" type="button" onClick={() => setShowImg(s => !s)}>{t("receipt.viewReceipt")}</button>
                <img id="rc-view-img" className="receiptimg" src={orig} alt={t("receipt.theFiledReceiptPhoto")} hidden={!showImg} />
              </>
            : <a className="btn" href={orig} target="_blank" rel="noopener">{t("receipt.viewReceipt")}</a>}</p>}
          <LineFixSheet line={fixing} lines={r.lines} printed={r} currency={currency} onClose={() => setFixing(null)} onSave={saveFix} />
          <p className="nomargin" style={{ marginTop: 10 }}><button className="btn danger" id="rc-del-btn" type="button" onClick={del}>{t("receipt.deleteReceipt")}</button></p>
        </>}
      </div>
    </>
  );
}
