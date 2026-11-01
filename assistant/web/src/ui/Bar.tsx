import { useEffect, useRef, useState, type ComponentType } from "react";
import { useNav } from "../app/nav";
import { useSavedBar, useSession } from "../app/session";
import { useTranslation } from "../i18n";
import { BAR_MAX, DEFAULT_BAR, barOf, litTab, moreOf, setShownBar, startView, type BarItem } from "../lib/bar";
import { EditList } from "./EditList";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { IconMore, TabAsk, TabHelp, TabLists, TabQuest, TabReceipts, TabSettings, TabSpending, TabStores, TabToday } from "./icons";

/* The bottom bar (owner, 2026-11-01): the shopper's four places, then
 * More, which never moves and opens a sheet with everything else.
 * Touch and hold the bar, or Customize bar in More, opens the editor:
 * the one edit mode (ui/EditList), saved at once with Undo. */

export const BAR_ICON: Record<BarItem, ComponentType> = {
  home: TabToday, list: TabLists, receipts: TabReceipts, "stores-mine": TabStores, analysis: TabSpending,
  chat: TabAsk, community: TabQuest, help: TabHelp, profile: TabSettings,
};
/* Names are en.json keys; the same words the Tour, guide, Help and Ask use. */
export const BAR_LABEL: Record<BarItem, string> = {
  home: "tabs.today", list: "tabs.lists", receipts: "tabs.receipts", "stores-mine": "tabs.stores", analysis: "tabs.spending",
  chat: "tabs.ask", community: "tabs.quest", help: "tabs.help", profile: "tabs.settings",
};

/* The Tour's "Customize now" and Help open the editor from anywhere. */
let opener: ((s: "more" | "edit" | null) => void) | null = null;
export function openBarEditor() { opener?.("edit"); }
/* The Tour's More and "Make the bar yours" steps open the More sheet
 * and close it when they move on. */
export function openMoreSheet() { opener?.("more"); }
export function closeBarSheets() { opener?.(null); }

export function useBar(): BarItem[] {
  const bar = barOf(useSavedBar());
  setShownBar(bar);
  return bar;
}

const HOLD_MS = 550;

export function BottomBar() {
  const nav = useNav();
  const bar = useBar();
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<"more" | "edit" | null>(null);
  const hold = useRef<number | null>(null);
  const held = useRef(false);
  useEffect(() => {
    opener = s => setSheet(s);
    return () => { opener = null; };
  }, []);
  // Without Today on the bar, the app opens on the first place instead.
  const key = bar.join();
  useEffect(() => {
    if (nav.depth === 1 && nav.view === "home" && !bar.includes("home")) nav.replace(startView(bar));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const lit = litTab(nav.view, bar);
  // Touch and hold anywhere on the bar opens the editor, as a home
  // screen does; a hold never also counts as a tap.
  const down = () => { held.current = false; hold.current = window.setTimeout(() => { held.current = true; setSheet("edit"); }, HOLD_MS); };
  const cancel = () => { if (hold.current) window.clearTimeout(hold.current); hold.current = null; };
  const tap = (fn: () => void) => () => { if (held.current) { held.current = false; return; } fn(); };
  return (
    <>
      <nav id="tabs" aria-label={t("tabs.label")} onPointerDown={down} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
        onContextMenu={e => e.preventDefault()}>
        {bar.map(v => {
          const Icon = BAR_ICON[v];
          const on = lit === v && sheet !== "more";
          return (
            <button key={v} type="button" data-view={"view-" + v} className={on ? "active" : undefined} aria-current={on ? "page" : undefined}
              onClick={tap(() => nav.tab(v))}>
              <Icon /><span>{t(BAR_LABEL[v])}</span>
            </button>
          );
        })}
        <button type="button" data-view="more" id="tab-more" className={lit === "more" || sheet === "more" ? "active" : undefined} aria-haspopup="dialog"
          aria-current={lit === "more" ? "page" : undefined} onClick={tap(() => setSheet("more"))}>
          <IconMore /><span>{t("tabs.more")}</span>
        </button>
      </nav>
      <Sheet open={sheet === "more"} onClose={() => setSheet(null)} title={t("bar.moreTitle")} id="more-sheet">
        <p className="muted small edithint">{t("bar.moreHint")}</p>
        <div className="more-rows">
          {moreOf(bar).map(v => {
            const Icon = BAR_ICON[v];
            return (
              <button key={v} type="button" className="navrow more-row" data-more={v} onClick={() => { setSheet(null); nav.tab(v); }}>
                <span className="more-ic" aria-hidden="true"><Icon /></span>
                <span className="grow">{t(BAR_LABEL[v])}<small>{t(`bar.sub.${v}`)}</small></span><span className="chev" aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="btn wide" id="bar-customize" onClick={() => setSheet("edit")}>{t("bar.customize")}</button>
      </Sheet>
      <Sheet open={sheet === "edit"} onClose={() => setSheet(null)} title={t("bar.title")} id="bar-editor" closeLabel={t("common.done")}>
        <BarEditor />
      </Sheet>
    </>
  );
}

function BarEditor() {
  const { t } = useTranslation();
  const { layouts, saveLayout } = useSession();
  const { toast } = useToast();
  const bar = barOf(layouts?.bar?.on);
  const name = (v: BarItem) => t(BAR_LABEL[v]);
  const sub = (v: BarItem) => t(`bar.sub.${v}`);
  const save = (next: BarItem[], msg?: string) => {
    const prev = bar;
    void saveLayout("bar", { on: next });
    if (msg) toast(msg, { action: t("common.undo"), onAction: () => { void saveLayout("bar", { on: prev }); } });
  };
  const change = (next: BarItem[], msg?: string) => {
    const added = next.find(v => !bar.includes(v));
    if (added) {
      if (bar.length >= BAR_MAX) { toast(t("bar.full")); return; }
      // A new place goes at the end, beside More, where the eye lands.
      save([...bar, added], t("bar.added", { name: name(added) }));
      return;
    }
    const gone = bar.find(v => !next.includes(v));
    if (gone) { save(next, t("bar.removed", { name: name(gone) })); return; }
    save(next, msg);
  };
  return (
    <>
      <div className="bar-preview" aria-hidden="true">
        {[...bar, "more" as const].map(v => {
          const Icon = v === "more" ? IconMore : BAR_ICON[v];
          return <span key={v}><Icon /><span>{v === "more" ? t("tabs.more") : name(v)}</span></span>;
        })}
      </div>
      <EditList<BarItem> id="bar-edit" on={bar} off={moreOf(bar)} name={name} sub={sub} desc={sub} onChange={change}
        hint={t("bar.hint")} moreTitle={t("bar.offTitle")}
        locked={() => bar.length <= 1}
        full={bar.length >= BAR_MAX ? t("bar.full") : undefined}
        onReset={bar.join() === DEFAULT_BAR.join() ? undefined : () => { save(DEFAULT_BAR); toast(t("bar.resetDone")); }}
        resetLabel={t("bar.reset")} />
    </>
  );
}
