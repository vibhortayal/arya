import { useState } from "react";
import { ApiError, post } from "../lib/api";
import { asset } from "../lib/format";
import { charFor } from "../lib/characters";
import { useTranslation } from "../i18n";
import { Sheet } from "../ui/Sheet";

/* "From Alexa" (owner, 2026-11-03, mockup 93u3oRPsr5TeBzm9TFDwNo): only
 * the adds Arya was unsure about. A clear add goes straight to its list
 * and never shows here. Every row is already on a list, so the card only
 * asks for a check: Right keeps it (Undo reopens), Fix moves, renames or
 * removes it. The server (GET /api/alexa/review) answers 404 while the
 * hidden Alexa flag is off, on the demo and for API tokens: no card. */

export type Review = {
  id: string; item_id?: string | null; name: string; heard: string;
  kind: "guess" | "unchecked"; list_id: string; list_name: string; at: string;
};
type Body = { items?: unknown };

/* Rows the card can draw, newest first as the server sends them. */
export function reviewItems(raw: unknown): Review[] {
  const items = raw && typeof raw === "object" ? (raw as Body).items : null;
  if (!Array.isArray(items)) return [];
  return items.filter((r): r is Review => !!r && typeof r === "object"
    && typeof (r as Review).id === "string" && typeof (r as Review).name === "string" && (r as Review).name.trim() !== ""
    && typeof (r as Review).list_id === "string").map(r => ({ ...r, heard: String(r.heard || r.name), list_name: String(r.list_name || "") }));
}

type Props = {
  rows: Review[];
  lists: { id: string; name: string }[];
  setRows: (r: Review[]) => void;
  toast: (m: string, a?: { action: string; onAction: () => void }) => void;
};

export function AlexaCard({ rows, lists, setRows, toast }: Props) {
  const { t } = useTranslation();
  const [fix, setFix] = useState<Review | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!rows.length) return <div id="today-alexa" />;

  async function call(r: Review, what: string, body: object = {}): Promise<boolean> {
    setBusy(true);
    try { setRows(reviewItems(await post(`/api/alexa/review/${encodeURIComponent(r.id)}/${what}`, body))); return true; }
    catch (e) {
      // Already closed somewhere else (another phone, the list): drop the row.
      if (e instanceof ApiError && e.status === 404) { setRows(rows.filter(x => x.id !== r.id)); return true; }
      toast(e instanceof Error ? e.message : String(e)); return false;
    } finally { setBusy(false); }
  }
  async function right(r: Review) {
    if (await call(r, "confirm"))
      toast(t("today.alexa.kept", { name: r.name, list: r.list_name }), { action: t("common.undo"), onAction: () => { void call(r, "reopen"); } });
  }
  const close = () => { setFix(null); setNaming(null); };
  async function move(r: Review, listId: string, listName: string) {
    if (listId === r.list_id) return close();
    close();
    if (await call(r, "move", { list_id: listId })) toast(t("today.alexa.moved", { name: r.name, list: listName }));
  }
  async function rename(r: Review) {
    const name = (naming || "").trim();
    if (!name) return;
    close();
    if (await call(r, "rename", { name })) toast(t("today.alexa.renamed", { name }));
  }
  async function remove(r: Review) {
    close();
    if (await call(r, "remove")) toast(t("today.alexa.removed", { name: r.name, list: r.list_name }));
  }

  const face = (name: string) => {
    const c = charFor(name) || "basket.webp";
    return <img className="rowface" src={asset(`assets/characters/${c}`)} alt="" />;
  };
  return (
    <div id="today-alexa" className="alexa">
      <h3 className="sect">{t("today.cards.alexa.name")} <small>{t("today.alexa.toCheck", { count: rows.length })}</small></h3>
      <div className="group">
        {rows.map(r => (
          <div className="row" key={r.id} data-alexa-row={r.id}>
            {face(r.name)}
            <div className="grow">
              <span className="name">{r.name} <span className={"atag" + (r.kind === "guess" ? "" : " grey")}>{t(r.kind === "guess" ? "today.alexa.guess" : "today.alexa.unchecked")}</span></span>
              <span className="sub">{r.kind === "guess"
                ? <>{t("today.alexa.heard")} <q>{r.heard}</q> · {t("today.alexa.onList", { list: r.list_name })}</>
                : <>{t("today.alexa.notChecked")} · {t("today.alexa.onList", { list: r.list_name })}</>}</span>
            </div>
            <div className="aacts">
              <button type="button" className="chip ok" data-alexa-right disabled={busy} onClick={() => right(r)}>✓ {t("today.alexa.right")}</button>
              <button type="button" className="chip" data-alexa-fix disabled={busy} onClick={() => { setNaming(null); setFix(r); }}>{t("today.alexa.fix")}</button>
            </div>
          </div>
        ))}
      </div>
      <Sheet open={!!fix} onClose={close} id="alexa-fix" title={fix?.name ?? ""} focusKey={naming === null ? "pick" : "name"}>
        {fix && (naming === null ? (
          <div className="alexafix">
            <p className="muted heardline">{t("today.alexa.heard")} <q>{fix.heard}</q></p>
            <p className="sectlbl">{t("today.alexa.list")}</p>
            {lists.map(l => (
              <button key={l.id} type="button" className="navrow" data-alexa-move={l.id} aria-pressed={l.id === fix.list_id} onClick={() => move(fix, l.id, l.name)}>
                <span className="grow">{l.name}</span><span className="tick" aria-hidden="true">✓</span></button>
            ))}
            <p className="sectlbl">{t("today.alexa.item")}</p>
            <button type="button" className="navrow" data-alexa-edit onClick={() => setNaming(fix.name)}><span className="grow">{t("today.alexa.editName")}</span></button>
            <button type="button" className="navrow dangerrow" data-alexa-remove onClick={() => remove(fix)}><span className="grow">{t("today.alexa.remove", { list: fix.list_name })}</span></button>
          </div>
        ) : (
          <form className="alexafix" onSubmit={e => { e.preventDefault(); void rename(fix); }}>
            <p className="muted heardline">{t("today.alexa.heard")} <q>{fix.heard}</q></p>
            <input type="text" id="alexa-name" value={naming} maxLength={80} aria-label={t("today.alexa.editName")} onChange={e => setNaming(e.target.value)} />
            <div className="sheetacts">
              <button type="button" className="btn secondary" onClick={() => setNaming(null)}>{t("common.back")}</button>
              <button type="submit" className="btn primary" disabled={!naming.trim()}>{t("common.save")}</button>
            </div>
          </form>
        ))}
      </Sheet>
    </div>
  );
}
