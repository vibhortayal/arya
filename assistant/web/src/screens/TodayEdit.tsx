import { useEffect, useRef, useState } from "react";
import { Sheet } from "../ui/Sheet";
import { EditList } from "../ui/EditList";
import { useTranslation } from "../i18n";
import { cardsOff, CARD_GROUP, FOCUS_IDS, LIBRARY_GROUPS, SIZES_OF, type CardId, type FocusId, type LibraryGroup, type Size } from "./todayCards";

/* Customizable Today, edited in place the way a phone home screen is
 * (owner, 2026-10-30, "think how modern OS do it"): touch and hold a
 * card for a short menu, or Edit for edit mode (ui/EditList.tsx, the
 * edit mode every screen shares). Tapping a card in edit mode picks
 * its size; the cards that are off sit in the card library below,
 * each with a live preview. */

type EditProps = {
  on: CardId[];
  has: Record<CardId, boolean>;
  peek: (id: CardId) => string;
  size: (id: CardId) => Size;
  onChange: (next: CardId[], msg?: string) => void;
  onSize: (id: CardId, s: Size) => void;
  onReset: () => void;
};

export function TodayEdit({ on, has, peek, size, onChange, onSize, onReset }: EditProps) {
  const { t } = useTranslation();
  const name = (id: CardId) => t(`today.cards.${id}.name`);
  const [open, setOpen] = useState<CardId | null>(null);
  const [group, setGroup] = useState<LibraryGroup>("all");
  const off = cardsOff(on);
  const shown = off.filter(id => group === "all" || CARD_GROUP[id] === group);
  const sizeNames = (id: CardId) => SIZES_OF[id].map(z => t(`today.sizes.${z}`)).join(" · ");

  const library = (
    <>
      <h3 className="sect">{t("today.library.title")}</h3>
      <div className="segs" role="tablist">
        {LIBRARY_GROUPS.map(g => (
          <button key={g} type="button" role="tab" aria-selected={group === g} className={group === g ? "on" : ""} onClick={() => setGroup(g)}>{t(`today.library.${g}`)}</button>
        ))}
      </div>
      {shown.length ? (
        <div className="libgrid">
          {shown.map(id => (
            <div key={id} className="libitem">
              <button type="button" className="libcard" data-add={id} aria-label={t("edit.add", { name: name(id) })}
                onClick={() => onChange([id, ...on], t("today.edit.added", { name: name(id) }))}>
                <span className="ebadge eplus" aria-hidden="true">+</span>
                <span className="lib-k">{name(id)}</span>
                <span className={"lib-peek" + (has[id] ? "" : " muted")}>{has[id] ? peek(id) : t(`today.cards.${id}.desc`)}</span>
              </button>
              <p className="lib-name">{name(id)}</p>
              <p className="lib-sizes">{sizeNames(id)}</p>
            </div>
          ))}
        </div>
      ) : <p className="muted small edithint">{t(off.length ? "today.library.none" : "today.edit.allOn")}</p>}
    </>
  );

  return (
    <EditList id="today-edit" on={on} off={off} name={name} desc={id => t(`today.cards.${id}.desc`)}
      sub={id => (has[id] ? peek(id) : t("today.cards.waiting"))}
      hint={t("today.edit.hint")}
      onChange={onChange}
      more={library}
      // Only a size that is not the usual Medium shows on the line.
      badge={id => size(id) !== "m" ? <span className="esize">{t(`today.sizes.${size(id)}`)}</span> : null}
      onTap={id => setOpen(o => (o === id ? null : id))}
      below={id => open === id && SIZES_OF[id].length > 1 ? (
        <div className="esizes">
          <p className="esizes-k">{t("today.sizes.label")}</p>
          <div className="segs" role="radiogroup" aria-label={t("today.sizes.label")}>
            {SIZES_OF[id].map(z => (
              <button key={z} type="button" role="radio" aria-checked={size(id) === z} data-size={z}
                className={size(id) === z ? "on" : ""} onClick={() => onSize(id, z)}>{t(`today.sizes.${z}`)}</button>
            ))}
          </div>
          <p className="muted small">{t(`today.sizes.${size(id)}Help`)}</p>
        </div>
      ) : null}
      onReset={onReset} resetLabel={t("today.edit.reset")} />
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
