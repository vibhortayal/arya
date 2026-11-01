import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useTranslation } from "../i18n";

/* The one edit mode (card library, owner 2026-10-30: "think how modern
 * OS do it"), shared by every screen that can be arranged: Today's
 * cards, Lists, Ask's questions, Spending's charts, Quest's panels.
 * Each item is one line with a red minus to remove it and a grip to
 * drag it (or the up and down arrow keys); what is off sits under
 * More with a green plus. The caller saves each change at once and
 * offers Undo; nothing asks "Are you sure?". */

export function moveItem<T>(on: T[], id: T, to: number): T[] {
  if (!on.includes(id)) return on;
  const next = on.filter(c => c !== id);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, id);
  return next;
}

const Grip = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M5 8h14M5 12h14M5 16h14" />
  </svg>
);

/* The title row: the page title, and Edit, which turns into Done. */
export function EditTitle({ title, editTitle, editing, onToggle, id, small, editLabel }: { title: string; editTitle: string; editing: boolean; onToggle: () => void; id?: string; small?: boolean; editLabel?: string }) {
  const { t } = useTranslation();
  return (
    <div className="titlerow"><h1 className="largetitle" style={small ? { fontSize: 28 } : undefined}>{editing ? editTitle : title}</h1>
      <button type="button" id={id} className={"linkbtn titleedit" + (editing ? " done" : "")} onClick={onToggle}>
        {editing ? t("common.done") : editLabel || t("today.edit.edit")}</button></div>
  );
}

type Props<T extends string> = {
  on: T[];
  off: T[];
  name: (id: T) => string;
  /* The line under the name of an item that is on. */
  sub: (id: T) => string;
  /* The line under the name of an item that is off. */
  desc: (id: T) => string;
  /* A new order for what is on; msg (with Undo) for a remove or an add. */
  onChange: (next: T[], msg?: string) => void;
  hint?: string;
  moreTitle?: string;
  /* Under More when nothing is off. */
  emptyMore?: string;
  /* Replaces the plain More list (Today shows its card library). */
  more?: ReactNode;
  /* Something at the end of an item, before the grip (a size, a pin). */
  badge?: (id: T) => ReactNode;
  /* Tapping an item's name; with below(), opens a panel under it. */
  onTap?: (id: T) => void;
  below?: (id: T) => ReactNode;
  onReset?: () => void;
  resetLabel?: string;
  id?: string;
  /* Items that always stay: no red minus (they still move). */
  locked?: (id: T) => boolean;
  /* Set when nothing more can be added (the bar holds four): the plus
   * buttons are greyed out and this line says why (owner, 2026-11-01). */
  full?: string;
};

export function EditList<T extends string>({ on, off, name, sub, desc, onChange, hint, moreTitle, emptyMore, more, badge, onTap, below, onReset, resetLabel, id, locked, full }: Props<T>) {
  const { t } = useTranslation();
  // The order while a finger drags; saved when it lifts.
  const [order, setOrder] = useState(on);
  const [drag, setDrag] = useState<T | null>(null);
  const tiles = useRef<Partial<Record<T, HTMLDivElement | null>>>({});
  useEffect(() => { if (!drag) setOrder(on); }, [on, drag]);

  function down(e: PointerEvent<HTMLButtonElement>, it: T) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(it);
  }
  function move(e: PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const rest = order.filter(c => c !== drag);
    let to = rest.length;
    for (let k = 0; k < rest.length; k++) {
      const r = tiles.current[rest[k]]?.getBoundingClientRect();
      if (r && e.clientY < r.top + r.height / 2) { to = k; break; }
    }
    const next = moveItem(order, drag, to);
    if (next.join() !== order.join()) setOrder(next);
  }
  function up() {
    if (!drag) return;
    setDrag(null);
    if (order.join() !== on.join()) onChange(order);
  }
  function key(e: KeyboardEvent<HTMLButtonElement>, it: T) {
    const k = on.indexOf(it);
    if (e.key === "ArrowUp" && k > 0) { e.preventDefault(); onChange(moveItem(on, it, k - 1)); }
    if (e.key === "ArrowDown" && k < on.length - 1) { e.preventDefault(); onChange(moveItem(on, it, k + 1)); }
  }

  return (
    <div className="editlist" id={id}>
      {hint && <p className="muted small edithint">{hint}</p>}
      <div className="etiles">
        {order.map(it => (
          <div key={it} className="etile-wrap">
            <div data-tile={it} className={"etile" + (drag === it ? " lifted" : "")} ref={el => { tiles.current[it] = el; }}>
              {locked?.(it)
                ? <span className="eminus elocked" aria-hidden="true" />
                : <button type="button" className="eminus" aria-label={t("edit.remove", { name: name(it) })}
                  onClick={() => onChange(on.filter(c => c !== it), t("edit.removed", { name: name(it) }))}><span className="ebadge" aria-hidden="true">−</span></button>}
              {onTap
                ? <button type="button" className="grow etap" data-tap={it} onClick={() => onTap(it)}><b>{name(it)}</b><span className="sub">{sub(it)}</span></button>
                : <span className="grow"><b>{name(it)}</b><span className="sub">{sub(it)}</span></span>}
              {badge?.(it)}
              <button type="button" className="egrip" aria-label={t("edit.move", { name: name(it) })}
                onPointerDown={e => down(e, it)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
                onKeyDown={e => key(e, it)}><Grip /></button>
            </div>
            {below?.(it)}
          </div>
        ))}
      </div>
      {more ?? (
        <>
          <h3 className="sect">{moreTitle ?? t("edit.more")}</h3>
          {off.length > 0 && full && <p className="muted small edithint" id={id ? id + "-full" : undefined}>{full}</p>}
          {off.length ? (
            <div className={"etiles" + (full ? " efull" : "")}>
              {off.map(it => (
                <button key={it} type="button" data-add={it} className="etile eadd" aria-label={t("edit.add", { name: name(it) })}
                  disabled={!!full} aria-describedby={full && id ? id + "-full" : undefined}
                  onClick={() => onChange([it, ...on], t("edit.added", { name: name(it) }))}>
                  <span className="ebadge eplus" aria-hidden="true">+</span>
                  <span className="grow"><b>{name(it)}</b><span className="sub">{desc(it)}</span></span>
                </button>
              ))}
            </div>
          ) : <p className="muted small edithint">{emptyMore ?? t("edit.allOn")}</p>}
        </>
      )}
      {onReset && <button type="button" className="linkbtn editreset" onClick={onReset}>{resetLabel ?? t("edit.reset")}</button>}
    </div>
  );
}
