import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GUIDE_CARDS, guideIndex, type GuideCard, type GuideId } from "../guide/cards";
import { useTour } from "./Tour";
import { FIRST_RUN_TOUR } from "../onboarding/firstRunTour";
import { useTranslation } from "../i18n";

/* The Arya guide (#154, owner-approved mockup 2026-10-29): a
 * full-screen story of what Arya does, one card at a time.
 *
 *   const guide = useGuide();
 *   guide.open();            // card 1
 *   guide.open("prices");    // at a card id (guide/cards.ts)
 *
 * Code outside React (a tour step) calls openGuide(id). It never shows
 * by itself: the Help tab > Guide, Powers > See how it works (and a
 * power's (i) sheet), and the last first-run tour step open it.
 *
 * Next / Back, a left or right swipe, and the arrow keys move between
 * cards; Esc and the round x close it; Done on the last card closes
 * it. role="dialog", focus moves in, stays in, and goes back to the
 * control that opened it. Under prefers-reduced-motion the cards do
 * not slide. Each card is text and numbered steps; nothing in it links
 * out of the guide.
 * "Replay the tour" on the last card closes the guide and replays the
 * first-run tour (it used to be its own Settings row; usability pass). */

type Guide = { active: boolean; open: (at?: GuideId) => void; close: () => void };
const Ctx = createContext<Guide | null>(null);

let opener: ((at?: GuideId) => void) | null = null;
/* Open the guide from code that has no hook (tour step data). */
export function openGuide(at?: GuideId) { opener?.(at); }

export function GuideProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState<{ at: number; n: number } | null>(null);
  const seq = useRef(0);
  const open = useCallback((at?: GuideId) => setRun({ at: guideIndex(at), n: ++seq.current }), []);
  const close = useCallback(() => setRun(null), []);
  useEffect(() => {
    opener = open;
    return () => { if (opener === open) opener = null; };
  }, [open]);
  const v = useMemo(() => ({ active: !!run, open, close }), [run, open, close]);
  return (
    <Ctx.Provider value={v}>
      {children}
      {run && <GuideOverlay key={run.n} start={run.at} onClose={close} />}
    </Ctx.Provider>
  );
}

export function useGuide(): Guide {
  const g = useContext(Ctx);
  if (!g) throw new Error("useGuide outside GuideProvider");
  return g;
}

const SWIPE = 50;
const FOCUSABLE = "button:not([disabled]), summary, [href]";

function Card({ card }: { card: GuideCard }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="gd-k">{t(card.kickerKey)}</p>
      <h2 id="gd-title">{t(card.titleKey)}</h2>
      <p className="b">{t(card.bodyKey)}</p>
      <ol className="steps">{card.stepKeys.map(k => <li key={k}><span>{t(k)}</span></li>)}</ol>
    </>
  );
}

export function GuideOverlay({ start = 0, onClose }: { start?: number; onClose: () => void }) {
  const { t } = useTranslation();
  const tour = useTour();
  const [i, setI] = useState(start);
  const [dir, setDir] = useState<"" | "fwd" | "bwd">("");
  const wrap = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const x0 = useRef<{ x: number; y: number } | null>(null);
  const total = GUIDE_CARDS.length;
  const card = GUIDE_CARDS[i];
  const last = i === total - 1;

  const go = useCallback((to: number) => {
    setI(cur => {
      const n = Math.max(0, Math.min(total - 1, to));
      if (n !== cur) setDir(n > cur ? "fwd" : "bwd");
      return n;
    });
  }, [total]);
  const fwd = useCallback(() => (last ? onClose() : go(i + 1)), [last, onClose, go, i]);
  const bwd = useCallback(() => go(i - 1), [go, i]);

  // Focus moves in on open and goes back to the opener on close; the
  // page under the guide does not scroll.
  useEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    const body = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    next.current?.focus();
    return () => {
      document.body.style.overflow = body;
      if (from && from !== document.body && from.isConnected) from.focus?.();
    };
  }, []);
  // A card change can remove the focused control (Back on card 1).
  useEffect(() => {
    if (!wrap.current?.contains(document.activeElement)) next.current?.focus();
    wrap.current?.querySelector(".gd-body")?.scrollTo?.(0, 0);
  }, [i]);

  // Keys work wherever focus is.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented) return;
      if (ev.key === "Escape") { ev.preventDefault(); onClose(); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); if (!last) go(i + 1); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); bwd(); }
      else if (ev.key === "Tab" && wrap.current) {
        const f = Array.from(wrap.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!f.length) return;
        const [a, z] = [f[0], f[f.length - 1]];
        const at = document.activeElement;
        if (!wrap.current.contains(at)) { ev.preventDefault(); a.focus(); }
        else if (ev.shiftKey && at === a) { ev.preventDefault(); z.focus(); }
        else if (!ev.shiftKey && at === z) { ev.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, go, bwd, i, last]);

  const onTouchStart = (ev: React.TouchEvent) => { x0.current = { x: ev.touches[0].clientX, y: ev.touches[0].clientY }; };
  const onTouchEnd = (ev: React.TouchEvent) => {
    const s = x0.current;
    x0.current = null;
    if (!s) return;
    const dx = ev.changedTouches[0].clientX - s.x, dy = ev.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) { if (!last) go(i + 1); } else bwd();
  };

  const replay = () => { onClose(); tour.startTour(FIRST_RUN_TOUR); };

  return createPortal(
    <>
      <div className="gd" ref={wrap} role="dialog" aria-modal="true" aria-labelledby="gd-title" aria-describedby="gd-count"
        data-card={card.id} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="gd-top">
          <span className="cnt" id="gd-count">{t("guide.count", { n: i + 1, total })}</span>
          <button className="x" id="gd-close" type="button" aria-label={t("guide.close")} onClick={onClose}>×</button>
        </div>
        <div className="gd-body">
          <div className={"gd-card" + (dir ? " " + dir : "")} key={card.id}>
            <Card card={card} />
            {last && <button className="linkbtn gd-tour" id="gd-tour" type="button" onClick={replay}>{t("guide.replayTour")}</button>}
          </div>
        </div>
        <div className="gd-bot">
          <span className="gd-dots" role="img" aria-label={t("guide.cardOf", { n: i + 1, total })}>
            {GUIDE_CARDS.map((c, k) => <i key={c.id} className={k === i ? "on" : undefined} />)}
          </span>
          {i > 0 && <button className="linkbtn" id="gd-back" type="button" onClick={bwd}>{t("guide.back")}</button>}
          <button className="btn primary" id="gd-next" type="button" ref={next} onClick={fwd}>{last ? t("common.done") : t("guide.next")}</button>
        </div>
      </div>
    </>,
    document.body,
  );
}
