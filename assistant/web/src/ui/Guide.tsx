import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNav } from "../app/nav";
import { GUIDE_CARDS, guideIndex, type GuideArt, type GuideCard, type GuideId, type TryKind } from "../guide/cards";
import { asset } from "../lib/format";
import { GuideTry } from "./GuideTry";
import { useTranslation } from "../i18n";

/* The Arya guide (#154, owner-approved mockup 2026-10-29): a
 * full-screen story of what Arya does, one card at a time.
 *
 *   const guide = useGuide();
 *   guide.open();            // card 1
 *   guide.open("prices");    // at a card id (guide/cards.ts)
 *
 * Code outside React (a tour step) calls openGuide(id). It never shows
 * by itself: Settings > Arya guide, Powers > See how it works (and a
 * power's (i) sheet), and the last first-run tour step open it.
 *
 * Next / Back, a left or right swipe, and the arrow keys move between
 * cards; Esc and the round x close it; Done on the last card closes
 * it. role="dialog", focus moves in, stays in, and goes back to the
 * control that opened it. Under prefers-reduced-motion the cards do
 * not slide. Try it opens a sheet over the card (ui/GuideTry.tsx). */

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

function Art({ art }: { art: GuideArt }) {
  const { t } = useTranslation();
  if (art.kind === "image") return <div className="gd-art"><img className="full" src={asset(art.src)} alt="" /></div>;
  if (art.kind === "chars") {
    return <div className="gd-art"><div className="chars">{art.names.map(n => <img key={n} src={asset(`assets/characters/${n}.webp`)} alt="" />)}</div></div>;
  }
  return (
    <div className="gd-art">
      <div className="mini" aria-hidden="true">
        <b>{t("guide.sample.art.oil")}</b>
        <div className="r"><span>{t("guide.sample.store.tj")}</span><span className="good">{t("guide.sample.art.cheaper", { price: "$8.99" })}</span></div>
        <div className="r"><span>{t("guide.sample.store.safeway")}</span><span>$11.49</span></div>
        <div className="r"><span>{t("guide.sample.art.last3")}</span><span>{t("guide.sample.art.up")}</span></div>
      </div>
    </div>
  );
}

function Card({ card, onTry }: { card: GuideCard; onTry: (k: TryKind) => void }) {
  const { t } = useTranslation();
  return (
    <>
      {card.art && <Art art={card.art} />}
      <p className="gd-k">{t(card.kickerKey)}</p>
      <h2 id="gd-title">{t(card.titleKey)}</h2>
      {card.bodyKey && <p className="b">{t(card.bodyKey)}</p>}
      {card.pointKeys && <ul className="pts">{card.pointKeys.map(k => <li key={k}>{t(k)}</li>)}</ul>}
      {card.howtos && (
        <div className="gd-howto">
          {card.howtos.map((h, k) => (
            <details key={h.id} data-howto={h.id} open={k === 0}>
              <summary>{t(h.titleKey)}</summary>
              <ol className="howto">{h.stepKeys.map(s => <li key={s}>{t(s)}</li>)}</ol>
            </details>
          ))}
        </div>
      )}
      {card.try && <button className="try" id="gd-try" type="button" data-try={card.try.kind} onClick={() => onTry(card.try!.kind)}>{t(card.try.labelKey)}<span aria-hidden="true"> ▸</span></button>}
    </>
  );
}

export function GuideOverlay({ start = 0, onClose }: { start?: number; onClose: () => void }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [i, setI] = useState(start);
  const [dir, setDir] = useState<"" | "fwd" | "bwd">("");
  const [tryKind, setTry] = useState<Exclude<TryKind, "quest"> | null>(null);
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

  // Keys work wherever focus is, unless a Try-it sheet is up (the
  // sheet takes Esc for itself).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (tryKind || ev.defaultPrevented) return;
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
  }, [tryKind, onClose, go, bwd, i, last]);

  const onTouchStart = (ev: React.TouchEvent) => { x0.current = { x: ev.touches[0].clientX, y: ev.touches[0].clientY }; };
  const onTouchEnd = (ev: React.TouchEvent) => {
    const s = x0.current;
    x0.current = null;
    if (!s || tryKind) return;
    const dx = ev.changedTouches[0].clientX - s.x, dy = ev.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) { if (!last) go(i + 1); } else bwd();
  };

  const onTry = (k: TryKind) => {
    // Quest's Try it is the game's own Practice Market (saves nothing).
    if (k === "quest") { onClose(); nav.show("community", { practice: true }); return; }
    setTry(k);
  };
  const realList = () => { setTry(null); onClose(); nav.show("list", { newList: true }); };

  return createPortal(
    <>
      <div className="gd" ref={wrap} role="dialog" aria-modal="true" aria-labelledby="gd-title" aria-describedby="gd-count"
        data-card={card.id} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="gd-top">
          <span className="cnt" id="gd-count">{t("guide.count", { n: i + 1, total })}</span>
          <button className="x" id="gd-close" type="button" aria-label={t("guide.close")} onClick={onClose}>×</button>
        </div>
        <div className="gd-body">
          <div className={"gd-card" + (card.art ? "" : " noart") + (dir ? " " + dir : "")} key={card.id}>
            <Card card={card} onTry={onTry} />
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
      {tryKind && <GuideTry kind={tryKind} onClose={() => setTry(null)} onRealList={realList} />}
    </>,
    document.body,
  );
}
