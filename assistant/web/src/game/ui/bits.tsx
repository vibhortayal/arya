/* Small shared pieces of the game UI: a bottom sheet, the mini-map,
 * the store-kind badge and the progress bar. The game keeps its own
 * copies (rather than the app's) so it stays one self-contained folder. */
import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PLAN } from "../core/template";
import { currentStop, itemsIn, leftIn, sectionView, type Trip } from "../core/trip";
import type { MapKind } from "../core/types";

export function Sheet({ open, onClose, title, children, tall }: { open: boolean; onClose: () => void; title: string; children: ReactNode; tall?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k);
    ref.current?.focus();
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="qg-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={"qg-sheet" + (tall ? " tall" : "")}
            onClick={e => e.stopPropagation()}
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 30, stiffness: 340 }}
            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }} onDragEnd={(_, i) => { if (i.offset.y > 90) onClose(); }}>
            <div className="qg-grab" aria-hidden="true" />
            <div className="qg-sheet-h"><h2>{title}</h2><button className="qg-x" onClick={onClose} aria-label="Close">✕</button></div>
            <div className="qg-sheet-b">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const KIND: Record<MapKind, [string, string]> = {
  mapped: ["Mapped", "real"], partial: ["Part mapped", "part"], simulated: ["Simulated", "sim"], practice: ["Practice", "prac"],
};
export function KindBadge({ kind, practice }: { kind: MapKind; practice?: boolean }) {
  const [label, cls] = practice ? KIND.practice : KIND[kind];
  return <span className={"qg-kind " + cls}>{label}</span>;
}

export function Bar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="qg-bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <motion.i initial={false} animate={{ width: pct + "%" }} transition={{ type: "spring", damping: 22, stiffness: 160 }} />
    </div>
  );
}

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

/* The Mario-style reference map: a small plan of the store with "you
 * are here" while the player is inside a section. Tapping it goes
 * back to the big map. */
export function MiniMap({ trip, here, onClick }: { trip: Trip; here: string | null; onClick?: () => void }) {
  const L = trip.layout, cur = currentStop(trip);
  const sec = L.sections.find(s => s.id === here);
  return (
    <button className="qg-mini" onClick={onClick} aria-label="Back to the store map">
      <svg viewBox={`0 0 ${PLAN.w} ${PLAN.h}`} aria-hidden="true">
        <rect x="6" y="6" width={PLAN.w - 12} height={PLAN.h - 12} rx="18" fill="#fbf8f2" stroke="#3b3b40" strokeWidth="8" />
        {L.sections.map(s => {
          if (s.kind === "aisle" && !itemsIn(trip, s.id).length) return null;
          const v = sectionView(trip, s.id), done = itemsIn(trip, s.id).length > 0 && !leftIn(trip, s.id).length;
          const fill = v === "fog" ? "#dedee4" : v === "guess" ? "#e8f0fb" : hex(s.color);
          return <rect key={s.id} x={s.rect.x} y={s.rect.y} width={s.rect.w} height={s.rect.h} rx="8" fill={done ? "#ffd9cc" : fill} stroke={s.id === here ? "#E4572E" : "none"} strokeWidth="10" />;
        })}
        {cur && cur !== here && (() => { const n = L.sections.find(s => s.id === cur)!.node; return <circle cx={n.x} cy={n.y} r="16" fill="none" stroke="#E4572E" strokeWidth="7" strokeDasharray="8 7" />; })()}
        {sec && <circle cx={sec.node.x} cy={sec.node.y} r="22" fill="#E4572E" stroke="#fff" strokeWidth="8" />}
      </svg>
    </button>
  );
}

/* The ghost hand (Candy Crush/Royal Match): it shows where to tap
 * after a few seconds of no input, and hides on the next tap. */
export function GhostHand({ target, delay = 3000 }: { target: string | null; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el || !target) return;
    let timer = 0;
    const place = () => {
      const t = document.querySelector(target) as HTMLElement | null, root = el.offsetParent as HTMLElement | null;
      if (!t || !root) { el.classList.remove("on"); return; }
      const r = t.getBoundingClientRect(), R = root.getBoundingClientRect();
      el.style.left = `${r.left - R.left + r.width / 2}px`; el.style.top = `${r.top - R.top + r.height / 2}px`;
      el.classList.add("on");
    };
    const arm = () => { el.classList.remove("on"); clearTimeout(timer); timer = window.setTimeout(place, delay); };
    arm();
    addEventListener("pointerdown", arm, true);
    return () => { clearTimeout(timer); removeEventListener("pointerdown", arm, true); };
  }, [target, delay]);
  return <div ref={ref} className="qg-hand" aria-hidden="true" />;
}
