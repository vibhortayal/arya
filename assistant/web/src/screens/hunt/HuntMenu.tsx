import { useEffect, useState } from "react";
import { get } from "../../lib/api";
import { qtyTag } from "../../lib/format";
import { Sheet } from "../../ui/Sheet";
import { useToast } from "../../ui/Toast";
import { Q, qIsReportedByMe, qStops, type Session } from "./model";
import {
  NAME_MAX, NOTE_MAX, QTY_MAX, QTY_MIN, afterMutation, applyEdit, huntSubstitutes, leaveItems, mutate, nrm,
  offline, online, restoreItems,
} from "./menu";
import { useTranslation } from "../../i18n";

/* The hunt menu sheet (pwa/huntmenu.js #hunt-sheet): the row menu
 * (find, swap, it moved, save, drop, quantity and note), "Can't find
 * it?", the swap and edit sheets, and the leave sheet that "I'm done
 * shopping" raises while items are still open. One sheet, its content
 * swapped in place. Express can raise "moved" too. */

export type MenuKind = "row" | "moved" | "swap" | "edit" | "leave";
export type MenuState = { kind: MenuKind; name: string } | null;

type Props = {
  menu: MenuState;
  setMenu: (m: MenuState) => void;
  sess: Session;
  /* Find it for me on this item (the Shelf Scan aimed at it). */
  onFind: (name: string) => void;
  /* "Tell other Arya shoppers it is gone": the Not here report sheet. */
  onTell: (idx: number) => void;
  /* After the leave sheet's Check out (opens Finish). */
  onCheckout: (n: number, undo: () => Promise<void>) => void;
};

const Opt = ({ act, title, desc, onClick }: { act: string; title: string; desc: string; onClick: () => void }) => (
  <button type="button" className="hm-opt" data-act={act} onClick={onClick}><b>{title}</b><span className="sub">{desc}</span></button>
);

const focusAfter = () => setTimeout(() => document.querySelector<HTMLElement>("#hunt-list [data-more]")?.focus(), 0);

export function openItems(sess: Session) {
  return (sess.items || []).filter(i => !i.checked && !qIsReportedByMe(sess, i));
}

export function HuntMenu({ menu, setMenu, sess, onFind, onTell, onCheckout }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const close = () => setMenu(null);
  const idx = menu ? sess.items.findIndex(i => i.name === menu.name) : -1;
  const it = idx >= 0 ? sess.items[idx] : null;
  const name = menu?.name || "";

  // Swap reads the household's receipt history once.
  const [, setPlanTick] = useState(0);
  useEffect(() => {
    if (menu?.kind !== "swap" || (Q.plan && Q.plan.items)) return;
    let live = true;
    get("/api/quest/plan").then(p => { Q.plan = p; }).catch(() => { Q.plan = { list: [], items: [] }; })
      .finally(() => { if (live) setPlanTick(n => n + 1); });
    return () => { live = false; };
  }, [menu?.kind]);

  // Leave sheet choices; edit stepper and fields.
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [own, setOwn] = useState("");
  useEffect(() => {
    if (!menu) return;
    if (menu.kind === "leave") {
      const c: Record<string, string> = {};
      sess.items.filter(i => !i.checked).forEach(i => { c[i.name] = "saved"; });
      setChoice(c);
      setLeaveBusy(false);
    }
    if (menu.kind === "edit" && it) { setQty(Number(it.qty) || 1); setNote(it.note || ""); }
    if (menu.kind === "swap") setOwn("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu?.kind, menu?.name]);

  if (!menu) return null;
  if (menu.kind !== "leave" && !it) return null;

  const find = () => {
    if (sess.state !== "playing") { toast(t("hunt.startFirst")); return; }
    close();
    onFind(name);
  };
  const leaveOne = async (how: "saved" | "dropped") => {
    close();
    const moved = await leaveItems(toast, sess, [{ item: name, how }]);
    if (!moved) return;
    toast(how === "saved" ? t("hunt.savedForNext", { name }) : t("hunt.droppedForToday", { name }),
      { action: t("common.undo"), onAction: () => { restoreItems(toast, sess, moved); } });
    focusAfter();
  };

  let title = "", sub = "", body: React.ReactNode = null;

  if (menu.kind === "row" && it) {
    const reported = qIsReportedByMe(sess, it);
    title = name;
    sub = reported ? t("hunt.youToldShoppers") : "";
    body = <>
      <div className="hm-opts">
        {reported ? <>
          <Opt act="save" title={t("hunt.saveForNextTrip")} desc={t("hunt.itComesFirstOnYour")} onClick={() => leaveOne("saved")} />
          <Opt act="drop" title={t("hunt.donTNeedItToday")} desc={t("hunt.yourReportStaysNothingIs")} onClick={() => leaveOne("dropped")} />
        </> : <>
          <Opt act="find" title={t("hunt.findItForMe")} desc={t("hunt.pointYourCameraAtThe")} onClick={find} />
          <Opt act="swap" title={t("hunt.swapIt")} desc={t("hunt.pickASubstituteYourQuantity")}
            onClick={() => { if (offline()) { toast(t("hunt.swapNeedsSignal")); return; } setMenu({ kind: "swap", name }); }} />
          <Opt act="moved" title={t("hunt.itMoved")} desc={t("hunt.lookAgainOrTellOther")} onClick={() => setMenu({ kind: "moved", name })} />
          <Opt act="save" title={t("hunt.saveForNextTrip")} desc={t("hunt.itComesFirstOnYour")} onClick={() => leaveOne("saved")} />
          <Opt act="drop" title={t("hunt.donTNeedItToday")} desc={t("hunt.noReportNothingIsLost")} onClick={() => leaveOne("dropped")} />
          <Opt act="edit" title={t("hunt.changeQuantityOrNote")} desc={t("hunt.fixHowManyOrAdd")} onClick={() => setMenu({ kind: "edit", name })} />
        </>}
      </div>
      <button type="button" className="btn wide" data-act="close" onClick={close}>{t("common.close")}</button>
    </>;
  } else if (menu.kind === "moved" && it) {
    const stop = qStops(sess)[idx];
    title = t("hunt.cantFind", { name });
    sub = t("hunt.lastSeen", { where: stop && stop.shelfLabel ? stop.shelfLabel : t("hunt.notPlacedYet") });
    body = <>
      <button type="button" className="btn primary wide hm-main" data-act="find" data-first onClick={find}>{t("hunt.findItForMe")}</button>
      <button type="button" className="btn wide" data-act="tell" onClick={() => { close(); onTell(idx); }}>{t("hunt.tellOtherShoppersItIs")}</button>
      <button type="button" className="btn wide" data-act="keep" onClick={close}>{t("common.keepLooking")}</button>
    </>;
  } else if (menu.kind === "swap" && it) {
    const subs = Q.plan && Q.plan.items ? huntSubstitutes(sess, Q.plan.items, name, sess.store, 3) : [];
    const doSwap = async (raw: string) => {
      const to = String(raw || "").trim();
      if (!to) { toast(t("hunt.typeNameFirst")); return; }
      close();
      const s = await online(toast, sess, "swap", { item: name, to });
      if (!s) return;
      const j = sess.items.findIndex(i => nrm(i.name) === nrm(to) || i.swapped_from === name);
      const subName = j >= 0 ? sess.items[j].name : to;
      Q.focusIdx = j;
      Q.repaint?.();
      toast(t("hunt.swappedFor", { sub: subName, name }), { action: t("common.undo"), onAction: async () => {
        if (await online(toast, sess, "unswap", { to: subName })) afterMutation(sess);
      } });
    };
    title = t("hunt.swapTitle", { name });
    sub = t("hunt.swapSub", { name });
    body = <>
      {subs.length
        ? <div className="hm-opts">{subs.map((s, k) => (
          <button key={k} type="button" className="hm-opt" data-act="pick" data-k={k} onClick={() => doSwap(s.name)}><b>{s.name}</b>
            <span className="sub">{s.here ? t("hunt.boughtHere", { count: s.here }) : t("hunt.boughtElsewhere")}</span></button>
        ))}</div>
        : <p className="sub">{t("hunt.yourReceiptsShowNoClose")}</p>}
      <label className="hm-label" htmlFor="hm-own">{t("hunt.typeMyOwn")}</label>
      <div className="hm-addrow">
        <input type="text" id="hm-own" className="hm-addinput" maxLength={NAME_MAX} autoComplete="off" enterKeyHint="done"
          value={own} onChange={e => setOwn(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); doSwap(own); } }} />
        <button type="button" className="btn primary" data-act="own" onClick={() => doSwap(own)}>{t("hunt.use")}</button>
      </div>
      <button type="button" className="btn wide" data-act="close" onClick={close}>{t("common.cancel")}</button>
    </>;
  } else if (menu.kind === "edit" && it) {
    const prev = { qty: Number(it.qty) || 1, note: it.note || "" };
    const save = async () => {
      const n = note.trim();
      if (qty === prev.qty && n === prev.note) { close(); return; }
      close();
      const body = { item: name, qty, note: n };
      const r = await mutate(toast, sess, "edit", body, s => applyEdit(s, name, qty, n));
      if (!r.ok) return;
      afterMutation(sess);
      toast(t("hunt.updated", { name }), { action: t("common.undo"), onAction: async () => {
        const back = { item: name, qty: prev.qty, note: prev.note };
        await mutate(toast, sess, "edit", back, s => applyEdit(s, name, back.qty, back.note));
        afterMutation(sess);
      } });
      focusAfter();
    };
    title = name;
    sub = t("hunt.fixHowManyOrAdd");
    body = <>
      <div className="row hm-stepper"><span className="name" id="hm-qlabel">{t("common.quantity")}</span>
        <div className="hm-step" role="group" aria-labelledby="hm-qlabel">
          <button type="button" className="hm-stepbtn" data-act="minus" aria-label={t("hunt.oneFewer")} onClick={() => setQty(q => Math.max(QTY_MIN, q - 1))}>-</button>
          <b id="hm-qty" aria-live="polite">{qty}</b>
          <button type="button" className="hm-stepbtn" data-act="plus" aria-label={t("common.oneMore")} onClick={() => setQty(q => Math.min(QTY_MAX, q + 1))}>+</button>
        </div></div>
      <label className="hm-label" htmlFor="hm-note">{t("hunt.noteSizeBrandForWhom")}</label>
      <input type="text" id="hm-note" className="hm-addinput hm-wide" maxLength={NOTE_MAX} autoComplete="off"
        value={note} onChange={e => setNote(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />
      <button type="button" className="btn primary wide hm-main" data-act="save" onClick={save}>{t("common.save")}</button>
      <button type="button" className="btn wide" data-act="close" onClick={close}>{t("common.cancel")}</button>
    </>;
  } else if (menu.kind === "leave") {
    const open = sess.items.filter(i => !i.checked);
    const checkout = async () => {
      setLeaveBusy(true);
      const entries = open.map(i => ({ item: i.name, how: choice[i.name] || "saved" }));
      const moved = await leaveItems(toast, sess, entries);
      if (!moved) { setLeaveBusy(false); return; }
      close();
      onCheckout(moved.length, () => restoreItems(toast, sess, moved));
    };
    title = t("hunt.leaveTitle", { n: open.length });
    sub = t("hunt.nothingLost");
    body = <>
      <div className="group hm-leavelist">
        {open.map((i, k) => (
          <div key={i.name} className="row hm-leaverow">
            <div className="grow"><span className="name">{i.name}{qtyTag(i) ? ` - ${qtyTag(i)}` : ""}</span>
              {qIsReportedByMe(sess, i) ? <span className="sub">{t("common.reportedMissing")}</span> : null}</div>
            <div className="hm-seg" role="group" aria-label={t("hunt.whatToDoWith", { name: i.name })}>
              {(["saved", "dropped"] as const).map(how => (
                <button key={how} type="button" className="hm-segbtn" data-act="how" data-k={k} data-how={how}
                  aria-pressed={(choice[i.name] || "saved") === how}
                  onClick={() => setChoice(c => ({ ...c, [i.name]: how }))}>{how === "saved" ? t("hunt.nextTrip") : t("hunt.drop")}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn primary wide hm-main" data-act="checkout" disabled={leaveBusy} onClick={checkout}>{t("common.checkOut")}</button>
      <button type="button" className="btn wide" data-act="keep" data-first onClick={close}>{t("common.keepHunting")}</button>
    </>;
  }

  return (
    <Sheet open onClose={close} id="hunt-sheet" labelledBy="hm-title" focusKey={menu.kind + "|" + menu.name}>
      <h3 className="hm-title" id="hm-title">{title}</h3>
      {sub ? <p className="sub hm-sub">{sub}</p> : null}
      {body}
    </Sheet>
  );
}
