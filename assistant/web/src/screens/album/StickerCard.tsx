import { useEffect, useRef, useState } from "react";
import { asset } from "../../lib/format";
import { Q } from "../hunt/model";

/* Port of the "New sticker" card in pwa/album.js (albCardEl,
 * albHideCard, albCardOpen, albCardUndo, albOnGrabbed). Mounted by the
 * hunt. It never blocks Grab: it sits above the toast line, closes by
 * itself after 2600 ms and has no timer on screen. A second card
 * replaces the first. Express never shows it. */

const ALB_CARD_MS = 2600;
const ALB_FALLBACK_ART = "basket.webp";

type Sticker = { key?: string; name?: string; image?: string; image_url?: string; art?: string };
type NewSticker = { sticker?: Sticker; page_badge?: { name?: string } | null };
type Card = { st: Sticker; badge: string };

/* albCardOpen(): set at once, because the hunt asks right after it
 * dispatches arya:grabbed, before React has painted. */
let open = false;
export const cardOpen = () => open;

const low = (s: unknown) => String(s || "").trim().toLowerCase();
const stickerSrc = (st: Sticker) =>
  st.image === "cutout" && st.image_url ? st.image_url : asset("assets/characters/" + (st.art || ALB_FALLBACK_ART));

/* Which hunt row the card's Undo means (albUndoIndex). */
export function stickerUndoIndex(sess: { items?: { name: string; group?: string }[] } | null, key?: string, name?: string) {
  const items = sess?.items || [];
  return items.findIndex(i => (key && i.group === key) || low(i.name) === low(name));
}

export function StickerCard({ onUndo }: { onUndo: (key: string, name: string) => void }) {
  const [card, setCard] = useState<Card | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const undo = useRef(onUndo);
  undo.current = onUndo;
  const cur = useRef<Card | null>(null);

  useEffect(() => {
    const hide = () => {
      clearTimeout(timer.current);
      open = false; cur.current = null; setCard(null);
    };
    const onGrabbed = (ev: Event) => {
      const sess = Q.current;
      const ns = (sess && sess.new_sticker) as NewSticker | undefined;
      if (sess) delete sess.new_sticker;
      const d = ((ev as CustomEvent).detail || {}) as { group?: string; name?: string };
      const st = ns && ns.sticker;
      const same = !!st && !!((st.key && d.group && st.key === d.group) || (d.name && low(st.name) === low(d.name)));
      if (same && st && !(sess && sess.mode === "express")) {
        clearTimeout(timer.current);
        const c = { st, badge: ns?.page_badge?.name || "" };
        open = true; cur.current = c; setCard(c);
        timer.current = window.setTimeout(hide, ALB_CARD_MS);
        return;
      }
      // No new sticker for THIS grab: an earlier card belongs to an
      // earlier item. Close it so the hunt shows this grab's toast.
      hide();
    };
    document.addEventListener("arya:grabbed", onGrabbed);
    document.addEventListener("arya:putback", hide);
    return () => {
      document.removeEventListener("arya:grabbed", onGrabbed);
      document.removeEventListener("arya:putback", hide);
      hide();
    };
  }, []);

  const doUndo = () => {
    const c = cur.current;
    clearTimeout(timer.current);
    open = false; cur.current = null; setCard(null);
    if (c) undo.current(c.st.key || "", c.st.name || "");
  };

  return (
    <div id="stk-card" className="stkcard" role="status" aria-live="polite" hidden={!card}
      data-key={card?.st.key || ""} data-name={card?.st.name || ""}>
      {card && (
        <>
          <img className="stkimg" src={stickerSrc(card.st)} alt="" />
          <div className="stkbody"><b className="stkhead">New sticker</b><span className="stkname">{card.st.name}</span>
            {card.badge && <span className="stkbadge">Page full. Add your receipt to earn {card.badge}.</span>}</div>
          <button type="button" className="undo" data-stk-undo onClick={doUndo}>Undo</button>
        </>
      )}
    </div>
  );
}
