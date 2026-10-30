import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNav } from "../app/nav";
import { useGuide } from "../ui/Guide";
import { useSession } from "../app/session";
import { useAvatar } from "../app/avatar";
import { useToast } from "../ui/Toast";
import { Sheet } from "../ui/Sheet";
import { DirectorPanel } from "../ui/Town";
import { useTown } from "../lib/town";
import { A2hsRow } from "../ui/A2hs";
import { Row } from "../ui/kit";
import { IconPen } from "../ui/icons";
import { AddReceiptSheet, type ReceiptTarget } from "../ui/AddReceiptSheet";
import { get, post } from "../lib/api";
import { CURRENCY_SYMBOLS, MONTHS, asset, fmtShort } from "../lib/format";
import { characterManifest } from "../lib/characters";
import { languageToast } from "../lib/language";
import { t, useTranslation } from "../i18n";

/* Port of pwa/index.html #view-profile and app.js renderProfile, the
 * avatar editor (app.js loadAvatar...), Reminders (push.js), the
 * Add to Home Screen row (a2hs.js) and the Group section (group.js).
 * Profile is also the Settings tab: with no nav.params.from the Back
 * link is hidden. Quest stats, badges and mapped stores live on the
 * quest-progress view, opened from the Quest tab (usability pass).
 * Local helpers (not in ui/): GroupSection, Reminders. The Add to
 * Home Screen row is ui/A2hs.tsx. */

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const cap = (h: string) => (h ? h.charAt(0).toUpperCase() + h.slice(1) : "");

type QProfile = { handle: string; level?: number; points?: number; stats: { hunts: number; streak_weeks?: number }; badges?: { id: string; earned?: boolean }[]; mapped_stores?: string[] };
type Unsettled = { session_id: string; store: string; finished_at?: string; items_collected: number; items_total: number };
type Archive = { receipts: unknown[]; unsettled?: Unsettled[] };

export function Profile() {
  const { t } = useTranslation();
  const nav = useNav();
  const town = useTown();
  const guide = useGuide();
  const { demo, user, currency, setCurrency, language, languages, setLanguage, leave } = useSession();
  const { toast, showErr } = useToast();
  const from = nav.params.from as string | undefined;
  const [profile, setProfile] = useState<QProfile | null>(null);
  const [archive, setArchive] = useState<Archive>({ receipts: [] });
  const [ar, setAr] = useState<ReceiptTarget | null>(null);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState("");

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      get<QProfile>("/api/quest/profile").catch(() => null),
      get<Archive>("/api/quest/receipts").catch(() => ({ receipts: [] })),
    ]);
    setProfile(p);
    // Who sees the receipts: you alone, or you and your group by name.
    get<{ group: { name: string } | null }>("/api/group").then(g => setGroupName(g?.group?.name || null), () => setGroupName(null));
    setArchive(a);
    // renderProfile marked the earned badges seen (quest.js qMarkBadgesSeen).
    if (p) {
      try { localStorage.setItem("arya-seen-badges", JSON.stringify((p.badges || []).filter(b => b.earned).map(b => b.id))); }
      catch { /* storage unavailable */ }
    }
  }, []);
  useEffect(() => { load().catch(showErr); }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const unsettled = archive.unsettled || [];
  const attempt = async (f: () => Promise<void>) => { try { await f(); } catch (e) { toast(errMsg(e)); } };

  // No zero scores (relevant cards, owner 2026-10-30): level and points
  // once a quest has earned any; before that the streak alone, or what
  // the first quest gives.
  const level = profileLine(profile);

  const dismiss = (sid: string) => attempt(async () => {
    if (!confirm(t("receipts.confirmDismiss"))) return;
    await post(`/api/quest/sessions/${encodeURIComponent(sid)}/delete`, {});
    toast(t("receipts.huntDismissed"));
    load().catch(showErr);
  });

  const pickCurrency = (code: string) => attempt(async () => {
    const prev = currency;
    try {
      const r = await post("/api/settings", { currency: code });
      setCurrency({ code: r.currency, symbol: r.symbol });
      toast(t("settings.pricesIn", { currency: r.currency }));
    } catch (e) { setCurrency(prev); throw e; }
  });

  const pickLanguage = (code: string) => attempt(async () => {
    const prev = language;
    setLanguage(code);
    try {
      const r = await post<{ language: string }>("/api/settings", { language: code });
      setLanguage(r.language);
      toast(languageToast(r.language, languages));
    } catch (e) { setLanguage(prev); throw e; }
  });

  const eraseAccount = () => attempt(async () => {
    if (!delPw) { toast(t("settings.enterPassword")); return; }
    await post("/auth/account/delete", { password: delPw });
    await leave();
  });
  const signOut = async () => {
    await fetch("/auth/logout", { method: "POST" }).catch(() => {});
    await leave();
  };
  // The box focuses its password field when it opens (app.js).
  useEffect(() => { if (delOpen) (document.getElementById("del-account-pw") as HTMLInputElement | null)?.focus(); }, [delOpen]);

  const go = (view: Parameters<typeof nav.show>[0]) => () => nav.show(view);
  const NavRow = ({ id, view, title, sub, subId }: { id?: string; view: Parameters<typeof nav.show>[0]; title: string; sub: string; subId?: string }) => (
    <button className="navrow" id={id} type="button" onClick={go(view)}>
      <span className="grow">{title}<span className="sub" id={subId}>{sub}</span></span><span className="chev">›</span></button>
  );

  return (
    <>
      {from && <p><a href="#" id="pf-back" onClick={ev => { ev.preventDefault(); nav.back(from as any); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>}
      <h2 className="largetitle">{t("settings.settings")}</h2>
      <AvatarCard handle={profile ? "@" + profile.handle : ""} level={level} />
      {town ? <DirectorPanel /> : null}
      <GroupSection />
      <div id="pf-missing" className="group" hidden={!unsettled.length}>
        {unsettled.map(e => (
          <div key={e.session_id} className="sessrow">
            <span className="grow"><span className="name">{e.store}</span>
              <span className="sub">{t("settings.finishedReceiptMissingOfCollected", { slice: fmtShort(String(e.finished_at || "").slice(0, 10)), items_collected: e.items_collected, items_total: e.items_total })}</span></span>
            <button className="btn" data-upload={e.session_id} data-store={e.store} type="button"
              onClick={() => setAr({ sessionId: e.session_id, label: e.store })}>{t("common.addReceipt")}</button>
            <button className="btn" data-dismiss={e.session_id} type="button" onClick={() => dismiss(e.session_id)}>{t("common.dismiss")}</button>
          </div>
        ))}
      </div>
      {/* Most of this tab is the user's data, not settings: a "Your data"
        * heading groups Stores, Receipts and Spending (labels audit,
        * judgement call 4; the tab keeps the name Settings). */}
      <h3 className="sect" id="pf-data-head">{t("settings.yourData")}</h3>
      <div className="group">
        <NavRow view="stores-mine" title={t("settings.stores")} sub={t("settings.yourStoresFavoritesAndThe")} />
        <NavRow id="btn-receipts" view="receipts" title={t("common.receipts")} subId="pf-receipts-sub"
          sub={receiptsSub(archive.receipts.length, groupName)} />
        <NavRow id="btn-analysis" view="analysis" title={t("common.analysis")} sub={t("settings.spendingByMonthAndStore")} />
      </div>
      <div className="group">
        {/* One help row (usability pass): the tour replay lives inside the
          * guide; Quest progress moved into the Quest tab. */}
        <button className="navrow" id="btn-guide" type="button" onClick={() => guide.open()}>
          <span className="grow">{t("settings.helpAndGuide")}<span className="sub">{t("settings.helpAndGuideSub")}</span></span><span className="chev">›</span></button>
        <NavRow id="btn-powers" view="powers" title={t("common.aryaSPowers")} sub={t("settings.whatAryaCanDoAnd")} />
        <A2hsRow demo={demo} />
      </div>
      <Reminders />
      <h3 className="sect">{t("settings.account")}</h3>
      <div className="group" id="profile-account">
        <Row name={t("settings.signedInAs")} right={demo ? "demo" : user || ""} />
        <div className="row"><div className="grow"><span className="name">{t("settings.currency")}</span><span className="sub">{t("settings.howPricesShowAryaDoes")}</span></div>
          <select id="pf-currency" className="curpick" aria-label={t("settings.currency")} value={currency.code} onChange={ev => pickCurrency(ev.target.value)}>
            {["USD", "EUR", "GBP", "INR", "CAD", "AUD"].map(c => <option key={c} value={c}>{CURRENCY_SYMBOLS[c]} {c}</option>)}
          </select></div>
        <div className="row"><div className="grow"><span className="name">{t("settings.language")}</span><span className="sub">{t("settings.whatAryaAnswersInAuto")}</span></div>
          <select id="pf-language" className="curpick" aria-label={t("settings.language")} value={language} onChange={ev => pickLanguage(ev.target.value)}>
            {languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select></div>
        <RegistrationRow />
      </div>
      <div className="group">
        <NavRow id="btn-feedback" view="feedback" title={t("settings.featureRequestContactUs")} sub={t("settings.tellUsWhatToBuild")} />
        <NavRow id="btn-muse" view="muse" title={t("settings.connectAnAiAgent")} sub={t("settings.useAryaFromYourOwn")} />
        <NavRow id="btn-about" view="about" title={t("common.about")} sub={t("settings.builtOnMetaModels")} />
      </div>
      <div className="group">
        <a className="navrow" href="/api/account/export"><span className="grow">{t("settings.exportMyData")}<span className="sub">{t("settings.everythingAryaHoldsForYou")}</span></span><span className="chev">›</span></a>
        <button className="navrow" id="btn-del-account" type="button" onClick={() => setDelOpen(o => !o)}>
          <span className="grow">{t("settings.deleteMyAccount")}<span className="sub">{t("settings.eraseYourAccountAndAll")}</span></span><span className="chev">›</span></button>
        <div id="del-account-box" className="pad" hidden={!delOpen}>
          <p className="muted">{t("settings.thisErasesYourReceiptsLists")}</p>
          <input type="password" id="del-account-pw" autoComplete="current-password" placeholder={t("settings.yourPassword")} value={delPw}
            onChange={e => setDelPw(e.target.value)} />
          <p style={{ marginTop: 10 }}><button className="btn danger" id="btn-del-account-go" type="button" onClick={eraseAccount}>{t("settings.eraseEverything")}</button></p>
        </div>
      </div>
      <p style={{ marginTop: 22 }}><button id="btn-signout2" className="btn secondary wide" type="button"
        onClick={signOut}>{t("settings.signOut")}</button></p>

      <AddReceiptSheet target={ar} onClose={() => setAr(null)} onDone={() => load().catch(showErr)} />
    </>
  );
}

/* ---------------- Avatar (app.js loadAvatar and the av-* handlers) ---------------- */
export function profileLine(profile: QProfile | null): string {
  const s = profile?.stats;
  if (!profile || !s) return "";
  if ((profile.points || 0) > 0) return t("settings.levelLine", { level: profile.level || 1, points: profile.points }) + (s.streak_weeks ? t("settings.streak", { n: s.streak_weeks }) : "");
  return s.streak_weeks ? t("settings.shoppingWeeks", { count: s.streak_weeks }) : t("settings.firstQuestLevel");
}

export function receiptsSub(count: number, group: string | null): string {
  const who = group ? t("settings.seenBy.group", { group }) : t("settings.seenBy.you");
  return count ? t("settings.receiptsCount", { count }) + " · " + who : cap1(who);
}
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function AvatarCard({ handle, level }: { handle: string; level: string }) {
  const { t } = useTranslation();
  const { demo, user } = useSession();
  const { toast } = useToast();
  const { av, src: avSrc, reload, set: setAv } = useAvatar();
  const loaded = avSrc !== null;
  const [presets, setPresets] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");
  const [making, setMaking] = useState(false);
  const [cand, setCand] = useState<string | null>(null);

  useEffect(() => {
    // Each Profile open re-reads the avatar (app.js loadAvatar).
    (async () => {
      await reload();
      const c = await characterManifest();
      if (c) setPresets([...new Set([...(c.items || []).map(i => i.char), ...(c.categories || []).map(x => x.char),
        ...Object.values(c.roles || {}), c.fallback].filter(Boolean))] as string[]);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const src = avSrc || "";
  const current = av.file || "basket.webp";
  const showCand = () => setCand(`/api/quest/avatar/image?candidate=true&t=${Date.now()}`);

  const choose = async (f: string) => {
    try {
      await post("/api/quest/avatar", { file: f });
      setAv({ file: f, image: false });
      try { localStorage.setItem("arya-avatar", f); } catch { /* ignore */ }
      setStatus("");
    } catch (e) { toast(errMsg(e)); }
  };
  const make = async () => {
    const p = prompt.trim();
    if (!p) { toast(t("settings.describeFirst")); return; }
    setMaking(true); setStatus(t("settings.drawingIt"));
    try { await post("/api/quest/avatar/generate", { prompt: p }); setStatus(""); showCand(); }
    catch (e) { setStatus(errMsg(e)); }
    setMaking(false);
  };
  const photo = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setStatus(t("settings.drawingYou"));
    try {
      const r = await fetch("/api/quest/avatar/photo", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || t("settings.couldNotMake"));
      setStatus(""); showCand();
    } catch (e) { setStatus(errMsg(e)); }
  };
  const use = async () => {
    try { const r = await post("/api/quest/avatar/use", {}); setAv(r); setCand(null); toast(t("settings.avatarSaved")); }
    catch (e) { toast(errMsg(e)); }
  };

  return (
    <div id="pf-avatar" className="group pad">
      <div className="avwrap"><div className="avatar big" id="pf-avatar-pic"><span id="pf-avatar-initial">{(demo ? "demo" : String(user || "A")).charAt(0).toUpperCase()}</span>
        <img id="pf-avatar-img" alt="" hidden={!loaded} src={loaded ? src : undefined} /></div>
</div>
      <p className="nomargin" style={{ textAlign: "center" }}><strong id="pf-handle" style={{ fontSize: 19 }}>{handle}</strong></p>
      <p className="muted nomargin" id="pf-level" style={{ textAlign: "center" }}>{level}</p>
      <div id="av-panel" hidden={!open}>
        <p className="muted nomargin small" style={{ textAlign: "center" }}>{t("settings.alsoHostsTheHaulCards")}</p>
        <div id="av-presets" className="presetrow">
          {presets.map(f => (
            <button key={f} type="button" data-file={f} aria-label={f.replace(".webp", "")} aria-pressed={!av.image && f === current}
              onClick={() => choose(f)}><img src={asset(`assets/characters/${f}`)} alt="" /></button>
          ))}
        </div>
        <div id="av-make-box" hidden={demo}>
          <div className="avrow"><input type="text" id="av-prompt" maxLength={200} placeholder={t("settings.describeItAFoxWith")} aria-label={t("settings.describeYourAvatar")}
            autoComplete="off" value={prompt} onChange={e => setPrompt(e.target.value)} />
            <button id="av-make" className="btn compact primary" type="button" disabled={making} onClick={make}>{t("settings.make")}</button></div>
          <p className="nomargin avalt"><label className="linkbtn" htmlFor="av-photo">{t("settings.orUseMyPhoto")}</label>
            <input type="file" id="av-photo" accept="image/*" hidden onChange={photo} /><span className="muted">{" "}{t("settings.drawnAsACartoonThen")}</span></p>
          <div id="av-candidate" className="avcand" hidden={!cand}>
            <img id="av-cand-img" className="candimg" alt={t("settings.yourNewAvatar")} src={cand || undefined} />
            <button id="av-use" className="btn compact primary" type="button" onClick={use}>{t("settings.useThis")}</button>
          </div>
        </div>
      </div>
      <p id="av-status" className="muted nomargin" style={{ textAlign: "center" }}>{status}</p>
      <p className="nomargin" style={{ textAlign: "center", marginTop: 10 }}><button className="btn compact" id="av-edit-label" type="button" aria-expanded={open} aria-controls="av-panel" onClick={() => setOpen(o => !o)}>{open ? t("common.done") : t("settings.editAvatar")}</button></p>
    </div>
  );
}

/* ---------------- Reminders (push.js) ---------------- */
type PushCfg = { enabled: boolean; notice_days: number; subscribed: boolean; public_key?: string };
const keyBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

function RegistrationRow() {
  const { t } = useTranslation();
  const [st, setSt] = useState<{ registration_open: boolean; can_manage: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try { setSt(await get<{ registration_open: boolean; can_manage: boolean }>("/auth/registration")); }
      catch { setSt(null); }
    })();
  }, []);

  // Owner only: the server names one account (can_manage); every
  // other account — and any failure — renders nothing at all.
  if (!st || !st.can_manage) return null;
  const on = st.registration_open;
  const toggle = async () => {
    setBusy(true);
    try {
      const r = await post<{ registration_open: boolean }>("/auth/registration", { open: !on });
      setSt({ ...st, registration_open: r.registration_open });
    } catch { /* keep the old state; the switch simply stays put */ }
    setBusy(false);
  };
  return (
    <div className="row"><span className="grow"><span className="name">{t("settings.registration")}</span>
      <span className="sub">{on ? t("settings.registrationOn") : t("settings.registrationOff")}</span></span>
      <button className="sw" id="reg-switch" type="button" role="switch" aria-checked={on} aria-label={t("settings.registration")} disabled={busy} onClick={toggle}><i></i></button></div>
  );
}

function Reminders() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<PushCfg>({ enabled: false, notice_days: 2, subscribed: false });
  const [note, setNote] = useState(() => t("settings.remNote"));
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [noSwitch, setNoSwitch] = useState(false);

  useEffect(() => {
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
      let c: PushCfg;
      try { c = await get<PushCfg>("/api/push/config"); } catch { c = { enabled: false, notice_days: 2, subscribed: false }; }
      if (!c.enabled) { setCfg(c); return; }
      // A saved subscription the phone no longer has means "off" here.
      if (c.subscribed && supported) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && (await reg.pushManager.getSubscription());
        if (!sub) c = { ...c, subscribed: false };
      }
      setCfg(c);
      if (!supported || (ios && !standalone)) {
        setNote(ios ? t("settings.remIos") : t("settings.remUnsupported"));
        setNoSwitch(!supported);
      }
    })();
  }, []);

  const pushPost = (path: string, body?: unknown) => post<PushCfg>(path, body || {});
  const turnOn = async () => {
    if (Notification.permission === "denied") { setNote(t("settings.remBlocked")); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { setNote(t("settings.remNeedPermission")); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: keyBytes(cfg.public_key || ""),
    });
    setCfg(await pushPost("/api/push/subscribe", { subscription: sub.toJSON() }));
    setNote(t("settings.remNote"));
  };
  const turnOff = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    const endpoint = sub && sub.endpoint;
    if (sub) await sub.unsubscribe().catch(() => {});
    setCfg(await pushPost("/api/push/unsubscribe", { endpoint }));
  };
  const toggle = async () => {
    setBusy(true);
    try { await (cfg.subscribed ? turnOff() : turnOn()); }
    catch (e) { setNote(errMsg(e) || t("settings.remCouldNotChange")); }
    setBusy(false);
  };
  const days = async (delta: number) => {
    const n = Math.min(7, Math.max(1, cfg.notice_days + delta));
    if (n === cfg.notice_days) return;
    try { setCfg(await pushPost("/api/push/settings", { notice_days: n })); } catch (e) { setNote(errMsg(e)); }
  };
  const test = async () => {
    setTestBusy(true);
    try { await pushPost("/api/push/test"); setNote(t("settings.remTestSent")); }
    catch (e) { setNote(errMsg(e) || t("settings.remTestFailed")); }
    setTestBusy(false);
  };

  const on = cfg.subscribed;
  return (
    <div id="pf-reminders" hidden={!cfg.enabled}>
      <h3 className="sect">{t("settings.reminders")}</h3>
      <div className="group">
        <div className="row"><span className="grow"><span className="name" style={{ fontWeight: 550 }}>{t("settings.remindMe")}</span>
          <span className="sub" id="rem-sub">{on ? t("settings.remOn") : t("settings.remOff")}</span></span>
          <button className="sw" id="rem-switch" type="button" role="switch" aria-checked={on} aria-label={t("settings.remindMe")} disabled={busy || noSwitch} onClick={toggle}><i></i></button></div>
        <div id="rem-more" hidden={!on}>
          <div className="row"><span className="grow"><span className="name" style={{ fontWeight: 550 }}>{t("settings.headsUp")}</span>
            <span className="sub" id="rem-days-sub">{t("settings.daysBefore", { count: cfg.notice_days })}</span></span>
            <span className="stepper"><button type="button" id="rem-dm" aria-label={t("settings.fewerDays")} onClick={() => days(-1)}>&minus;</button>
              <span className="qty" id="rem-dq">{cfg.notice_days}</span>
              <button type="button" id="rem-dp" aria-label={t("settings.moreDays")} onClick={() => days(1)}>+</button></span></div>
          <button className="navrow" id="rem-test" type="button" disabled={testBusy} onClick={test}><span className="grow accenttext">{t("settings.sendMeATestReminder")}<span className="sub">{t("settings.arrivesInAFewSeconds")}</span></span><span className="chev">›</span></button>
        </div>
      </div>
      <p className="muted small remnote" id="rem-note">{note}</p>
    </div>
  );
}

/* ---------------- Group section (group.js paintProfile / act) ---------------- */
type Member = { handle: string; me?: boolean; owner?: boolean; joined: number };
type GroupT = { name: string; members: Member[]; is_owner: boolean; max_members: number };
type GState = { enabled: boolean; group: GroupT | null };
type Leave = { name: string; lists: string[]; my_receipts: number; other_receipts: number; last_one: boolean; next_owner?: string };
type GSheet = null | { k: "start" } | { k: "rename" } | { k: "invite"; code: string; hours: number }
  | { k: "member"; handle: string } | { k: "leave"; p: Leave };

const fmtCode = (c: string) => (c.length === 6 ? c.slice(0, 3) + " " + c.slice(3) : c);
const joinedOn = (sec: number) => { const d = new Date(sec * 1000); return t("settings.joined", { date: `${MONTHS[d.getMonth()]} ${d.getDate()}` }); };

function Bul({ icon, title, sub }: { icon: string; title: ReactNode; sub?: ReactNode }) {
  return <div className="gbul"><span className="gico" aria-hidden="true">{icon}</span><span className="grow"><b>{title}</b>{sub ? <span className="sub">{sub}</span> : null}</span></div>;
}

function GroupSection() {
  const { t } = useTranslation();
  const nav = useNav();
  const { user } = useSession();
  const { toast } = useToast();
  const [g, setG] = useState<GState>({ enabled: false, group: null });
  const [sheet, setSheet] = useState<GSheet>(null);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    try { setG(await get<GState>("/api/group")); } catch { setG({ enabled: false, group: null }); }
  }, []);
  useEffect(() => { load(); }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // The guide's "Start my group" lands here (nav.params.group).
  useEffect(() => {
    if (g.enabled && nav.params.group) document.getElementById("pf-group")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [g.enabled, nav.params.group]);

  const attempt = async (f: () => Promise<void>) => { try { await f(); } catch (e) { toast(errMsg(e)); } };
  const close = () => setSheet(null);
  const copy = (text: string, done: string) => {
    try { navigator.clipboard.writeText(text).then(() => toast(done), () => toast(text)); } catch { toast(text); }
  };
  const myAvatar = useAvatar().src || "";
  const face = (m: Member) => {
    const src = m.me ? myAvatar : "";
    return src ? <span className="gm"><img src={src} alt="" /></span>
      : <span className={"gm" + (m.me ? "" : " other")}>{(m.handle || "?").charAt(0).toUpperCase()}</span>;
  };

  const invite = () => attempt(async () => {
    const r = await post("/api/group/invite", {});
    setSheet({ k: "invite", code: r.code, hours: r.hours });
  });
  const startOpen = () => { const me = (user || "").split("@")[0]; setName(me ? t("settings.homeOf", { name: cap(me) }) : t("settings.ourHome")); setSheet({ k: "start" }); };
  const renameOpen = () => { setName(g.group?.name || ""); setSheet({ k: "rename" }); };
  const leaveOpen = () => attempt(async () => { setSheet({ k: "leave", p: await get<Leave>("/api/group/leave-preview") }); });

  const grp = g.group;
  const n = grp ? grp.members.length : 0;
  const sh = sheet;
  return (
    <div id="pf-group" hidden={!g.enabled}>
      {g.enabled && (!grp ? <>
        <h3 className="sect">{t("settings.group")}</h3>
        <div className="group">
          <div className="row"><span className="grow"><span className="sub">{t("settings.shareListsAndReceiptsWith")}</span></span></div>
          <button className="navrow" type="button" data-g="start" onClick={startOpen}><span className="grow accenttext">{t("settings.startAGroup")}<span className="sub">{t("settings.nameItThenInvitePeople")}</span></span><span className="chev">›</span></button>
          <button className="navrow" type="button" data-g="join" onClick={() => nav.show("group-join")}><span className="grow">{t("settings.joinWithACode")}<span className="sub">{t("settings.someoneSentYouAnInvite")}</span></span><span className="chev">›</span></button>
        </div>
      </> : <>
        <h3 className="sect">{t("settings.group")}</h3>
        <div className="group">
          <button className="navrow" type="button" data-g="rename" onClick={renameOpen}><span className="grow"><span className="gname">{grp.name}</span><span className="sub">{t("settings.peopleShared", { count: n })}</span></span><span className="chev"><IconPen /></span></button>
          {grp.members.map(m => {
            const role = m.me ? <> <span className="grole">{m.owner ? t("settings.youOwner") : t("settings.you")}</span></> : <> <span className="grole">{m.owner ? t("settings.roleOwner") : t("settings.roleMember")}</span></>;
            const tap = grp.is_owner && !m.me;
            const body = <>{face(m)}<span className="grow"><span className="name">@{m.handle}{role}</span>{m.me ? null : <span className="sub">{joinedOn(m.joined)}</span>}</span>{tap && <span className="chev">›</span>}</>;
            return tap
              ? <button key={m.handle} type="button" className="row gmember" data-g="member" data-handle={m.handle} onClick={() => setSheet({ k: "member", handle: m.handle })}>{body}</button>
              : <div key={m.handle} className="row gmember">{body}</div>;
          })}
          {n < grp.max_members && <button className="navrow" type="button" data-g="invite" onClick={invite}><span className="grow accenttext">{t("settings.inviteSomeone")}<span className="sub">{t("settings.aCodeThatWorksFor")}</span></span><span className="chev">›</span></button>}
          <button className="navrow" type="button" data-g="leave" onClick={leaveOpen}><span className="grow dangertext">{t("settings.leaveGroup")}<span className="sub">{t("settings.youKeepACopyOf")}</span></span><span className="chev">›</span></button>
        </div>
      </>)}

      <Sheet open={sh?.k === "start"} onClose={close} title={t("settings.startAGroup")} closeLabel={t("common.cancel")} id="group-sheet">
        <label className="field">{t("settings.groupName")}<input type="text" id="g-name" maxLength={40} autoComplete="off" data-first value={name} onChange={e => setName(e.target.value)} /></label>
        <p className="muted small">{t("settings.yourListsBecomeTheGroup")}</p>
        <div className="sheetacts"><button className="btn primary" type="button" id="g-create" onClick={() => attempt(async () => {
          setG(await post("/api/group", { name })); close(); await invite();
        })}>{t("settings.startGroup")}</button></div>
      </Sheet>
      <Sheet open={sh?.k === "rename"} onClose={close} title={t("settings.renameGroup")} closeLabel={t("common.cancel")} id="group-sheet">
        <label className="field">{t("settings.groupName")}<input type="text" id="g-name" maxLength={40} autoComplete="off" data-first value={name} onChange={e => setName(e.target.value)} /></label>
        <div className="sheetacts"><button className="btn primary" type="button" id="g-rename" onClick={() => attempt(async () => {
          const r = await post("/api/group/rename", { name }); setG(x => ({ ...x, ...r })); close();
        })}>{t("common.save")}</button></div>
      </Sheet>
      {sh?.k === "invite" && grp && (() => {
        const link = `${location.origin}/?join=${sh.code}`;
        return (
          <Sheet open onClose={close} title={t("settings.inviteTo", { name: grp.name })} id="group-sheet">
            <p className="muted nomargin gcenter">{t("settings.sendThisCodeItWorks", { hours: sh.hours })}</p>
            <div className="gcode" aria-label={t("settings.inviteCodeAria", { code: sh.code.split("").join(" ") })}>{fmtCode(sh.code)}</div>
            <p className="muted small nomargin gcenter glink">{t("settings.orOpen", { link: link.replace(/^https?:\/\//, "") })}</p>
            <div className="sheetacts"><button className="btn" type="button" id="g-copy" onClick={() => copy(sh.code, t("settings.codeCopied"))}>{t("settings.copyCode")}</button>
              <button className="btn primary" type="button" id="g-share" data-first onClick={async () => {
                const text = t("settings.joinText", { name: grp.name, code: fmtCode(sh.code) });
                if (navigator.share) {
                  try { await navigator.share({ title: "Arya", text, url: link }); return; } catch (e) { if (e && (e as Error).name === "AbortError") return; }
                }
                copy(link, t("settings.linkCopied"));
              }}>{t("settings.shareLink")}</button></div>
            <p className="muted small">{t("settings.anyoneWithTheCodeCan", { max_members: grp.max_members })}</p>
            <button className="linkbtn" type="button" id="g-newcode" onClick={invite}>{t("settings.makeANewCode")}</button>
          </Sheet>
        );
      })()}
      {sh?.k === "member" && (
        <Sheet open onClose={close} title={t("settings.removeHandle", { handle: sh.handle })} closeLabel={t("common.cancel")} id="group-sheet">
          <p className="muted">{t("settings.theyKeepACopyOf")}</p>
          <div className="sheetacts"><button className="btn" type="button" onClick={close}>{t("settings.keep")}</button>
            <button className="btn danger" type="button" id="g-remove" onClick={() => attempt(async () => {
              await post("/api/group/remove", { handle: sh.handle });
              toast(t("settings.handleOut", { handle: sh.handle })); close(); await load();
            })}>{t("common.remove")}</button></div>
        </Sheet>
      )}
      {sh?.k === "leave" && (() => {
        const p = sh.p, nl = p.lists.length;
        return (
          <Sheet open onClose={close} title={t("settings.leaveName", { name: p.name })} closeLabel={t("common.cancel")} id="group-sheet">
            <div className="gbuls">
              <Bul icon="📋" title={nl ? (nl === 1 ? t("settings.keepCopyOne") : t("settings.keepCopyAll", { n: nl })) : t("settings.keepCopyEverything")}
                sub={(nl ? p.lists.join(", ") + ". " : "") + t("settings.groupKeepsOwn")} />
              <Bul icon="🧾" title={t("settings.yourReceiptsGo", { count: p.my_receipts })}
                sub={p.last_one ? "" : t("settings.othersStay", { n: p.other_receipts })} />
              <Bul icon="🔄" title={t("settings.runningLowPatternsAndSpend")} sub={p.last_one ? "" : t("settings.sameForGroup")} />
              {p.last_one ? <Bul icon="👋" title={t("settings.youAreTheLastOne")} sub={t("settings.theGroupClosesYourLists")} />
                : p.next_owner ? <Bul icon="👑" title={t("settings.becomesOwner", { handle: p.next_owner })} /> : null}
            </div>
            <div className="sheetacts"><button className="btn" type="button" onClick={close}>{t("settings.stay")}</button>
              <button className="btn danger" type="button" id="g-leave" onClick={() => attempt(async () => {
                await post("/api/group/leave", {});
                close(); toast(t("settings.youLeft", { name: p.name })); await load();
              })}>{t("settings.leaveGroup")}</button></div>
          </Sheet>
        );
      })()}
    </div>
  );
}
