import { useEffect, useState, type ChangeEvent } from "react";
import { useNav } from "../../app/nav";
import { useToast } from "../../ui/Toast";
import { post } from "../../lib/api";
import { Q, type Session } from "../hunt/model";
import { fixLabel, type Bucket } from "./core";
import { H, decodeAny, errMsg, fetchHaul, haulPost, next, openScore, plural, type Entry, type HaulView } from "./state";
import { useTranslation } from "../../i18n";

/* Port of pwa/haul.js #view-rreview (openReview, reviewHtml,
 * onReviewClick, onReviewChange): check the receipt against the hunt.
 * A fix is a note on the haul record; it never changes points.
 * Opened with nav.reset("rreview", { session, data? }). */
const FIX_TOAST: Record<string, (n: string) => string> = {
  extra_add: n => `${n} added to your haul.`, extra_drop: n => `${n} left out.`,
  grabbed_keep: n => `${n} kept.`, grabbed_drop: n => `${n} removed from your haul.`,
  swap_ok: () => "Swap noted.", swap_no: () => "Not a swap.",
};
function findEntry(d: HaulView, key: string): { bucket: Bucket; entry: Entry } | null {
  for (const b of ["swapped", "on_receipt_only", "grabbed_only"] as Bucket[]) {
    const e = d.review[b].find(x => x.key === key);
    if (e) return { bucket: b, entry: e };
  }
  return null;
}

export function ReceiptReview() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast, showErr } = useToast();
  const sess = (nav.params.session as Session | undefined) || Q.current;
  const [d, setD] = useState<HaulView | null>((nav.params.data as HaulView | undefined) || null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!sess) return;
    Q.current = sess;
    if (nav.params.data) return;
    let live = true;
    fetchHaul(sess).then(v => { if (live) setD(v); }).catch(() => { if (live) openScore(nav, sess, { replace: true }); });
    return () => { live = false; };
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sess) return <div id="rv-review" />;

  const applyFix = async (kind: string, key: string) => {
    const v = await haulPost(sess, "/fix", { kind, key });
    setD(v);
    return v;
  };
  const onFix = async (key: string, kind: string) => {
    const cur = H.cache[sess.id];
    const found = cur && findEntry(cur, key);
    if (!found) return;
    const L = fixLabel(found.bucket)!;
    const before = found.entry.fix;
    // Tapping the chosen chip again takes the choice back.
    const send = before === kind ? L.none : kind;
    try {
      await applyFix(send, key);
      // A raw receipt line ('KS ORG BNNA 3LB') makes no sticker: it
      // could not be taken back from here. It still joins the haul.
      if (send === "extra_add" && found.entry.decoded) {
        post("/api/quest/stickers", { name: found.entry.name, session: sess.id, store: sess.store }).catch(() => {});
        delete H.stk[sess.id];
      }
      const undoKind = before || L.none;
      toast(send === L.none ? "Choice taken back." : FIX_TOAST[send](found.entry.name), {
        action: "Undo",
        onAction: () => { applyFix(undoKind, key).catch(showErr); },
      });
    } catch (e) { toast(errMsg(e)); }
  };
  const onMore = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    setStatus("Reading the receipt. This can take up to a minute.");
    try {
      const rid = await decodeAny(f);
      const v = await haulPost(sess, "/receipts", { receipt_id: rid });
      setD(v);
      setStatus("");
      toast("Second receipt added.");
    } catch (e) {
      setStatus("");
      toast("Could not add that receipt: " + errMsg(e));
    }
    ev.target.value = "";
  };

  if (!d) return <div id="rv-review" />;
  const r = d.review;
  const chip = (bucket: Bucket, e: Entry, which: "yes" | "no") => {
    const L = fixLabel(bucket)!;
    const kind = which === "yes" ? L.yesKind : L.noKind;
    return <button key={which} className="rv-fix" type="button" data-fix={kind} data-key={e.key} aria-pressed={e.fix === kind}
      onClick={() => onFix(e.key, kind)}>{L[which]}</button>;
  };
  /* chips: false = none, true = both, "no" = the opt-out chip only. */
  const row = (bucket: string, e: Entry, sub: string, chips: boolean | "no" | undefined) => {
    const cs = chips === "no" ? [chip(bucket as Bucket, e, "no")]
      : chips ? [chip(bucket as Bucket, e, "yes"), chip(bucket as Bucket, e, "no")] : null;
    return (
      <div className="rv-line" key={e.key}><div className="grow"><span className="name">{e.name}{e.qty > 1 ? ` ×${e.qty}` : ""}</span>{sub ? <span className="sub">{sub}</span> : null}</div>
        {cs && <div className="rv-chips">{cs}</div>}</div>
    );
  };
  const n = r.grabbed_only.length;

  return (
    <div id="rv-review">
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("haul.checkYourReceipt")}</h2>
      <p className="muted">{t("haul.aryaReadFixAnythingThat", { plural: plural(r.read, "line") })}</p>
      <p className="muted">{t("haul.aryaMatchesByNameThese")}</p>
      {r.matched.length > 0 && <>
        <h3 className="sect">{t("haul.matched", { matchedCount: r.matched.length })}</h3>
        <div className="group">{r.matched.map(e => row("matched", e, "", false))}</div>
      </>}
      {r.swapped.length > 0 && <>
        <h3 className="sect">{t("haul.swapped", { swappedCount: r.swapped.length })}</h3>
        <div className="group">{r.swapped.map(e => row("swapped", e,
          e.suggested ? `Looks like a swap for ${e.from}. Is it? It stays in your haul either way.` : `Instead of ${e.from}`, e.suggested))}</div>
      </>}
      {r.on_receipt_only.length > 0 && <>
        <h3 className="sect">{t("haul.onReceiptNotOnYour", { on_receipt_onlyCount: r.on_receipt_only.length })}</h3>
        <div className="group">{r.on_receipt_only.map(e => row("on_receipt_only", e, "", true))}</div>
      </>}
      {n > 0 && <>
        {/* A grab with no receipt line stays in the haul. Leaving it out
            is the shopper's choice, never the default. */}
        <h3 className="sect">{t("haul.grabbedNotOnReceipt", { n })}</h3>
        <p className="muted">{n === 1 ? "1 grabbed item is" : n + " grabbed items are"}{" "}{t("haul.notOnTheReceiptThey")}</p>
        <p className="muted">{t("haul.paidAnotherWayKeepIt")}</p>
        <div className="group">{r.grabbed_only.map(e => row("grabbed_only", e,
          e.fix === "grabbed_drop" ? "Left out of your haul" : "In your haul", "no"))}</div>
      </>}
      <p className="rv-more"><label className="rv-addrcpt" htmlFor="rv-more">{t("haul.addAnotherReceipt")}</label>
        <input type="file" id="rv-more" accept="application/pdf,image/*" aria-label={t("haul.anotherReceipt")} hidden onChange={onMore} /></p>
      <p className="muted rv-more-note">{t("haul.paidInTwoPartsAdd")}</p>
      <p id="rv-status" className="muted">{status}</p>
      <p><button className="btn primary wide" type="button" data-act="looks-right" onClick={() => next(nav, sess)}>{t("common.looksRight")}</button></p>
    </div>
  );
}
