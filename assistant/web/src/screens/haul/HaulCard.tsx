import { useEffect, useState } from "react";
import { useNav } from "../../app/nav";
import { useToast } from "../../ui/Toast";
import { Sheet } from "../../ui/Sheet";
import { api, get } from "../../lib/api";
import { Q, type Session } from "../hunt/model";
import { postPayload, sheetAudienceText, toggleHidden } from "./core";
import { ShareSheet, type ShareReq } from "./Share";
import { H, art, artSrc, errMsg, faceReady, fetchHaul, haulPost, hiddenKeys, loadProfile, openScore, shareCtx,
  stickersFor, type HaulView } from "./state";
import { useTranslation } from "../../i18n";

/* Port of pwa/haul.js #view-haul (openCard, paintCard, onCardClick,
 * unpost) and the #hl-post-sheet (openPostSheet, paintPostSheet,
 * onPostSheetClick). Nothing posts until Post to Crew; a post carries
 * stock character art only, never a price or a product cutout.
 * Opened with nav.reset("haul", { session }). */
type Card = { d: HaulView; fresh: number };

export function HaulCard() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast } = useToast();
  const sess = (nav.params.session as Session | undefined) || Q.current;
  const [card, setCard] = useState<Card | null>(null);
  // The post sheet: null closed, "loading" while the Crew loads, else the audience.
  const [sheet, setSheet] = useState<null | "loading" | string[]>(null);
  const [going, setGoing] = useState(false);
  const [share, setShare] = useState<ShareReq | null>(null);

  async function paintCard(s: Session) {
    const d = H.cache[s.id];
    if (!d) return;
    const { fresh } = await stickersFor(s);
    const n = d.items.filter(i => !i.hidden && fresh.has(String(i.name).toLowerCase())).length;
    d.stats.new = n;
    setCard({ d, fresh: n });
  }

  useEffect(() => {
    if (!sess) return;
    Q.current = sess;
    let live = true;
    (async () => {
      try { await fetchHaul(sess); await faceReady(); await loadProfile(); }
      catch { if (live) openScore(nav, sess, { replace: true }); return; }
      if (live) await paintCard(sess);
    })();
    return () => { live = false; };
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sess) return <div id="hl-card-body" />;
  if (!card) return <div id="hl-card-body"><div className="group"><p className="empty">{t("haul.makingYourCard")}</p></div></div>;

  const toggleHide = async (key: string) => {
    const keys = toggleHidden(hiddenKeys(H.cache[sess.id]), key);
    const d = await haulPost(sess, "/hide", { key, hidden: keys.has(key) });
    if (d.post && d.post.taken_down) toast(t("haul.takenDown"));
    return d;
  };
  const onHide = async (key: string) => {
    try { await toggleHide(key); await paintCard(sess); } catch (e) { toast(errMsg(e)); }
  };
  const unpost = async (quiet: boolean) => {
    try {
      const d = await api<HaulView>(`/api/quest/sessions/${encodeURIComponent(sess.id)}/haul/post`, { method: "DELETE" });
      H.cache[sess.id] = d;
      if (!quiet) toast(t("haul.postDeleted"));
      await paintCard(sess);
    } catch (e) { toast(errMsg(e)); }
  };
  const openPostSheet = async () => {
    setSheet("loading");
    setGoing(false);
    let audience: string[] = [];
    try { audience = (await get("/api/quest/crew/audience")).audience || []; } catch { audience = []; }
    setSheet(audience);
  };
  const postGo = async () => {
    setGoing(true);
    try {
      const d = H.cache[sess.id];
      const payload = postPayload(d.items.map(i => ({ name: i.name, art: art(i.name) })));
      await haulPost(sess, "/post", payload);
      setSheet(null);
      await paintCard(sess);
      toast(t("haul.postedToast"), { action: t("common.undo"), onAction: () => { unpost(true); } });
    } catch (e) { setGoing(false); toast(errMsg(e)); }
  };

  const { d, fresh } = card;
  const shown = d.items.filter(i => !i.hidden).length;
  const p = H.profile || {};
  const posted = d.post && d.post.posted;
  const reacts = posted && d.post.reactions ? d.post.reactions : null;
  const label = (i: { hidden?: boolean; name: string }) => (i.hidden ? t("haul.showIn", { name: i.name }) : t("haul.hideFrom", { name: i.name }));
  const left = d.items.filter(i => !i.hidden).length;

  return (
    <div id="hl-card-body">
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("haul.yourHaulCard")}</h2>
      <div className="hl-card">
        <div className="hl-top"><span className="hl-chip">{t("haul.namedByArya")}</span>
          {posted && <button type="button" className="rv-link" data-act="delpost" onClick={() => unpost(false)}>{t("haul.deletePost")}</button>}</div>
        <h3 className="hl-name">{d.name}</h3>
        <div className="hl-flat" id="hl-flat">
          {d.items.map(i => (
            <button key={i.key} type="button" className={"hl-st" + (i.hidden ? " hid" : "")} data-hide={i.key} aria-pressed={!!i.hidden}
              aria-label={label(i)} onClick={() => onHide(i.key)}><img src={artSrc(art(i.name))} alt="" /></button>
          ))}
        </div>
        <p className="hl-hint">{t("haul.tapAStickerToHide")}</p>
        <div className="hl-stats"><div><b>{shown}</b><span>{t("haul.items")}</span></div><div><b>{fresh}</b><span>{t("haul.newFinds")}</span></div><div><b>{d.stats.level}</b><span>{t("haul.level")}</span></div></div>
        {d.boss && d.boss.found && <p className="hl-bosschip"><span className="hl-chip">{t("haul.bossItem")}</span></p>}
        <p className="hl-foot">{p.handle ? "@" + p.handle + " · " : ""}{t("haul.levelNoPrices", { level: d.stats.level })}</p>
      </div>
      <div className="hl-actions">
        <button className="btn" type="button" data-act="save"
          onClick={() => setShare({ kind: "haul", ctx: { ...shareCtx(sess), newBadge: H.newBadge || null } })}>{t("haul.saveAsImage")}</button>
        <button className="btn primary" type="button" data-act="post" onClick={openPostSheet}>{posted ? t("haul.updatePost") : t("haul.postToCrew")}</button>
      </div>
      <p className="muted">{posted
        ? t("haul.postedNote")
        : t("haul.notPostedNote")}{reacts && (reacts.yum + reacts.me_too + reacts.teach_me)
        ? t("haul.reactions", { yum: reacts.yum, meToo: reacts.me_too, teachMe: reacts.teach_me }) : ""}</p>
      <p><button className="btn secondary wide" type="button" data-act="done" onClick={() => openScore(nav, sess)}>{t("common.done")}</button></p>

      <Sheet open={sheet !== null} onClose={() => setSheet(null)} id="hl-post-sheet" labelledBy="hl-post-title">
        <div className="row"><span className="name" id="hl-post-title">{t("haul.postToCrew")}</span><button id="hl-post-x" className="btn" type="button" onClick={() => setSheet(null)}>{t("common.cancel")}</button></div>
        <div id="hl-post-body">
          {sheet === "loading" ? <p className="empty">{t("haul.checkingYourCrew")}</p>
            : sheet && !sheet.length ? <>
              <p>{t("haul.youHaveNoCrewYet")}</p>
              <p className="muted">{t("haul.addAFriendByHandle")}</p>
              <p><button className="btn primary wide" type="button" data-act="addfriend" onClick={() => { setSheet(null); nav.show("friends"); }}>{t("haul.addAFriend")}</button></p>
            </> : sheet ? <>
              <p>{t("haul.sharedWithCrewNoPrices", { who: sheetAudienceText(sheet) })}</p>
              <div className="hl-flat" id="hl-post-flat">
                {d.items.map(i => (
                  <span className="hl-xwrap" key={i.key}><button type="button" className={"hl-st" + (i.hidden ? " hid" : "")} data-hide={i.key} aria-pressed={!!i.hidden}
                    aria-label={label(i)} onClick={() => onHide(i.key)}><img src={artSrc(art(i.name))} alt="" /><span className="hl-x" aria-hidden="true">{i.hidden ? "+" : "×"}</span></button></span>
                ))}
              </div>
              <p className="muted">{t("haul.tapAStickerToHide2", { count: left })}</p>
              <p className="hl-btnrow"><button className="btn primary" type="button" data-act="postgo" disabled={!left || going} onClick={postGo}>{t("haul.post")}</button>
                <button className="btn" type="button" data-act="postcancel" onClick={() => setSheet(null)}>{t("common.cancel")}</button></p>
            </> : null}
        </div>
      </Sheet>
      <ShareSheet req={share} onClose={() => setShare(null)} />
    </div>
  );
}
