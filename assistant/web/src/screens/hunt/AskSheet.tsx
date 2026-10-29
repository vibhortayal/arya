import { useEffect, useRef, useState, type ReactNode } from "react";
import { post } from "../../lib/api";
import { Sheet } from "../../ui/Sheet";
import { useToast } from "../../ui/Toast";
import { Q, qCurrentIndex } from "./model";
import { useRecord } from "./useRecord";
import { useTranslation } from "../../i18n";

/* Ask Arya during a hunt (pwa/huntask.js + aryaask.js run/show with
 * surface "hunt"): three quick questions and a field plus mic. The
 * context names the store, the stop on screen and what is left. The
 * shared lists/AskCard useAsk always posts surface "list", so this
 * keeps its own copy of the answer card. */

const QUICK = ["Where's the {item}?", "Is there a cheaper one?", "I can't find it"];

function context(): Record<string, unknown> {
  const sess = Q.current;
  if (!sess) return {};
  const i = qCurrentIndex(sess), it = i >= 0 ? sess.items[i] : null;
  const ctx: Record<string, unknown> = { hunt: sess.store, left: sess.items.filter(x => !x.checked).map(x => x.name).slice(0, 12) };
  if (it) {
    ctx.next_item = it.name;
    if (it.shelf_label) ctx.aisle = it.shelf_label;
  }
  return ctx;
}

type Res = { reply?: string; applied?: string[]; skipped?: string[]; added?: { item_id: string }[]; proposed?: { text: string; action: unknown }[] };
type Card = { q: string; res: Res | null };

const MIC = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></svg>;

export function AskSheet({ open, onClose, onChange }: { open: boolean; onClose: () => void; onChange: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const ctx = open ? context() : {};
  const rec = useRecord(t => send(t));
  // Closing the sheet lets the microphone go.
  const cancelRec = useRef(rec.cancel);
  cancelRec.current = rec.cancel;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) cancelRec.current();
    wasOpen.current = open;
  }, [open]);

  async function send(raw: string) {
    const t = String(raw || "").trim();
    if (!t) return;
    setText("");
    setCard({ q: t, res: null });
    try {
      const res = await post<Res>("/api/chat", { messages: [{ role: "user", content: t }], surface: "hunt", context: context() });
      setCard({ q: t, res });
      if ((res.added || []).length || (res.applied || []).length) onChange();
    } catch (e) { setCard(null); toast(e instanceof Error ? e.message : String(e)); }
  }

  const act = async (res: Res, what: "yes" | "undo") => {
    setBusy(true);
    try {
      if (what === "yes") {
        const r = await post<{ applied?: string[] }>("/api/chat/apply", { actions: (res.proposed || []).map(p => p.action) });
        setCard(null);
        toast((r.applied || []).join(" ") || "Done.");
      } else {
        for (const a of res.added || []) await post("/api/list/remove", { item_id: a.item_id });
        setCard(null);
        toast("Undone.");
      }
      onChange();
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  let answer: ReactNode = null;
  if (card) {
    let body: ReactNode, buttons: ReactNode = null;
    const res = card.res;
    if (!res) body = "Arya is thinking…";
    else {
      const added = res.added || [], proposed = res.proposed || [];
      const said = res.reply || (res.applied || []).join(" ") || "Done.";
      const skipped = (res.skipped || []).map((s, i) => <span key={i} className="sub">{s}</span>);
      if (proposed.length) {
        body = <>{skipped}<strong>{proposed.map(p => p.text).join(" ")}</strong></>;
        buttons = <>
          <button className="btn secondary" type="button" data-aa="no" onClick={() => setCard(null)}>{t("common.notNow")}</button>
          <button className="btn primary" type="button" data-aa="yes" disabled={busy} onClick={() => act(res, "yes")}>{proposed.length > 1 ? "Yes, do these" : "Yes, do it"}</button></>;
      } else if (added.length) {
        body = <>{said}{skipped}</>;
        buttons = <>
          <button className="btn secondary" type="button" data-aa="undo" disabled={busy} onClick={() => act(res, "undo")}>{t("common.undo")}</button>
          <button className="btn primary" type="button" data-aa="done" onClick={() => setCard(null)}>{t("common.done")}</button></>;
      } else {
        body = <>{said}{skipped}</>;
        buttons = <button className="btn secondary" type="button" data-aa="done" onClick={() => setCard(null)}>{t("common.gotIt")}</button>;
      }
    }
    answer = (
      <div className="group pad answercard" role="status">
        <p className="muted nomargin" style={{ fontSize: 14 }}>{card.q}</p>
        <p style={{ margin: "4px 0 0" }}>{body}</p>
        {buttons ? <div className="sheetacts">{buttons}</div> : null}
      </div>
    );
  }

  const close = () => { setCard(null); setText(""); onClose(); };
  return (
    <Sheet open={open} onClose={close} id="ask-sheet" labelledBy="ask-title">
      <span className="sheetgrip" />
      <h3 id="ask-title" className="largetitle" style={{ fontSize: 22 }}>{t("common.askArya")}</h3>
      <div className="chiprow">
        {QUICK.map(q => q.replace("{item}", (ctx.next_item as string) || "next item")).map(q => (
          <button key={q} className="chip" type="button" data-q={q} onClick={() => send(q)}>{q}</button>
        ))}
      </div>
      <div className="addline">
        <input type="text" id="ask-text" placeholder={t("common.askAnything")} autoComplete="off" enterKeyHint="send" data-first
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); send(text); } }} />
        <button id="ask-mic" className={"iconbtn" + (rec.listening ? " listening" : "")} type="button" aria-label={t("hunt.askByVoice")} onClick={rec.click}>{MIC}</button>
        <button id="ask-go" className="btn primary" type="button" onClick={() => send(text)}>{t("common.ask")}</button>
      </div>
      <p id="ask-status" className="muted nomargin">{rec.status}</p>
      <div id="ask-answer">{answer}</div>
      <div className="sheetacts"><button className="btn secondary" type="button" data-ask="close" onClick={close}>{t("common.close")}</button></div>
    </Sheet>
  );
}
