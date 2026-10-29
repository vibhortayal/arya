import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { clearOnSignOut } from "../app/session";
import { get } from "../lib/api";
import { asset } from "../lib/format";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-album and pwa/album.js renderAlbum and
 * its sticker sheet. The New sticker card and the level-up card belong
 * to the hunt and Today, not to this screen, so they are not here.
 * The Shell already renders <section id="view-album">. */
const ALB_SLOTS = 8;
const ALB_FALLBACK_ART = "basket.webp";
const ALB_OTHER = "Other finds";
const ALB_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Sticker = { id: string; name: string; image?: string; image_url?: string; art?: string; found_count?: number; first_found_at?: string; store?: string };
type Badge = { name: string; earned?: boolean; text?: string; to_go?: number };
type Page = { id: string; kind?: string; title?: string; size?: number; count?: number; note?: string; stickers?: Sticker[]; badge?: Badge };
type View = { total?: number; pages?: Page[]; chapters?: { text: string; earned?: boolean }[] };

// Kept across visits, like albState in album.js.
let lastView: View | null = null;
let lastTab: string | null = null;
clearOnSignOut(() => { lastView = null; lastTab = null; });

function albDate(iso?: string) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${ALB_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}
export function stickerSrc(st: Sticker | null | undefined) {
  if (st && st.image === "cutout" && st.image_url) return st.image_url;
  return asset("assets/characters/" + ((st && st.art) || ALB_FALLBACK_ART));
}
export function slots(page: Page): (Sticker | null)[][] {
  const list = page.stickers || [];
  if (page.kind === "other") {
    const size = Math.max(page.size || 4, list.length, 4);
    return [Array.from({ length: size }, (_, i) => list[i] || null)];
  }
  const n = Math.max(1, Math.ceil(list.length / ALB_SLOTS));
  const out: (Sticker | null)[][] = [];
  for (let c = 0; c < n; c++) out.push(Array.from({ length: ALB_SLOTS }, (_, i) => list[c * ALB_SLOTS + i] || null));
  return out;
}
export function progressText(page: Page) {
  const count = page.count || 0;
  const size = page.size || ALB_SLOTS;
  return count > size ? `${count} stickers` : `${count} of ${size}`;
}
const progressPct = (page: Page) => Math.max(0, Math.min(100, Math.round(100 * (page.count || 0) / (page.size || ALB_SLOTS))));

export function Album() {
  const { t } = useTranslation();
  const nav = useNav();
  const [view, setView] = useState<View | null>(lastView);
  const [tab, setTabState] = useState<string | null>(lastTab);
  const [open, setOpen] = useState<Sticker | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { showErr } = useToast();
  const strip = useRef<HTMLDivElement>(null);
  const left = useRef(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    get<View>("/api/quest/album").then(v => { lastView = v; if (live) setView(v); })
      .catch(e => { if (!live) return; setFailed(true); showErr(e); }); // album.js renderAlbum().catch(showErr)
    return () => { live = false; };
  }, [attempt, showErr]);

  const pages = view?.pages || [];
  const curId = pages.find(p => p.id === tab) ? tab : pages.length ? pages[0].id : null;
  const cur = pages.find(p => p.id === curId);
  const setTab = (id: string) => { left.current = strip.current?.scrollLeft || 0; lastTab = id; setTabState(id); };

  // The strip scrolls sideways; keep its place and show the chosen tab.
  useLayoutEffect(() => {
    const s = strip.current;
    if (!s) return;
    s.scrollLeft = left.current;
    s.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [curId, view]);

  const sub = !view ? "" : view.total === 1 ? "1 sticker collected" : `${view.total || 0} stickers collected`;

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back("community"); }}>{t("common.back")}</a></p>
      <h2 className="largetitle">{t("common.album")}</h2>
      <p className="subtitle" id="alb-sub">{sub}</p>
      <div id="alb-body">
        {!view ? (failed
          ? <p className="empty">{t("album.couldNotLoadYourAlbum")}{" "}<button type="button" className="linkbtn" onClick={() => setAttempt(n => n + 1)}>{t("common.tryAgain")}</button></p>
          : <p className="empty">{t("album.loadingYourAlbum")}</p>) : (
          <>
            {!view.total && (
              <div className="group pad albempty"><div className="emptyface-wrap"><img className="emptyface" src={asset("assets/characters/basket.webp")} alt="" /></div>
                <p className="empty">{t("album.noStickersYetGrabAn")}</p></div>
            )}
            {pages.length > 0 && (view.total || cur) && (
              <div className="albtabs" role="group" aria-label={t("album.albumPages")} ref={strip}>
                {pages.map(p => (
                  <button key={p.id} type="button" className="albtab" data-alb-tab={p.id} aria-pressed={p.id === curId}
                    onClick={() => setTab(p.id)}>{p.title || (p.kind === "other" ? ALB_OTHER : p.id)}</button>
                ))}
              </div>
            )}
            {cur && <PageView page={cur} onOpen={setOpen} />}
            {(view.chapters || []).map((c, i) => (
              <div className="group pad albchapter" key={i}>
                <img className="albchimg" src={asset("assets/characters/compass.webp")} alt="" />
                <div className="grow"><b>{t("album.communityChapter")}</b><span className="sub">{c.text}</span></div>
                {c.earned && <span className="albchip">{t("common.earned")}</span>}
              </div>
            ))}
            <p className="muted albprivate">{t("album.yourAlbumIsPrivateOnly")}</p>
          </>
        )}
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} id="alb-sheet" labelledBy="alb-sheet-title">
        {open && <StickerSheet st={open} onClose={() => setOpen(null)} />}
      </Sheet>
    </>
  );
}

function PageView({ page, onOpen }: { page: Page; onOpen: (s: Sticker) => void }) {
  const { t } = useTranslation();
  const chunks = slots(page);
  const season = page.kind === "season" ? " season" : "";
  const b = page.badge;
  return (
    <div className="group pad albpage">
      <div className="albhead"><b className="albtitle">{page.title || (page.kind === "other" ? ALB_OTHER : page.id)}</b>
        {page.kind === "season" && <span className="albchip">{t("album.seasonal")}</span>}
        <span className="albcount">{progressText(page)}</span></div>
      <div className="albprog" role="progressbar" aria-valuemin={0} aria-valuemax={page.size || ALB_SLOTS} aria-valuenow={page.count || 0}>
        <i style={{ width: progressPct(page) + "%" }} /></div>
      {page.note && <p className="sub albnote">{page.note}</p>}
      {chunks.map((chunk, i) => (
        <div key={i}>
          {chunks.length > 1 && <p className="sub albchunk">{t("album.sheet")}{" "}{i + 1}{" "}{t("album.of", { chunksCount: chunks.length })}</p>}
          <div className="albgrid">
            {chunk.map((st, j) => st
              ? <button key={j} type="button" className={"albslot" + season} data-alb-slot={st.id} aria-label={st.name} onClick={() => onOpen(st)}>
                  <img src={stickerSrc(st)} alt="" loading="lazy" /></button>
              : <div key={j} className={"albslot empty" + season} aria-label={t("album.notFoundYet")} />)}
          </div>
        </div>
      ))}
      {b && (
        <div className={"albbadge" + (b.earned ? " earned" : "")}>
          <div className="grow"><b>{b.name}</b><span className="sub">{b.text || (b.earned ? `${b.name} earned.` : `${b.to_go} to go. No rush.`)}</span></div>
          {b.earned && <span className="albchip">{t("common.earned")}</span>}
        </div>
      )}
    </div>
  );
}

function StickerSheet({ st, onClose }: { st: Sticker; onClose: () => void }) {
  const { t } = useTranslation();
  const cut = st.image === "cutout";
  const n = st.found_count || 1;
  return (
    <div className="albsheet">
      <img className="albsheetimg" src={stickerSrc(st)} alt="" />
      <h3 className="albsheettitle" id="alb-sheet-title">{st.name}</h3>
      {st.first_found_at && <p className="sub">{t("album.firstFound", { albDate: albDate(st.first_found_at) })}{st.store ? ` at ${st.store}` : ""}</p>}
      <p className="sub">{t("album.foundInHunt", { n })}{n === 1 ? "" : "s"}</p>
      <p className="albtruth">{cut ? "Only the product is kept in your album. No people." : "This sticker uses stock art. Your album keeps no photo of it."}</p>
      <button type="button" className="btn secondary wide" data-alb-close onClick={onClose}>{t("common.close")}</button>
    </div>
  );
}
