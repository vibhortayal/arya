import { useCallback, useState, type ReactNode } from "react";
import { withBar } from "../../lib/bar";
import { post } from "../../lib/api";
import { useToast } from "../../ui/Toast";
import type { NamedList } from "./model";
import { t } from "../../i18n";

/* Port of pwa/aryaask.js: the Lists field and mic talk to Arya from
 * where you already are. The answer is a small card under the field. */

const ASK_LEAD = /^(i'?m out|i am out|we'?re out|we are out|out of |we finished|we ran out|we need to know|when |what |where |how |is |are |do |does |can |should |which |why |who |tell me|remind me)/i;
export function looksLikeAsk(t: string): boolean {
  t = String(t || "").trim();
  return !!t && (/\?$/.test(t) || ASK_LEAD.test(t));
}

/* "add naan to Indian Store" -> {items: "naan", list} when the last
 * words name one of the household's lists. */
export type AddToList = { items: string; list: NamedList };
export function parseAddToList(t: string, lists: NamedList[]): AddToList | null {
  const m = String(t || "").trim().match(/^add\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(.+?)\s*$/i);
  if (!m) return null;
  const list = (lists || []).find(l => l.name.toLowerCase() === m[2].toLowerCase());
  return list ? { items: m[1], list } : null;
}

type Res = { reply?: string; applied?: string[]; skipped?: string[]; added?: { item_id: string }[]; proposed?: { text: string; action: unknown }[] };
type Card = { q: string; kind: "thinking" } | { q: string; kind: "show"; res: Res };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useAsk(onChange: () => void) {
  const { toast } = useToast();
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const clear = useCallback(() => setCard(null), []);

  /* Ask Arya. Resolves true when an answer was shown, false when it
   * failed (the caller may keep dictated text in the field). */
  const run = useCallback(async (text: string, context: Record<string, unknown>): Promise<boolean> => {
    setCard({ q: text, kind: "thinking" });
    try {
      const res = await post<Res>("/api/chat", withBar({ messages: [{ role: "user", content: text }], surface: "list", context }));
      setCard({ q: text, kind: "show", res });
      if ((res.added || []).length || (res.applied || []).length) onChange();
      return true;
    } catch (e) { setCard(null); toast(errMsg(e)); return false; }
  }, [onChange, toast]);

  /* The deterministic "add naan to Indian Store": no model call. */
  const addToList = useCallback(async (q: string, parsed: AddToList) => {
    const r = await post<{ item_ids?: string[]; names?: string[] }>("/api/list/from-text", { text: parsed.items, list_id: parsed.list.id });
    const names = (r.names || []).join(", ");
    setCard({ q, kind: "show", res: {
      reply: r.names && r.names.length ? t("lists.ask.addedTo", { names, list: parsed.list.name }) : t("lists.ask.alreadyOn", { list: parsed.list.name }),
      added: (r.item_ids || []).map(item_id => ({ item_id })) } });
    onChange();
  }, [onChange]);

  const act = async (res: Res, what: "no" | "yes" | "undo" | "done") => {
    if (what === "no" || what === "done") { clear(); return; }
    setBusy(true);
    try {
      if (what === "yes") {
        const r = await post<{ applied?: string[] }>("/api/chat/apply", { actions: (res.proposed || []).map(p => p.action) });
        clear();
        toast((r.applied || []).join(" ") || t("common.doneDot"));
      } else {
        for (const a of res.added || []) await post("/api/list/remove", { item_id: a.item_id });
        clear();
        toast(t("common.undone"));
      }
      onChange();
    } catch (e) { toast(errMsg(e)); }
    setBusy(false);
  };

  let node: ReactNode = null;
  if (card) {
    let body: ReactNode, buttons: ReactNode = null;
    if (card.kind === "thinking") body = t("common.aryaThinking");
    else {
      const res = card.res;
      const added = res.added || [], proposed = res.proposed || [];
      const said = res.reply || (res.applied || []).join(" ") || t("common.doneDot");
      const skipped = (res.skipped || []).map((s, i) => <span key={i} className="sub">{s}</span>);
      if (proposed.length) {
        body = <>{skipped}<strong>{proposed.map(p => p.text).join(" ")}</strong></>;
        buttons = <>
          <button className="btn secondary" type="button" data-aa="no" onClick={() => act(res, "no")}>{t("common.notNow")}</button>
          <button className="btn primary" type="button" data-aa="yes" disabled={busy} onClick={() => act(res, "yes")}>{proposed.length > 1 ? t("common.yesDoThese") : t("common.yesDoIt")}</button></>;
      } else if (added.length) {
        body = <>{said}{skipped}</>;
        buttons = <>
          <button className="btn secondary" type="button" data-aa="undo" disabled={busy} onClick={() => act(res, "undo")}>{t("common.undo")}</button>
          <button className="btn primary" type="button" data-aa="done" onClick={() => act(res, "done")}>{t("common.done")}</button></>;
      } else {
        body = <>{said}{skipped}</>;
        buttons = <button className="btn secondary" type="button" data-aa="done" onClick={() => act(res, "done")}>{t("common.gotIt")}</button>;
      }
    }
    node = (
      <div className="group pad answercard" role="status">
        <p className="muted nomargin" style={{ fontSize: 14 }}>{card.q}</p>
        <p style={{ margin: "4px 0 0" }}>{body}</p>
        {buttons ? <div className="sheetacts">{buttons}</div> : null}
      </div>
    );
  }
  return { node, run, addToList, clear };
}
