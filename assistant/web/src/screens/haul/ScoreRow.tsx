import { useEffect, useState } from "react";
import { useNav } from "../../app/nav";
import type { Session } from "../hunt/model";
import { H, canReview, enter, fetchHaul } from "./state";

/* Port of pwa/haul.js scoreRow and its [data-hl] click handler: the
 * Score screen's haul row. The fetch warms the share card's context
 * and, when the receipt has readable lines, shows Check your receipt. */
export function ScoreRow({ sess, attached }: { sess: Session; attached: boolean }) {
  const nav = useNav();
  const [showReview, setShowReview] = useState(() => !!(H.cache[sess.id] && canReview(sess, H.cache[sess.id])));
  useEffect(() => {
    let live = true;
    fetchHaul(sess).then(d => { if (live) setShowReview(canReview(sess, d)); }).catch(() => {});
    return () => { live = false; };
  }, [sess]);
  const quest = sess.mode !== "express";
  return (
    <div className="group pad hl-score">
      {!attached && <p className="hl-wait"><b>Receipt bonus waiting.</b> It never expires. Add the receipt any time.</p>}
      <div className="hl-btns">
        <button className="btn" type="button" data-hl="card" onClick={() => enter(nav, "haul", sess)}>Make my haul card</button>
        {!!sess.receipt_id && <button className="btn" type="button" data-hl="review" hidden={!showReview} onClick={() => enter(nav, "rreview", sess)}>Check your receipt</button>}
        {quest && <button className="btn" type="button" data-hl="replay" onClick={() => enter(nav, "reveal", sess)}>Replay the reveal</button>}
        {quest && <button className="btn" type="button" data-hl="album" onClick={() => nav.show("album")}>See my album</button>}
      </div>
    </div>
  );
}
