import { useEffect, useState } from "react";
import { useSession } from "../../app/session";
import { useToast } from "../../ui/Toast";
import { Sheet } from "../../ui/Sheet";
import { api, get, post } from "../../lib/api";
import { queuePick, queuedCount, sameToast, sampleHaul, type FeedPost, type PickRow } from "./core";
import { H, artSrc, errMsg, faceReady } from "./state";
import { useTranslation } from "../../i18n";

/* Port of pwa/haul.js paintFeed, feedCard, onFeedClick and the
 * #hl-same-sheet: the Crew hauls feed. No chat, no comments: a
 * reaction is one of three stickers, and Same haul queues a post's
 * items for the next hunt. Rendered as the old paintFeed inserts it:
 * <h3 class="sect">Crew hauls</h3><div id="comm-hauls" class="group">. */
/* Reaction names are en.json keys. */
const REACTIONS: [string, string, string][] = [
  ["yum", "haul.react.yum", "banana.webp"],
  ["me_too", "haul.react.meToo", "basket.webp"],
  ["teach_me", "haul.react.teachMe", "binoculars.webp"],
];

export function CrewFeed() {
  const { t } = useTranslation();
  const { demo } = useSession();
  const { toast } = useToast();
  const [feed, setFeed] = useState<FeedPost[] | null>(null);
  const [, tick] = useState(0);
  const repaint = () => tick(n => n + 1);
  const [same, setSame] = useState<null | "loading" | { post: FeedPost; rows: PickRow[] }>(null);
  const [going, setGoing] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      await faceReady();
      let f: FeedPost[] = [], queued: { id: string; post_id: string }[] = [];
      try { f = (await get("/api/quest/crew/feed")).feed || []; } catch { f = []; }
      try { queued = (await get("/api/quest/queued")).queued || []; } catch { queued = []; }
      H.queuedIds = {};
      queued.forEach(r => { (H.queuedIds[r.post_id] = H.queuedIds[r.post_id] || []).push(r.id); });
      H.feed = f.length ? f : [sampleHaul()];
      if (live) setFeed(H.feed);
    })();
    return () => { live = false; };
  }, []);

  const react = async (p: FeedPost, k: string) => {
    const kind = p.my_reaction === k ? "none" : k;
    try {
      if (!p.sample) await post(`/api/quest/crew/posts/${encodeURIComponent(p.author)}/${encodeURIComponent(p.post_id)}/react`, { kind });
      p.my_reaction = kind === "none" ? null : kind;
      repaint();
    } catch (e) { toast(errMsg(e)); }
  };
  const onSame = async (p: FeedPost) => {
    if ((H.queuedIds[p.post_id] || []).length) {
      try {
        for (const id of H.queuedIds[p.post_id]) await api(`/api/quest/queued/${encodeURIComponent(id)}`, { method: "DELETE" });
        H.queuedIds[p.post_id] = [];
        repaint();
        toast(t("haul.takenOut"));
      } catch (e) { toast(errMsg(e)); }
      return;
    }
    setSame("loading");
    setGoing(false);
    let listNames: string[] = [], queuedNames: string[] = [];
    try { listNames = ((await get("/api/quest/plan")).list || []).map((i: { name: string }) => i.name); } catch { listNames = []; }
    try { queuedNames = ((await get("/api/quest/queued")).queued || []).map((r: { name: string }) => r.name); } catch { queuedNames = []; }
    setSame({ post: p, rows: queuePick(p.items, listNames, queuedNames) });
  };
  const sameGo = async () => {
    if (!same || same === "loading") return;
    const { post: p, rows } = same;
    const names = rows.filter(r => r.checked).map(r => r.name);
    setGoing(true);
    try {
      const res = await post("/api/quest/queued", { from: p.author, post_id: p.post_id, names });
      const mine = (res.queued || []).filter((r: { post_id: string }) => r.post_id === p.post_id);
      H.queuedIds[p.post_id] = mine.map((r: { id: string }) => r.id);
      setSame(null);
      repaint();
      toast(sameToast(queuedCount(res.queued, p.post_id), names.length));
    } catch (e) { setGoing(false); toast(errMsg(e)); }
  };

  const card = (p: FeedPost) => {
    const sample = !!p.sample;
    const avatar = (p.items[0] && p.items[0].art) || "basket.webp";
    const queued = (H.queuedIds[p.post_id] || []).length > 0;
    return (
      <div className="hl-fcard" data-post={p.post_id} data-author={p.author} key={p.post_id}>
        <div className="hl-fhead"><img className="hl-av" src={artSrc(avatar)} alt="" />
          <div className="grow"><b>@{p.author}</b>{sample && <span className="samplepill">{t("common.sample")}</span>}
            <span className="sub">{p.name} · {t("common.itemCount", { count: p.items.length })}</span></div></div>
        <div className="hl-fflat">{p.items.map((i, n) => <img key={n} src={artSrc(i.art || "basket.webp")} alt={i.name} />)}</div>
        <div className="hl-reacts">
          {REACTIONS.map(([k, label, file]) => (
            <button key={k} className="hl-react" type="button" data-react={k} aria-pressed={p.my_reaction === k} onClick={() => react(p, k)}>
              <img src={artSrc(file)} alt="" /><span>{t(label)}</span></button>
          ))}
          {sample && !demo
            ? <button className="hl-react hl-same" type="button" disabled>{t("haul.exampleOnly")}</button>
            : <button className="hl-react hl-same" type="button" data-same={p.post_id} aria-pressed={queued} onClick={() => onSame(p)}>{queued ? t("haul.inNextHunt") : t("haul.sameHaul")}</button>}
        </div>
      </div>
    );
  };

  const n = same && same !== "loading" ? same.rows.filter(r => r.checked).length : 0;
  return (
    <>
      <h3 className="sect">{t("haul.crewHauls")}</h3>
      <div id="comm-hauls" className="group">{(feed || []).map(card)}</div>
      <Sheet open={same !== null} onClose={() => setSame(null)} id="hl-same-sheet" labelledBy="hl-same-title">
        <div className="row"><span className="name" id="hl-same-title">{t("haul.sameHaul")}</span><button id="hl-same-x" className="btn" type="button" onClick={() => setSame(null)}>{t("common.cancel")}</button></div>
        <div id="hl-same-body">
          {same === "loading" ? <p className="empty">{t("haul.checkingYourList")}</p> : same ? <>
            <p className="muted">{t("haul.pickWhatYouWantIn")}</p>
            <div className="group">{same.rows.map((r, i) => (
              <label className="hl-pick" key={i}><input type="checkbox" data-row={i} checked={r.checked}
                onChange={e => { r.checked = e.target.checked; setSame({ ...same }); }} />
                <span className="grow"><span className="name">{r.name}</span>{r.note ? <span className="sub">{r.note}</span> : null}</span></label>
            ))}</div>
            <p><button className="btn primary wide" type="button" data-act="samego" disabled={n === 0 || going} onClick={sameGo}>{t("haul.addToYourNextHunt", { n })}</button></p>
          </> : null}
        </div>
      </Sheet>
    </>
  );
}
