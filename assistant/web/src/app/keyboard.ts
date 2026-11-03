/* On-screen keyboard handling, once for the whole app.
 *
 * iPhone Safari does not shrink the page when the keyboard opens, so
 * bottom sheets and fixed bars sit under it and a focused field can be
 * hidden. This publishes the keyboard's height as --kb on <html> (and a
 * "kb-open" class) from the visual viewport, so CSS can lift sheets
 * above it, and scrolls the focused field into view once the keyboard
 * has settled. Where the browser already resizes the page (Android),
 * --kb stays 0 and only the scroll-into-view applies. */
const TEXTY = "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=true]";

export function keyboardInset(win: Window = window): number {
  const vv = win.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(win.innerHeight - vv.height - vv.offsetTop));
}

export function revealFocused(doc: Document = document) {
  const el = doc.activeElement as HTMLElement | null;
  if (!el || !el.matches?.(TEXTY)) return;
  el.scrollIntoView?.({ block: "center", behavior: "auto" });
}

export function installKeyboardInset(win: Window = window): () => void {
  const doc = win.document;
  const root = doc.documentElement;
  let timer = 0;
  const apply = () => {
    const kb = keyboardInset(win);
    root.style.setProperty("--kb", `${kb}px`);
    root.classList.toggle("kb-open", kb > 80);
  };
  const settle = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { apply(); revealFocused(doc); }, 280);
  };
  const onResize = () => { apply(); if (doc.activeElement?.matches?.(TEXTY)) settle(); };
  const onFocus = (e: Event) => { if ((e.target as Element | null)?.matches?.(TEXTY)) settle(); };
  const vv = win.visualViewport;
  apply();
  vv?.addEventListener("resize", onResize);
  vv?.addEventListener("scroll", apply);
  doc.addEventListener("focusin", onFocus);
  return () => {
    window.clearTimeout(timer);
    vv?.removeEventListener("resize", onResize);
    vv?.removeEventListener("scroll", apply);
    doc.removeEventListener("focusin", onFocus);
  };
}
