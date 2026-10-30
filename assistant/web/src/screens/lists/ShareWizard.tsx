import { useState } from "react";
import { post } from "../../lib/api";
import { useToast } from "../../ui/Toast";
import { useTranslation } from "../../i18n";
import { AISLE_ORDER, OTHER } from "./aisles";
import { fileName, toChecklist, toCsv, toJson, toRows } from "./exportFormats";
import { type HomeData, type Item } from "./model";

/* Share, export or import (owner, 2026-10-30): one question, then a short
 * path. Share sends a checklist, Export downloads a file, Import reads a
 * paste into a preview and adds what is ticked. Nothing is added before
 * the preview. */

type Step = "choose" | "share" | "export" | "paste" | "found" | "added";
type Found = { name: string; qty: number; unit: string; aisle: string; other_list: string; on: boolean };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const deptOf = (i: Item) => (i.aisle && AISLE_ORDER.includes(i.aisle) ? i.aisle : OTHER);

export function ShareWizard({ data, listId, listName, onClose, onChanged, onTidy }:
  { data: HomeData; listId: string; listName: string; onClose: () => void; onChanged: () => void; onTidy: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("choose");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Found[]>([]);
  const [result, setResult] = useState<{ added: number; already: number } | null>(null);

  const items = data.list.items.filter(i => i.on_list && i.list === listId);
  const rows = toRows(items, deptOf);
  const checklist = toChecklist(listName, rows);
  const total = step === "paste" ? 3 : step === "found" ? 3 : step === "added" ? 3 : 2;
  const num = step === "paste" ? 2 : step === "found" ? 3 : 2;

  const copy = async () => {
    try { await navigator.clipboard.writeText(checklist); toast(t("lists.share.copied")); }
    catch { toast(checklist); }
  };
  const share = async () => {
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title: listName, text: checklist }); return; }
      catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    await copy();
  };
  const download = (body: string, ext: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement("a");
    const file = fileName(listName, ext);
    a.href = url; a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(t("lists.share.downloaded", { file }));
  };
  const read = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await post<{ items: Omit<Found, "on">[] }>("/api/list/import-preview", { text, list_id: listId });
      if (!r.items.length) { toast(t("lists.share.nothing")); return; }
      setFound(r.items.map(i => ({ ...i, on: true })));
      setStep("found");
    } catch (e) { toast(errMsg(e)); }
    finally { setBusy(false); }
  };
  const addAll = async () => {
    const chosen = found.filter(f => f.on);
    if (!chosen.length) return;
    setBusy(true);
    try {
      const r = await post<{ added: number; already: number }>("/api/list/import", { list_id: listId, items: chosen });
      setResult(r);
      setStep("added");
      onChanged();
    } catch (e) { toast(errMsg(e)); }
    finally { setBusy(false); }
  };

  const head = (title: string, sub: string, back: Step | null, n?: number, tot?: number) => (
    <>
      <span className="sheetgrip" />
      <div className="wizbar">
        {back ? <button className="linkbtn" type="button" data-wiz="back" onClick={() => setStep(back)}><span aria-hidden="true">‹ </span>{t("lists.share.back")}</button> : <span />}
        {n ? <span className="sub nomargin">{t("lists.share.step", { n, total: tot })}</span> : null}
      </div>
      <h3 id="ls-title" className="largetitle" style={{ fontSize: 22, margin: "0 0 4px" }}>{title}</h3>
      <p className="sub">{sub}</p>
    </>
  );
  const row = (id: string, title: string, sub: string, go: () => void) => (
    <button className="navrow" type="button" data-wiz={id} onClick={go}><span className="grow">{title}<small>{sub}</small></span><span className="chev">›</span></button>
  );
  const cancel = <div className="sheetacts"><button className="btn secondary" type="button" data-ls="close" onClick={onClose}>{t("common.cancel")}</button></div>;

  if (step === "share") return <>
    {head(t("lists.share.shareTitle"), t("lists.share.shareHint"), "choose", 2, 2)}
    <pre className="wizpre" id="wiz-preview">{checklist}</pre>
    <div className="sheetacts">
      <button className="btn secondary" type="button" data-wiz="copy" onClick={copy}>{t("lists.share.copy")}</button>
      <button className="btn primary" type="button" data-wiz="share" onClick={share}>{t("lists.share.shareBtn")}</button>
    </div></>;
  if (step === "export") return <>
    {head(t("lists.share.exportTitle"), t("lists.share.exportHint"), "choose", 2, 2)}
    {row("csv", t("lists.share.csv"), t("lists.share.csvSub"), () => download(toCsv(listName, rows), "csv", "text/csv"))}
    {row("json", t("lists.share.json"), t("lists.share.jsonSub"), () => download(toJson(listName, rows), "json", "application/json"))}
    {row("text", t("lists.share.text"), t("lists.share.textSub"), () => download(checklist, "txt", "text/plain"))}
    {cancel}</>;
  if (step === "paste") return <>
    {head(t("lists.share.pasteTitle"), t("lists.share.pasteHint"), "choose", num, total)}
    <textarea id="wiz-paste" className="wizpaste" value={text} onChange={e => setText(e.target.value)} autoFocus rows={7} />
    <div className="sheetacts">
      <button className="btn secondary" type="button" data-ls="close" onClick={onClose}>{t("common.cancel")}</button>
      <button className="btn primary" type="button" data-wiz="read" disabled={busy || !text.trim()} onClick={read}>{busy ? t("lists.share.reading") : t("lists.share.read")}</button>
    </div></>;
  if (step === "found") {
    const n = found.filter(f => f.on).length;
    return <>
      {head(t("lists.share.foundTitle", { count: found.length }), t("lists.share.foundHint", { name: listName }), "paste", num, total)}
      <div className="group" style={{ boxShadow: "none" }} id="wiz-found">
        {found.map((f, i) => (
          <button key={i} className="navrow wizfound" type="button" aria-pressed={f.on} data-wiz="found"
            onClick={() => setFound(found.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}>
            <span className={"wizcheck" + (f.on ? " on" : "")} aria-hidden="true">{f.on ? "✓" : ""}</span>
            <span className="grow">{f.name}{f.qty > 1 ? ` ×${f.qty}` : ""}</span>
            {f.other_list ? <span className="wiztag">{t("lists.share.onOther", { name: f.other_list })}</span> : null}
          </button>))}
      </div>
      <div className="sheetacts"><button className="btn primary" type="button" data-wiz="add" disabled={busy || !n} onClick={addAll}>{t("lists.share.add", { count: n })}</button></div></>;
  }
  if (step === "added" && result) return <>
    {head(t("lists.share.addedTitle", { count: result.added }), result.already ? t("lists.share.addedAlready", { count: result.already }) : "", null, 3, total)}
    {result.added >= 5 ? <p className="sub">{t("lists.share.tidyOffer")}</p> : null}
    <div className="sheetacts">
      {result.added >= 5 ? <button className="btn secondary" type="button" data-wiz="tidy" onClick={onTidy}>{t("lists.share.tidyBtn")}</button> : null}
      <button className="btn primary" type="button" data-wiz="done" onClick={onClose}>{t("lists.share.done")}</button></div></>;
  return <>
    {head(t("lists.share.title"), t("lists.share.sub", { name: listName, count: items.length }), null)}
    {row("share", t("lists.share.share"), t("lists.share.shareSub"), () => setStep("share"))}
    {row("export", t("lists.share.export"), t("lists.share.exportSub"), () => setStep("export"))}
    {row("import", t("lists.share.import"), t("lists.share.importSub"), () => setStep("paste"))}
    {cancel}</>;
}
