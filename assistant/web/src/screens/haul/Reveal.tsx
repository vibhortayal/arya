import { useEffect, useRef, useState } from "react";
import { useNav } from "../../app/nav";
import { useSession } from "../../app/session";
import { AddReceiptSheet } from "../../ui/AddReceiptSheet";
import { money } from "../../lib/format";
import { Q, qBossStatus, type Session } from "../hunt/model";
import { qConfetti, qShowMilestone, qTone } from "../hunt/fx";
import { countStep, privateLines, revealFinal } from "./core";
import { H, afterFinish, artSrc, canReview, enter, faceReady, fetchHaul, loadProfile, openScore, reduced,
  stickersFor, tileSrc, type HaulView, type Sticker } from "./state";
import { t, useTranslation } from "../../i18n";

/* Port of pwa/haul.js #view-reveal (openReveal, revealRows, play,
 * skipReveal, levelBurst, onRevealClick): the haul appears tile by
 * tile while the points count up. Tap anywhere to skip. Motion is
 * opt-out: prefers-reduced-motion shows the end state.
 * Opened with nav.reset("reveal", { session }). */
type Loaded = { d: HaulView; stickers: Sticker[]; fresh: Set<string> };

function bossStatus(sess: Session, d: HaulView) {
  try { return qBossStatus(sess); } catch { /* fall through */ }
  return d.boss ? (d.boss.found ? "found" : "open") : "none";
}

/* A level crossed on this trip gets one burst. Sound and buzz stay
 * opt-in inside qTone; the confetti respects reduced motion. */
async function levelBurst(sess: Session, d: HaulView) {
  if (!d.settled || H.burst.has(sess.id)) return;
  H.burst.add(sess.id);
  const p = await loadProfile();
  if (!p || !p.level) return;
  try {
    // The same memory the Score screen uses: a level the phone has
    // not seen yet gets its burst, once. A replay never repeats it.
    const seen = Number(localStorage.getItem("arya-level") || 0);
    localStorage.setItem("arya-level", String(p.level));
    if (!(seen && p.level > seen)) return;
    qShowMilestone(t("haul.levelUp", { level: p.level }));
    qConfetti();
    qTone([523, 784, 1047, 1319], 0.1);
  } catch { /* a missing opt-in effect never blocks the reveal */ }
}

export function Reveal() {
  const { t } = useTranslation();
  const nav = useNav();
  const { currency } = useSession();
  const sess = (nav.params.session as Session | undefined) || Q.current;
  const [data, setData] = useState<Loaded | null>(null);
  const [ar, setAr] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    if (!sess) return;
    Q.current = sess;
    let live = true;
    (async () => {
      let d: HaulView;
      try { d = await fetchHaul(sess); } catch { if (live) openScore(nav, sess, { replace: true }); return; }
      await faceReady();
      const { stickers, fresh } = await stickersFor(sess);
      if (live) setData({ d, stickers, fresh });
    })();
    return () => { live = false; cancelAnimationFrame(raf.current); };
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const tiles = () => Array.from(box.current?.querySelectorAll<HTMLElement>("#rv-loot .rv-tile") || []);
  const setNumber = (n: number) => { const el = box.current?.querySelector("#rv-pts"); if (el) el.textContent = String(n); };
  /* Screen readers hear the total once, when the count ends. */
  const announce = (n: number) => { const el = box.current?.querySelector("#rv-pts-sr"); if (el) el.textContent = t("haul.points", { n }); };
  const showAll = () => tiles().forEach(t => { t.style.transitionDelay = "0ms"; t.classList.add("in"); });

  // play(): runs once the tiles are on the page.
  useEffect(() => {
    if (!data || !sess) return;
    const { d } = data;
    const target = d.settled ? d.points.total : d.points.total - d.points.receipt;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    const n = d.items.length;
    if (reduced()) { showAll(); setNumber(target); announce(target); levelBurst(sess, d); return; }
    requestAnimationFrame(() => tiles().forEach(t => t.classList.add("in")));
    const dur = Math.max(900, n * 160 + 500), t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      setNumber(countStep(0, target, k));
      if (k < 1) raf.current = requestAnimationFrame(step);
      else { raf.current = 0; announce(target); levelBurst(sess, d); }
    };
    raf.current = requestAnimationFrame(step);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const skipReveal = () => {
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    const el = box.current?.querySelector<HTMLElement>("#rv-pts");
    if (!el) return;
    const fin = revealFinal(Number(el.dataset.target || 0), tiles().length);
    showAll();
    setNumber(fin.value);
    announce(fin.value);
    const d = sess && H.cache[sess.id];
    if (sess && d) levelBurst(sess, d);
  };
  // Tap anywhere on the view (not a control) skips to the end state.
  const skipRef = useRef(skipReveal);
  skipRef.current = skipReveal;
  useEffect(() => {
    const view = box.current?.closest("section");
    if (!view) return;
    const onClick = (ev: Event) => {
      if (!(ev.target as Element).closest("button, a, label, input")) skipRef.current();
    };
    view.addEventListener("click", onClick);
    return () => view.removeEventListener("click", onClick);
  }, []);

  if (!sess) return <div id="rv-reveal" ref={box} />;
  if (!data) return <div id="rv-reveal" ref={box}><div className="group"><p className="empty">{t("haul.openingYourHaul")}</p></div></div>;

  const { d, stickers, fresh } = data;
  const items = d.items;
  const isNew = (it: { name: string }) => fresh.has(String(it.name).toLowerCase());
  const allNew = items.length > 0 && items.every(isNew);
  const status = bossStatus(sess, d);
  const target = d.settled ? d.points.total : d.points.total - d.points.receipt;
  const title = allNew ? t("haul.yourFirst", { count: items.length }) : t("haul.yourHaul");
  const p = d.points;
  const m = (n: number) => money(n, currency);

  return (
    <div id="rv-reveal" ref={box}>
      <div className="rv-head"><h1 className="largetitle" style={{ fontSize: 28 }}>{title}</h1>
        <p className="muted nomargin">{t("haul.fromThisTripTapAnywhere", { count: items.length })}</p></div>
      <div className="rv-loot" id="rv-loot">
        {items.map((it, i) => (
          <div key={it.key + i} className={"rv-tile" + (it.boss && status === "found" ? " rv-boss" : "")} style={{ transitionDelay: `${i * 160}ms` }}>
            {/* A missing sticker falls back to the basket art. */}
            <img src={tileSrc(stickers, it)} alt={it.name}
              onError={ev => { const img = ev.currentTarget; const fb = artSrc("basket.webp"); if (!img.src.endsWith(fb)) img.src = fb; }} />
            {!allNew && isNew(it) && <span className="rv-new">{t("common.new")}</span>}
          </div>
        ))}
      </div>
      <p className="rv-pts" id="rv-pts" data-target={target} aria-hidden="true">0</p>
      <p className="rv-sr" id="rv-pts-sr" role="status" aria-live="polite"></p>
      <p className="muted rv-ptsub">{d.settled ? t("haul.banked") : t("haul.bankLater")}</p>
      <div className="group rv-lines">
        <div className="rv-row"><span>{t("haul.itemsPoints")}</span><b>+{p.items}</b></div>
        {!!p.full_haul && <div className="rv-row"><span>{t("haul.fullHaul")}</span><b>+{p.full_haul}</b></div>}
        {d.boss && (status === "found"
          ? <div className="rv-row"><span>{t("haul.bossItem")}</span><b>+{p.boss}</b></div>
          : <div className="rv-row rv-grey"><span>{t("haul.bossItemNextTime")}</span><b></b></div>)}
        {d.settled
          ? <div className="rv-row"><span>{t("common.receipt")}</span><b>+{p.receipt}</b></div>
          : <div className="rv-row rv-grey"><span>{t("haul.receiptWaitingAddItAny")}</span><b>+{p.receipt}</b></div>}
        {privateLines(d.private, m).map(r => (
          <div className="rv-row rv-private" key={r.label}><span>{r.label}</span><span className="rv-priv-n">{r.text}</span></div>
        ))}
      </div>
      <p><button className="btn primary wide" type="button" data-act="card" onClick={() => enter(nav, "haul", sess)}>{t("haul.makeMyHaulCard")}</button></p>
      {canReview(sess, d) && <p><button className="btn wide" type="button" data-act="review" onClick={() => enter(nav, "rreview", sess)}>{t("haul.checkYourReceipt")}</button></p>}
      {!d.settled && <p><button className="btn wide" type="button" data-act="addreceipt" onClick={() => setAr(true)}>{t("haul.addReceiptNow")}</button></p>}
      <p className="rv-sum"><button className="rv-link" type="button" data-act="summary" onClick={() => openScore(nav, sess)}>{t("haul.tripSummary")}</button></p>
      <AddReceiptSheet target={ar ? { sessionId: sess.id, label: sess.store } : null} goesToHaul onClose={() => setAr(false)}
        onDone={s => { setAr(false); if (s) Object.assign(sess, s); afterFinish(nav, sess); }} />
    </div>
  );
}
