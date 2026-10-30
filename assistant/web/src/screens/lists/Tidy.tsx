import { useEffect, useState } from "react";
import { get, post } from "../../lib/api";
import { useToast } from "../../ui/Toast";
import { useTranslation } from "../../i18n";

/* Tidy up with Arya (owner, 2026-10-30): the fixes from /api/list/tidy,
 * applied all at once or one decision per screen, always undoable. */
export type Fix =
  | { kind: "double"; keep: string; drop: string[]; names: string[] }
  | { kind: "amount"; id: string; name: string; new_name: string; qty: number }
  | { kind: "errand"; id: string; name: string };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function TidyFlow({ listId, onClose, onChanged }:
  { listId: string; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [fixes, setFixes] = useState<Fix[] | null>(null);
  const [mode, setMode] = useState<"summary" | "steps">("summary");
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<{ fixes: Fix[] }>("/api/list/tidy?list_id=" + encodeURIComponent(listId))
      .then(r => setFixes(r.fixes)).catch(e => { toast(errMsg(e)); onClose(); });
  }, [listId]);

  const apply = async (list: Fix[]) => {
    setBusy(true);
    try {
      const r = await post<{ applied: number; undo: Record<string, unknown> }>("/api/list/tidy/apply", { fixes: list });
      onChanged();
      return r;
    } catch (e) { toast(errMsg(e)); return null; } finally { setBusy(false); }
  };
  const undoable = (applied: number, undo: Record<string, unknown>) =>
    toast(t("lists.tidy.tidied", { count: applied }), { action: t("common.undo"), onAction: () => {
      post("/api/list/tidy/undo", { undo }).then(onChanged).catch(e => toast(errMsg(e)));
    } });

  if (!fixes) return <p className="sub">{t("lists.tidy.looking")}</p>;
  if (!fixes.length) return <>
    <h3 id="ls-title" className="largetitle" style={{ fontSize: 22, margin: "0 0 4px" }}>{t("lists.tidy.nothing")}</h3>
    <div className="sheetacts"><button className="btn primary" type="button" onClick={onClose}>{t("common.done")}</button></div></>;

  if (mode === "summary") return <>
    <h3 id="ls-title" className="largetitle" style={{ fontSize: 22, margin: "0 0 4px" }}>{t("lists.tidy.cardTitle")}</h3>
    <p className="sub">{t("lists.tidy.cardSub", { count: fixes.length })}</p>
    <div className="sheetacts">
      <button className="btn secondary" type="button" data-tidy="steps" disabled={busy} onClick={() => setMode("steps")}>{t("lists.tidy.oneByOne")}</button>
      <button className="btn primary" type="button" data-tidy="all" disabled={busy}
        onClick={async () => { const r = await apply(fixes); onClose(); if (r) undoable(r.applied, r.undo); }}>{t("lists.tidy.applyAll", { count: fixes.length })}</button>
    </div>
    <button className="linkbtn" type="button" data-tidy="later" style={{ minHeight: 44 }} onClick={onClose}>{t("lists.tidy.notNow")}</button></>;

  const f = fixes[i];
  const left = fixes.length - i - 1;
  const next = () => (i + 1 >= fixes.length ? onClose() : setI(i + 1));
  let title = "", sub = "", yes = "", no = "";
  if (f.kind === "double") {
    title = t("lists.tidy.doubleTitle", { name: f.names[0] });
    sub = t("lists.tidy.doubleSub", { a: f.names[0], b: f.names[1] || "" });
    yes = t("lists.tidy.merge"); no = t("lists.tidy.keepBoth");
  } else if (f.kind === "amount") {
    title = t("lists.tidy.amountTitle", { name: f.name });
    sub = t("lists.tidy.amountSub", { item: f.new_name, qty: f.qty });
    yes = t("lists.tidy.useQty", { qty: f.qty }); no = t("lists.tidy.leave");
  } else {
    title = t("lists.tidy.errandTitle", { name: f.name });
    sub = t("lists.tidy.errandSub");
    yes = t("lists.tidy.removeIt"); no = t("lists.tidy.keepIt");
  }
  return <>
    {fixes.length > 1 ? <p className="sub nomargin" id="tidy-progress">{t("lists.tidy.progress", { n: i + 1, total: fixes.length })}</p> : null}
    <h3 id="ls-title" className="largetitle" style={{ fontSize: 22, margin: "0 0 4px" }}>{title}</h3>
    <p className="sub">{sub}</p>
    <div className="sheetacts">
      <button className="btn secondary" type="button" data-tidy="no" disabled={busy} onClick={next}>{no}</button>
      <button className="btn primary" type="button" data-tidy="yes" disabled={busy}
        onClick={async () => { const r = await apply([f]); if (r) undoable(r.applied, r.undo); next(); }}>{yes}</button>
    </div>
    {left > 0 ? <button className="linkbtn" type="button" data-tidy="rest" disabled={busy} style={{ minHeight: 44 }}
      onClick={async () => { const r = await apply(fixes.slice(i + 1)); onClose(); if (r) undoable(r.applied, r.undo); }}>{t("lists.tidy.applyRest", { count: left })}</button> : null}</>;
}
