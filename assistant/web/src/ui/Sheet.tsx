import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../i18n";

/* The one bottom sheet. It replaces the three plain-JS versions
 * (static .sheetwrap blocks, huntmenu.js openSheet, expiry.js) with
 * the same classes, so it looks the same: scrim tap, Escape and a
 * downward drag close it; focus moves in, stays in, and goes back to
 * the control that opened it. */
type Props = {
  open: boolean;
  onClose: () => void;
  /* Shown in the standard head row with a Close link. Omit to draw your own head. */
  title?: ReactNode;
  /* Extra class on .sheetwrap (e.g. "signin"). */
  className?: string;
  /* id on .sheetwrap, kept from the old markup where CSS targets it. */
  id?: string;
  labelledBy?: string;
  closeLabel?: string;
  /* A sheet that changes its content in place (capture -> type the
   * date, list options -> link stores) passes a new key per step, so
   * focus moves into the new step as the old openSheet() did; else the
   * focused control is gone, focus falls to <body> and Escape no
   * longer reaches the sheet. */
  focusKey?: string;
  children: ReactNode;
};

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])";

export function Sheet({ open, onClose, title, className, id, labelledBy, closeLabel, focusKey, children }: Props) {
  const { t } = useTranslation();
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const el = sheet.current;
    const first = el?.querySelector<HTMLElement>("[data-first]") || el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => { (opener.current as HTMLElement | null)?.focus?.(); };
  }, [open]);

  const lastKey = useRef(focusKey);
  useEffect(() => {
    if (!open || focusKey === lastKey.current) return;
    lastKey.current = focusKey;
    const el = sheet.current;
    const first = el?.querySelector<HTMLElement>("[data-first]") || el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, [open, focusKey]);

  // Drag down to dismiss (was quest.js, load-time only).
  const y0 = useRef<number | null>(null);
  const onTouchStart = (ev: React.TouchEvent) => { y0.current = (sheet.current?.scrollTop || 0) <= 0 ? ev.touches[0].clientY : null; };
  const onTouchMove = (ev: React.TouchEvent) => {
    if (y0.current === null || !sheet.current) return;
    const dy = ev.touches[0].clientY - y0.current;
    sheet.current.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  };
  const onTouchEnd = (ev: React.TouchEvent) => {
    const dy = y0.current === null ? 0 : ev.changedTouches[0].clientY - y0.current;
    y0.current = null;
    if (sheet.current) sheet.current.style.transform = "";
    if (dy > 90) close.current();
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    ev.stopPropagation();
    if (ev.key === "Escape") { close.current(); return; }
    if (ev.key !== "Tab" || !sheet.current) return;
    const f = Array.from(sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!f.length) return;
    const [a, z] = [f[0], f[f.length - 1]];
    if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); }
    else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
  };

  if (!open) return null;
  return createPortal(
    <div id={id} className={"sheetwrap" + (className ? " " + className : "")} role="dialog" aria-modal="true"
      aria-labelledby={labelledBy || (title ? titleId : undefined)}
      onClick={ev => { if (ev.target === ev.currentTarget) close.current(); }} onKeyDown={onKeyDown}>
      <div className="sheet" ref={sheet} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {title !== undefined && (
          <div className="sheethead">
            <h3 id={titleId} className="nomargin">{title}</h3>
            <button type="button" className="linkbtn" onClick={() => close.current()}>{closeLabel ?? t("common.close")}</button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
