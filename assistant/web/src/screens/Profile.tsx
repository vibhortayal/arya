import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useAvatar } from "../app/avatar";
import { useInstallPrompt } from "../app/a2hs";
import { useToast } from "../ui/Toast";
import { Sheet } from "../ui/Sheet";
import { Row } from "../ui/kit";
import { IconPen } from "../ui/icons";
import { AddReceiptSheet, type ReceiptTarget } from "../ui/AddReceiptSheet";
import { get, post } from "../lib/api";
import { CURRENCY_SYMBOLS, MONTHS, asset, fmtShort } from "../lib/format";

/* Port of pwa/index.html #view-profile and app.js renderProfile, the
 * avatar editor (app.js loadAvatar...), Reminders (push.js), the
 * Add to Home Screen row (a2hs.js) and the Group section (group.js).
 * Profile is also the Settings tab: with no nav.params.from the Back
 * link is hidden. Quest stats, badges and mapped stores live on the
 * quest-progress view, not here.
 * Local helpers (not in ui/): GroupSection, Reminders, A2hsRow. */

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const cap = (h: string) => (h ? h.charAt(0).toUpperCase() + h.slice(1) : "");

type QProfile = { handle: string; level?: number; points?: number; stats: { hunts: number; streak_weeks?: number }; badges?: { id: string; earned?: boolean }[]; mapped_stores?: string[] };
type Unsettled = { session_id: string; store: string; finished_at?: string; items_collected: number; items_total: number };
type Archive = { receipts: unknown[]; unsettled?: Unsettled[] };

export function Profile() {
  const nav = useNav();
  const { demo, user, currency, setCurrency, leave } = useSession();
  const { toast, showErr } = useToast();
  const from = nav.params.from as string | undefined;
  const [profile, setProfile] = useState<QProfile | null>(null);
  const [archive, setArchive] = useState<Archive>({ receipts: [] });
  const [ar, setAr] = useState<ReceiptTarget | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState("");

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      get<QProfile>("/api/quest/profile").catch(() => null),
      get<Archive>("/api/quest/receipts").catch(() => ({ receipts: [] })),
    ]);
    setProfile(p);
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

  const s = profile?.stats;
  const earned = (profile?.badges || []).filter(b => b.earned).length;
  const mapped = profile?.mapped_stores || [];
  const level = profile && s
    ? `Level ${profile.level || 1} · ${profile.points || 0} pts` + (s.streak_weeks ? ` · ${s.streak_weeks} wk streak` : "") : "";
  const questSub = profile && s
    ? `${s.hunts} hunt${s.hunts === 1 ? "" : "s"} · ${earned} of ${(profile.badges || []).length} badges`
      + (mapped.length ? ` · ${mapped.length} store${mapped.length === 1 ? "" : "s"} mapped` : "")
    : "Hunts, badges and mapped stores";

  const dismiss = (sid: string) => attempt(async () => {
    if (!confirm("Dismiss this hunt? It leaves your Receipts list. This cannot be undone.")) return;
    await post(`/api/quest/sessions/${encodeURIComponent(sid)}/delete`, {});
    toast("Hunt dismissed.");
    load().catch(showErr);
  });

  const pickCurrency = (code: string) => attempt(async () => {
    const prev = currency;
    try {
      const r = await post("/api/settings", { currency: code });
      setCurrency({ code: r.currency, symbol: r.symbol });
      toast(`Prices now show in ${r.currency}.`);
    } catch (e) { setCurrency(prev); throw e; }
  });

  const eraseAccount = () => attempt(async () => {
    if (!delPw) { toast("Enter your password to confirm."); return; }
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
      {from && <p><a href="#" id="pf-back" onClick={ev => { ev.preventDefault(); nav.back(from as any); }}>‹ Back</a></p>}
      <h2 className="largetitle">Profile</h2>
      <AvatarCard handle={profile ? "@" + profile.handle : ""} level={level} />
      <GroupSection />
      <div id="pf-missing" className="group" hidden={!unsettled.length}>
        {unsettled.map(e => (
          <div key={e.session_id} className="sessrow">
            <span className="grow"><span className="name">{e.store}</span>
              <span className="sub">{fmtShort(String(e.finished_at || "").slice(0, 10))} · Finished · Receipt missing · {e.items_collected} of {e.items_total} collected</span></span>
            <button className="btn" data-upload={e.session_id} data-store={e.store} type="button"
              onClick={() => setAr({ sessionId: e.session_id, label: e.store })}>Add receipt</button>
            <button className="btn" data-dismiss={e.session_id} type="button" onClick={() => dismiss(e.session_id)}>Dismiss</button>
          </div>
        ))}
      </div>
      <div className="group">
        <NavRow view="stores-mine" title="Stores" sub="Your stores, favorites, and the store directory" />
        <NavRow id="btn-powers" view="powers" title="Arya's powers" sub="What Arya can do, and how to unlock more" />
        <NavRow id="btn-analysis" view="analysis" title="Analysis" sub="Spending by month and store" />
        <NavRow id="btn-receipts" view="receipts" title="Receipts" subId="pf-receipts-sub"
          sub={archive.receipts.length ? `${archive.receipts.length} receipts · the private archive` : "The private archive"} />
        <NavRow id="btn-quest-progress" view="quest-progress" title="Quest progress" subId="pf-quest-sub" sub={questSub} />
        <A2hsRow demo={demo} />
      </div>
      <Reminders />
      <h3 className="sect">Settings</h3>
      <div className="group" id="profile-account">
        <Row name="Signed in as" right={demo ? "demo" : user || ""} />
        <div className="row"><div className="grow"><span className="name">Currency</span><span className="sub">How prices show. Arya does not convert.</span></div>
          <select id="pf-currency" className="curpick" aria-label="Currency" value={currency.code} onChange={ev => pickCurrency(ev.target.value)}>
            {["USD", "EUR", "GBP", "INR", "CAD", "AUD"].map(c => <option key={c} value={c}>{CURRENCY_SYMBOLS[c]} {c}</option>)}
          </select></div>
      </div>
      <div className="group">
        <NavRow id="btn-feedback" view="feedback" title="Feature request / Contact us" sub="Tell us what to build, what broke, or ask a question" />
        <NavRow id="btn-muse" view="muse" title="Connect Muse" sub="Link a code to file receipts by chat" />
        <NavRow id="btn-about" view="about" title="About" sub="Built on Meta models" />
      </div>
      <div className="group">
        <a className="navrow" href="/api/account/export"><span className="grow">Export my data<span className="sub">Everything Arya holds for you, as one file</span></span><span className="chev">›</span></a>
        <button className="navrow" id="btn-del-account" type="button" onClick={() => setDelOpen(o => !o)}>
          <span className="grow">Delete my account<span className="sub">Erase your account and all of its data</span></span><span className="chev">›</span></button>
        <div id="del-account-box" className="pad" hidden={!delOpen}>
          <p className="muted">This erases your receipts, lists, hunts, photos, and sign-in — for good. Enter your password to confirm.</p>
          <input type="password" id="del-account-pw" autoComplete="current-password" placeholder="Your password" value={delPw}
            onChange={e => setDelPw(e.target.value)} />
          <p style={{ marginTop: 10 }}><button className="btn danger" id="btn-del-account-go" type="button" onClick={eraseAccount}>Erase everything</button></p>
        </div>
      </div>
      <p style={{ marginTop: 22 }}><button id="btn-signout2" className="btn secondary wide" type="button"
        onClick={signOut}>Sign out</button></p>

      <AddReceiptSheet target={ar} onClose={() => setAr(null)} onDone={() => load().catch(showErr)} />
    </>
  );
}

/* ---------------- Avatar (app.js loadAvatar and the av-* handlers) ---------------- */
function AvatarCard({ handle, level }: { handle: string; level: string }) {
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
      try {
        const c = await (await fetch(asset("assets/characters/manifest.json"))).json();
        setPresets([...new Set([...(c.items || []).map((i: any) => i.char), ...(c.categories || []).map((x: any) => x.char),
          ...Object.values(c.roles || {}), c.fallback].filter(Boolean))] as string[]);
      } catch { /* no presets */ }
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
    if (!p) { toast("Describe your avatar first."); return; }
    setMaking(true); setStatus("Drawing it…");
    try { await post("/api/quest/avatar/generate", { prompt: p }); setStatus(""); showCand(); }
    catch (e) { setStatus(errMsg(e)); }
    setMaking(false);
  };
  const photo = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setStatus("Drawing you as a cartoon…");
    try {
      const r = await fetch("/api/quest/avatar/photo", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || "Could not make it");
      setStatus(""); showCand();
    } catch (e) { setStatus(errMsg(e)); }
  };
  const use = async () => {
    try { const r = await post("/api/quest/avatar/use", {}); setAv(r); setCand(null); toast("Avatar saved."); }
    catch (e) { toast(errMsg(e)); }
  };

  return (
    <div id="pf-avatar" className="group pad">
      <div className="avwrap"><div className="avatar big" id="pf-avatar-pic"><span id="pf-avatar-initial">{(demo ? "demo" : String(user || "A")).charAt(0).toUpperCase()}</span>
        <img id="pf-avatar-img" alt="" hidden={!loaded} src={loaded ? src : undefined} /></div>
        <button className="avedit" id="av-edit-btn" type="button" aria-label="Edit avatar" aria-expanded={open} onClick={() => setOpen(o => !o)}>&#9998;</button></div>
      <p className="nomargin" style={{ textAlign: "center" }}><strong id="pf-handle" style={{ fontSize: 19 }}>{handle}</strong></p>
      <p className="muted nomargin" id="pf-level" style={{ textAlign: "center" }}>{level}</p>
      <div id="av-panel" hidden={!open}>
        <p className="muted nomargin small" style={{ textAlign: "center" }}>Also hosts the haul cards you share. Public: boards and badges only.</p>
        <div id="av-presets" className="presetrow">
          {presets.map(f => (
            <button key={f} type="button" data-file={f} aria-label={f.replace(".webp", "")} aria-pressed={!av.image && f === current}
              onClick={() => choose(f)}><img src={asset(`assets/characters/${f}`)} alt="" /></button>
          ))}
        </div>
        <div id="av-make-box" hidden={demo}>
          <div className="avrow"><input type="text" id="av-prompt" maxLength={200} placeholder="Describe it: a fox with a cart" aria-label="Describe your avatar"
            autoComplete="off" value={prompt} onChange={e => setPrompt(e.target.value)} />
            <button id="av-make" className="btn compact primary" type="button" disabled={making} onClick={make}>Make</button></div>
          <p className="nomargin avalt"><label className="linkbtn" htmlFor="av-photo">or use my photo</label>
            <input type="file" id="av-photo" accept="image/*" hidden onChange={photo} /><span className="muted"> Drawn as a cartoon, then dropped.</span></p>
          <div id="av-candidate" className="avcand" hidden={!cand}>
            <img id="av-cand-img" className="candimg" alt="Your new avatar" src={cand || undefined} />
            <button id="av-use" className="btn compact primary" type="button" onClick={use}>Use this</button>
          </div>
        </div>
      </div>
      <p id="av-status" className="muted nomargin" style={{ textAlign: "center" }}>{status}</p>
      <p className="nomargin" style={{ textAlign: "center", marginTop: 10 }}><button className="btn compact" id="av-edit-label" type="button" onClick={() => setOpen(o => !o)}>{open ? "Done" : "Edit avatar"}</button></p>
    </div>
  );
}

/* ---------------- Add to Home Screen row (a2hs.js) ---------------- */
function A2hsRow({ demo }: { demo: boolean }) {
  const { prompt: deferred, take } = useInstallPrompt();
  const [steps, setSteps] = useState(false);
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const available = !installed && !demo && (!!deferred || ios);
  const go = async () => {
    if (deferred) {
      const ev = take();
      try { await ev.prompt(); await ev.userChoice; } catch { /* closed */ }
      return;
    }
    setSteps(true);
  };
  return (
    <>
      <button className="navrow" id="btn-a2hs" type="button" hidden={!available} onClick={go}>
        <span className="grow">Add to Home Screen<span className="sub">Opens full screen and lets reminders work</span></span><span className="chev">›</span></button>
      <Sheet open={steps} onClose={() => setSteps(false)} id="a2hs-sheet" title="Add Arya to your Home Screen">
        <ol className="steps">
          <li><span>Tap <b>Share</b> at the bottom of Safari.</span></li>
          <li><span>Scroll and tap <b>Add to Home Screen</b>.</span></li>
          <li><span>Leave <b>Open as Web App</b> <i className="tog" aria-hidden="true"></i> switched <b>on</b>.<span className="keepon">If it is off, Arya opens as a plain Safari tab with the address bar, and reminders cannot work.</span></span></li>
          <li><span>Tap <b>Add</b>, then open Arya from your Home Screen.</span></li>
        </ol>
      </Sheet>
    </>
  );
}

/* ---------------- Reminders (push.js) ---------------- */
type PushCfg = { enabled: boolean; notice_days: number; subscribed: boolean; public_key?: string };
const DEFAULT_NOTE = "One push a day at most, and only when something is due. Turn it off any time.";
const keyBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

function Reminders() {
  const [cfg, setCfg] = useState<PushCfg>({ enabled: false, notice_days: 2, subscribed: false });
  const [note, setNote] = useState(DEFAULT_NOTE);
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
        setNote(ios ? "On iPhone, add Arya to your Home Screen first (iOS 16.4 or newer), then open it from there."
          : "This browser cannot show push reminders.");
        setNoSwitch(!supported);
      }
    })();
  }, []);

  const pushPost = (path: string, body?: unknown) => post<PushCfg>(path, body || {});
  const turnOn = async () => {
    if (Notification.permission === "denied") { setNote("Blocked in phone settings. Allow notifications for Arya there, then try again."); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { setNote("Reminders need notification permission. You can allow it in phone settings."); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: keyBytes(cfg.public_key || ""),
    });
    setCfg(await pushPost("/api/push/subscribe", { subscription: sub.toJSON() }));
    setNote(DEFAULT_NOTE);
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
    catch (e) { setNote(errMsg(e) || "Could not change reminders."); }
    setBusy(false);
  };
  const days = async (delta: number) => {
    const n = Math.min(7, Math.max(1, cfg.notice_days + delta));
    if (n === cfg.notice_days) return;
    try { setCfg(await pushPost("/api/push/settings", { notice_days: n })); } catch (e) { setNote(errMsg(e)); }
  };
  const test = async () => {
    setTestBusy(true);
    try { await pushPost("/api/push/test"); setNote("Test reminder sent. Check your notifications."); }
    catch (e) { setNote(errMsg(e) || "Could not send the test."); }
    setTestBusy(false);
  };

  const on = cfg.subscribed;
  return (
    <div id="pf-reminders" hidden={!cfg.enabled}>
      <h3 className="sect">Reminders</h3>
      <div className="group">
        <div className="row"><span className="grow"><span className="name" style={{ fontWeight: 550 }}>Remind me</span>
          <span className="sub" id="rem-sub">{on ? "On. You will get a push when something is due" : "A push when something is about to run out"}</span></span>
          <button className="sw" id="rem-switch" type="button" role="switch" aria-checked={on} aria-label="Remind me" disabled={busy || noSwitch} onClick={toggle}><i></i></button></div>
        <div id="rem-more" hidden={!on}>
          <div className="row"><span className="grow"><span className="name" style={{ fontWeight: 550 }}>Heads-up</span>
            <span className="sub" id="rem-days-sub">{cfg.notice_days} {cfg.notice_days === 1 ? "day" : "days"} before it runs out</span></span>
            <span className="stepper"><button type="button" id="rem-dm" aria-label="Fewer days" onClick={() => days(-1)}>&minus;</button>
              <span className="qty" id="rem-dq">{cfg.notice_days}</span>
              <button type="button" id="rem-dp" aria-label="More days" onClick={() => days(1)}>+</button></span></div>
          <button className="navrow" id="rem-test" type="button" disabled={testBusy} onClick={test}><span className="grow accenttext">Send me a test reminder<span className="sub">Arrives in a few seconds</span></span><span className="chev">›</span></button>
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
const joinedOn = (sec: number) => { const d = new Date(sec * 1000); return `Joined ${MONTHS[d.getMonth()]} ${d.getDate()}`; };

function Bul({ icon, title, sub }: { icon: string; title: ReactNode; sub?: ReactNode }) {
  return <div className="gbul"><span className="gico" aria-hidden="true">{icon}</span><span className="grow"><b>{title}</b>{sub ? <span className="sub">{sub}</span> : null}</span></div>;
}

function GroupSection() {
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
  const startOpen = () => { const me = (user || "").split("@")[0]; setName(me ? cap(me) + "'s home" : "Our home"); setSheet({ k: "start" }); };
  const renameOpen = () => { setName(g.group?.name || ""); setSheet({ k: "rename" }); };
  const leaveOpen = () => attempt(async () => { setSheet({ k: "leave", p: await get<Leave>("/api/group/leave-preview") }); });

  const grp = g.group;
  const n = grp ? grp.members.length : 0;
  const sh = sheet;
  return (
    <div id="pf-group" hidden={!g.enabled}>
      {g.enabled && (!grp ? <>
        <h3 className="sect">Group</h3>
        <div className="group">
          <div className="row"><span className="grow"><span className="sub">Share lists and receipts with the people you shop for. Everyone sees the same lists; your profile and badges stay yours.</span></span></div>
          <button className="navrow" type="button" data-g="start" onClick={startOpen}><span className="grow accenttext">Start a group<span className="sub">Name it, then invite people with a code</span></span><span className="chev">›</span></button>
          <button className="navrow" type="button" data-g="join" onClick={() => nav.show("group-join")}><span className="grow">Join with a code<span className="sub">Someone sent you an invite</span></span><span className="chev">›</span></button>
        </div>
      </> : <>
        <h3 className="sect">Group</h3>
        <div className="group">
          <button className="navrow" type="button" data-g="rename" onClick={renameOpen}><span className="grow"><span className="gname">{grp.name}</span><span className="sub">{n} {n === 1 ? "person" : "people"} · lists and receipts shared</span></span><span className="chev"><IconPen /></span></button>
          {grp.members.map(m => {
            const role = m.me ? <> <span className="grole">· you{m.owner ? " · owner" : ""}</span></> : <> <span className="grole">· {m.owner ? "owner" : "member"}</span></>;
            const tap = grp.is_owner && !m.me;
            const body = <>{face(m)}<span className="grow"><span className="name">@{m.handle}{role}</span>{m.me ? null : <span className="sub">{joinedOn(m.joined)}</span>}</span>{tap && <span className="chev">›</span>}</>;
            return tap
              ? <button key={m.handle} type="button" className="row gmember" data-g="member" data-handle={m.handle} onClick={() => setSheet({ k: "member", handle: m.handle })}>{body}</button>
              : <div key={m.handle} className="row gmember">{body}</div>;
          })}
          {n < grp.max_members && <button className="navrow" type="button" data-g="invite" onClick={invite}><span className="grow accenttext">Invite someone<span className="sub">A code that works for 48 hours</span></span><span className="chev">›</span></button>}
          <button className="navrow" type="button" data-g="leave" onClick={leaveOpen}><span className="grow dangertext">Leave group<span className="sub">You keep a copy of the lists and your own receipts</span></span><span className="chev">›</span></button>
        </div>
      </>)}

      <Sheet open={sh?.k === "start"} onClose={close} title="Start a group" closeLabel="Cancel" id="group-sheet">
        <label className="field">Group name<input type="text" id="g-name" maxLength={40} autoComplete="off" data-first value={name} onChange={e => setName(e.target.value)} /></label>
        <p className="muted small">Your lists become the group's lists. Next you can invite people with a code.</p>
        <div className="sheetacts"><button className="btn primary" type="button" id="g-create" onClick={() => attempt(async () => {
          setG(await post("/api/group", { name })); close(); await invite();
        })}>Start group</button></div>
      </Sheet>
      <Sheet open={sh?.k === "rename"} onClose={close} title="Rename group" closeLabel="Cancel" id="group-sheet">
        <label className="field">Group name<input type="text" id="g-name" maxLength={40} autoComplete="off" data-first value={name} onChange={e => setName(e.target.value)} /></label>
        <div className="sheetacts"><button className="btn primary" type="button" id="g-rename" onClick={() => attempt(async () => {
          const r = await post("/api/group/rename", { name }); setG(x => ({ ...x, ...r })); close();
        })}>Save</button></div>
      </Sheet>
      {sh?.k === "invite" && grp && (() => {
        const link = `${location.origin}/?join=${sh.code}`;
        return (
          <Sheet open onClose={close} title={"Invite to " + grp.name} id="group-sheet">
            <p className="muted nomargin gcenter">Send this code. It works for {sh.hours} hours.</p>
            <div className="gcode" aria-label={"Invite code " + sh.code.split("").join(" ")}>{fmtCode(sh.code)}</div>
            <p className="muted small nomargin gcenter glink">or open {link.replace(/^https?:\/\//, "")}</p>
            <div className="sheetacts"><button className="btn" type="button" id="g-copy" onClick={() => copy(sh.code, "Code copied.")}>Copy code</button>
              <button className="btn primary" type="button" id="g-share" data-first onClick={async () => {
                const text = `Join ${grp.name} on Arya: code ${fmtCode(sh.code)}`;
                if (navigator.share) {
                  try { await navigator.share({ title: "Arya", text, url: link }); return; } catch (e) { if (e && (e as Error).name === "AbortError") return; }
                }
                copy(link, "Link copied.");
              }}>Share link</button></div>
            <p className="muted small">Anyone with the code can join and see the group's lists and receipts. Make a new code any time and the old one stops working. Up to {grp.max_members} people.</p>
            <button className="linkbtn" type="button" id="g-newcode" onClick={invite}>Make a new code</button>
          </Sheet>
        );
      })()}
      {sh?.k === "member" && (
        <Sheet open onClose={close} title={`Remove @${sh.handle}?`} closeLabel="Cancel" id="group-sheet">
          <p className="muted">They keep a copy of the lists and take their own receipts with them. The group's lists stay as they are.</p>
          <div className="sheetacts"><button className="btn" type="button" onClick={close}>Keep</button>
            <button className="btn danger" type="button" id="g-remove" onClick={() => attempt(async () => {
              await post("/api/group/remove", { handle: sh.handle });
              toast(`@${sh.handle} is out of the group.`); close(); await load();
            })}>Remove</button></div>
        </Sheet>
      )}
      {sh?.k === "leave" && (() => {
        const p = sh.p, nl = p.lists.length;
        return (
          <Sheet open onClose={close} title={`Leave ${p.name}?`} closeLabel="Cancel" id="group-sheet">
            <div className="gbuls">
              <Bul icon="📋" title={nl ? `You keep a copy of ${nl === 1 ? "the list" : `all ${nl} lists`}` : "You keep a copy of everything on the list"}
                sub={`${nl ? p.lists.join(", ") + ". " : ""}The group keeps its own.`} />
              <Bul icon="🧾" title={`Your ${p.my_receipts} receipt${p.my_receipts === 1 ? "" : "s"} go${p.my_receipts === 1 ? "es" : ""} with you`}
                sub={p.last_one ? "" : `The ${p.other_receipts} the others added stay with the group.`} />
              <Bul icon="🔄" title="Running low, patterns and spend start over from your receipts" sub={p.last_one ? "" : "Same for the group, from what is left."} />
              {p.last_one ? <Bul icon="👋" title="You are the last one" sub="The group closes. Your lists and receipts stay yours." />
                : p.next_owner ? <Bul icon="👑" title={`@${p.next_owner} becomes the owner`} /> : null}
            </div>
            <div className="sheetacts"><button className="btn" type="button" onClick={close}>Stay</button>
              <button className="btn danger" type="button" id="g-leave" onClick={() => attempt(async () => {
                await post("/api/group/leave", {});
                close(); toast(`You left ${p.name}. Your lists are a copy now.`); await load();
              })}>Leave group</button></div>
          </Sheet>
        );
      })()}
    </div>
  );
}
