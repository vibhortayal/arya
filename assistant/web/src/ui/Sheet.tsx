import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../i18n";
import { useBackHandler } from "../app/nav";
import { motionOff } from "../lib/motion";

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
  useBackHandler(() => { close.current(); return true; }, open);

  /* Closing keeps the sheet mounted for the exit (200 ms, 130 ms with
   * motion off) so it leaves the way it came. Where nothing can animate
   * (tests, motion off with no fade) it unmounts at once. The last
   * children stay drawn while it leaves, because callers often clear
   * their state in the same render that closes it. */
  const [mounted, setMounted] = useState(open);
  const kids = useRef(children);
  if (open) kids.current = children;
  useEffect(() => {
    if (open) { setMounted(true); return; }
    if (typeof Element.prototype.animate !== "function") { setMounted(false); return; }
    const t = window.setTimeout(() => setMounted(false), motionOff() ? 130 : 200);
    return () => clearTimeout(t);
  }, [open]);

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
  const t0 = useRef(0);
  const onTouchStart = (ev: React.TouchEvent) => {
    y0.current = (sheet.current?.scrollTop || 0) <= 0 ? ev.touches[0].clientY : null;
    t0.current = Date.now();
    if (sheet.current) sheet.current.style.transition = "none";
  };
  const onTouchMove = (ev: React.TouchEvent) => {
    if (y0.current === null || !sheet.current) return;
    const dy = ev.touches[0].clientY - y0.current;
    sheet.current.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  };
  /* A quick flick closes it even when the drag is short (speed over
   * 0.11 px/ms, as Sonner and Vaul do). A slow short drag eases back. */
  const onTouchEnd = (ev: React.TouchEvent) => {
    const el = sheet.current;
    const dy = y0.current === null ? 0 : ev.changedTouches[0].clientY - y0.current;
    const speed = dy / Math.max(1, Date.now() - t0.current);
    y0.current = null;
    if (dy > 90 || (dy > 20 && speed > 0.11)) { if (el) el.style.transition = ""; close.current(); return; }
    if (!el) return;
    if (motionOff() || !el.style.transform) { el.style.transition = ""; el.style.transform = ""; return; }
    el.style.transition = "transform .25s var(--ease-out)";
    el.style.transform = "";
    window.setTimeout(() => { if (sheet.current) sheet.current.style.transition = ""; }, 260);
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

  if (!mounted && !open) return null;
  return createPortal(
    <div id={id} className={"sheetwrap" + (className ? " " + className : "") + (open ? "" : " closing")} role="dialog" aria-modal="true" aria-hidden={open ? undefined : true}
      aria-labelledby={labelledBy || (title ? titleId : undefined)}
      onClick={ev => { if (ev.target === ev.currentTarget) close.current(); }} onKeyDown={onKeyDown}>
      <div className="sheet" ref={sheet} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {title !== undefined && (
          <div className="sheethead">
            <h3 id={titleId} className="nomargin">{title}</h3>
            <button type="button" className="linkbtn" onClick={() => close.current()}>{closeLabel ?? t("common.close")}</button>
          </div>
        )}
        {open ? children : kids.current}
      </div>
    </div>,
    document.body,
  );
}
