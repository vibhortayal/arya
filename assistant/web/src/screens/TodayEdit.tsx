import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Sheet } from "../ui/Sheet";
import { useTranslation } from "../i18n";
import { addCard, cardsOff, moveCard, removeCard, FOCUS_IDS, type CardId, type FocusId } from "./todayCards";

/* Customizable Today, edited in place the way a phone home screen is
 * (owner, 2026-10-30, "think how modern OS do it"): touch and hold a
 * card for a short menu, or Edit for edit mode. In edit mode each card
 * is one line with a red minus to remove it and a grip to drag it;
 * the cards that are off sit under More cards with a green plus. Every
 * change saves at once and the toast offers Undo; nothing asks "Are
 * you sure?". */

const Grip = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M5 8h14M5 12h14M5 16h14" />
  </svg>
);

type EditProps = {
  on: CardId[];
  has: Record<CardId, boolean>;
  peek: (id: CardId) => string;
  onChange: (next: CardId[], msg?: string) => void;
  onReset: () => void;
};

export function TodayEdit({ on, has, peek, onChange, onReset }: EditProps) {
  const { t } = useTranslation();
  const name = (id: CardId) => t(`today.cards.${id}.name`);
  // The order while a finger drags; saved when it lifts.
  const [order, setOrder] = useState(on);
  const [drag, setDrag] = useState<CardId | null>(null);
  const tiles = useRef<Partial<Record<CardId, HTMLDivElement | null>>>({});
  useEffect(() => { if (!drag) setOrder(on); }, [on, drag]);

  function down(e: PointerEvent<HTMLButtonElement>, id: CardId) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(id);
  }
  function move(e: PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const rest = order.filter(c => c !== drag);
    let to = rest.length;
    for (let k = 0; k < rest.length; k++) {
      const r = tiles.current[rest[k]]?.getBoundingClientRect();
      if (r && e.clientY < r.top + r.height / 2) { to = k; break; }
    }
    const next = moveCard(order, drag, to);
    if (next.join() !== order.join()) setOrder(next);
  }
  function up() {
    if (!drag) return;
    setDrag(null);
    if (order.join() !== on.join()) onChange(order);
  }
  function key(e: KeyboardEvent<HTMLButtonElement>, id: CardId) {
    const k = on.indexOf(id);
    if (e.key === "ArrowUp" && k > 0) { e.preventDefault(); onChange(moveCard(on, id, k - 1)); }
    if (e.key === "ArrowDown" && k < on.length - 1) { e.preventDefault(); onChange(moveCard(on, id, k + 1)); }
  }

  const off = cardsOff(on);
  return (
    <div id="today-edit">
      <p className="muted small edithint">{t("today.edit.hint")}</p>
      <div className="etiles">
        {order.map(id => (
          <div key={id} data-tile={id} className={"etile" + (drag === id ? " lifted" : "")} ref={el => { tiles.current[id] = el; }}>
            <button type="button" className="eminus" aria-label={t("today.edit.remove", { name: name(id) })}
              onClick={() => onChange(removeCard(on, id), t("today.edit.removed", { name: name(id) }))}><span className="ebadge" aria-hidden="true">−</span></button>
            <span className="grow"><b>{name(id)}</b><span className="sub">{has[id] ? peek(id) : t("today.cards.waiting")}</span></span>
            <button type="button" className="egrip" aria-label={t("today.edit.move", { name: name(id) })}
              onPointerDown={e => down(e, id)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              onKeyDown={e => key(e, id)}><Grip /></button>
          </div>
        ))}
      </div>
      <h3 className="sect">{t("today.edit.more")}</h3>
      {off.length ? (
        <div className="etiles">
          {off.map(id => (
            <button key={id} type="button" data-add={id} className="etile eadd" aria-label={t("today.edit.add", { name: name(id) })}
              onClick={() => onChange(addCard(on, id), t("today.edit.added", { name: name(id) }))}>
              <span className="ebadge eplus" aria-hidden="true">+</span>
              <span className="grow"><b>{name(id)}</b><span className="sub">{t(`today.cards.${id}.desc`)}</span></span>
            </button>
          ))}
        </div>
      ) : <p className="muted small edithint">{t("today.edit.allOn")}</p>}
      <button type="button" className="linkbtn editreset" onClick={onReset}>{t("today.edit.reset")}</button>
    </div>
  );
}

/* Touch and hold a card: a short menu next to it. */
type MenuProps = { id: CardId; top: number; first: boolean; last: boolean; onEdit: () => void; onMove: (d: -1 | 1) => void; onRemove: () => void; onClose: () => void };

export function CardMenu({ id, top, first, last, onEdit, onMove, onRemove, onClose }: MenuProps) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus moves into the menu (Tab reaches the items) without a ring
    // on an item the finger did not choose.
    box.current?.focus();
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  // Keep the menu on screen: under the finger, or above the tab bar.
  const y = Math.max(16, Math.min(top, window.innerHeight - 290));
  const act = (f: () => void) => () => { onClose(); f(); };
  return (
    <div className="cardmenu-wrap" onClick={onClose}>
      <div className="cardmenu" role="menu" aria-label={t("today.menu.label")} ref={box} tabIndex={-1} style={{ top: y }} onClick={e => e.stopPropagation()}>
        <p className="cm-name">{t(`today.cards.${id}.name`)}</p>
        <button type="button" role="menuitem" onClick={act(onEdit)}>{t("today.menu.edit")}</button>
        <button type="button" role="menuitem" disabled={first} onClick={act(() => onMove(-1))}>{t("today.menu.up")}</button>
        <button type="button" role="menuitem" disabled={last} onClick={act(() => onMove(1))}>{t("today.menu.down")}</button>
        <button type="button" role="menuitem" className="cm-danger" onClick={act(onRemove)}>{t("today.menu.remove")}</button>
      </div>
    </div>
  );
}

/* The one question (asked once, after the first list): the picks lead
 * Today; nothing is removed. */
export function AskSheet({ onDone, onSkip }: { onDone: (picked: FocusId[]) => void; onSkip: () => void }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<FocusId[]>([]);
  const flip = (f: FocusId) => setPicked(p => (p.includes(f) ? p.filter(x => x !== f) : [...p, f]));
  return (
    <Sheet open id="today-ask" onClose={onSkip} title={t("today.ask.title")} closeLabel={t("common.skip")}>
      <p className="muted askline">{t("today.ask.line")}</p>
      <div className="asklist">
        {FOCUS_IDS.map(f => (
          <button key={f} type="button" className="navrow" data-focus={f} aria-pressed={picked.includes(f)} onClick={() => flip(f)}>
            <span>{t(`today.ask.${f}`)}<small>{t(`today.ask.${f}Sub`)}</small></span>
            <span className="tick" aria-hidden="true">✓</span>
          </button>
        ))}
      </div>
      <div className="sheetacts">
        <button type="button" className="btn primary wide" disabled={!picked.length} onClick={() => onDone(picked)}>{t("today.ask.go")}</button>
      </div>
    </Sheet>
  );
}
