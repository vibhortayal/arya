import { markDemoStart } from "../ui/FirstRun";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSession } from "../app/session";
import { Sheet } from "../ui/Sheet";
import { asset } from "../lib/format";
import { Trans, useTranslation } from "../i18n";
import { A2hsSteps, CopyLink, installed, isIOS, useA2hs } from "../ui/A2hs";
import { motionOff } from "../lib/motion";

/* The logged-out landing (B1 cards, owner 2026-10-29; one screen with the
 * buttons first, owner 2026-10-30) and
 * sign-in. Three modes: bootstrap (no accounts yet,
 * setup), sign in, and public registration, which shows only when the
 * server reports it open. Optional email-code and Google sign-in. */
type Mode = "setup" | "login" | "register";

/* Store badges (owner, 2026-10-30, mockup option D): Apple's and Google's
 * own artwork, unmodified, with "coming soon" as a caption beside them.
 * They are NOT links until each listing exists; then link that badge. */

/* Landing cards (owner option A, 2026-10-30): eight raised buttons.
 * Each mascot hops until its card is first tapped; the first card also
 * beats until any card has been tapped, so a visitor learns that they
 * open. A tap zooms the card up over the page to show its text. The
 * cards a visitor has tapped stay still for good (localStorage). */
export const CARDS = [
  { id: "lists", face: "milk" },
  { id: "share", face: "basket" },
  { id: "maps", face: "binoculars" },
  { id: "news", face: "egg" },
  { id: "receipts", face: "pantry" },
  { id: "prices", face: "olive-oil" },
  { id: "usesoon", face: "dairy" },
  { id: "ask", face: "compass" },
] as const;
export const SEEN_KEY = "arya.landing.seen";

export function loadSeen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

function saveSeen(seen: string[]) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* storage unavailable */ }
}

/* "Get the app" (owner, 2026-10-29): a pill in the header while Arya
 * can go on this phone's Home Screen (ui/A2hs.tsx: not installed, and
 * an install prompt or iPhone steps to offer; phones only, so not on
 * a desktop). The landing is logged out, so the demo rule does not
 * apply. About 1.2 s after load, and once more 8 s later, it jiggles (a
 * soft glow with reduced motion), then rests; a tap (localStorage) stops
 * it for good. */
export const GETAPP_KEY = "arya.landing.getapp";

export function getAppTapped(): boolean {
  try { return localStorage.getItem(GETAPP_KEY) === "1"; } catch { return false; }
}

const reducedMotion = motionOff;
const isPhone = () => isIOS() || /android/i.test(navigator.userAgent);

function GetApp() {
  const { t } = useTranslation();
  const a = useA2hs(false);
  const [tapped, setTapped] = useState(getAppTapped);
  const nudge = tapped ? "" : reducedMotion() ? " glow" : " jiggle";
  const go = () => {
    if (!tapped) { setTapped(true); try { localStorage.setItem(GETAPP_KEY, "1"); } catch { /* storage unavailable */ } }
    a.go();
  };
  return (
    <>
      {isPhone() && a.available && (
        <button id="getapp-open" className={"gethome" + nudge} type="button" onClick={go}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M12 7v7M9 11l3 3 3-3" /></svg>
          <span>{t("landing.getTheApp")}</span>
        </button>
      )}
      <A2hsSteps open={a.steps} onClose={a.closeSteps} />
    </>
  );
}

const postJson = (path: string, body?: unknown) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const detail = async (r: Response) => ((await r.json().catch(() => ({}))) as { detail?: string }).detail;

export function Login() {
  const { t } = useTranslation();
  const { status, enter } = useSession();
  const [mode, setMode] = useState<Mode>(status.has_users ? "login" : "setup");
  // The password form is for beta testers and test agents (owner, 2026-10-30):
  // it has its own page, /team, and the public sheet is email, Google and the
  // waitlist. It stays on the public sheet while the account is being set up,
  // while registration is open, and where email sign-in is not set up at all.
  const team = /^\/team\/?$/.test(location.pathname) || location.search.includes("team=1");
  const notInvited = location.search.includes("signin=notinvited");
  const showPassword = team || mode === "setup" || !!status.registration_open || !status.email_signin;
  const [signin, setSignin] = useState(!status.has_users || team || location.search.includes("signin=failed") || notInvited);
  const [step, setStep] = useState<"email" | "code">("email");
  const [guest, setGuest] = useState(() => {
    if (!notInvited) return "";
    try { return sessionStorage.getItem("arya.notinvited") || ""; } catch { return ""; }
  });
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const create = mode !== "login";

  // No tab bar here, so no room kept for one at the bottom.
  useEffect(() => {
    document.body.classList.add("landing");
    return () => document.body.classList.remove("landing");
  }, []);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const path = mode === "login" ? "/auth/login" : mode === "register" ? "/auth/register" : "/auth/setup";
    const r = await postJson(path, { username: user.trim(), password: pass });
    if (!r.ok) { setErr((await detail(r)) || (mode === "login" ? t("login.signInFailed") : t("login.couldNotCreate"))); return; }
    enter((await r.json()).user, false);
  };

  const demo = async () => {
    const r = await fetch("/auth/demo", { method: "POST" });
    if (r.ok) { markDemoStart(); enter("demo", true); return; }
    setErr((await detail(r)) || t("login.demoFailed"));
    setSignin(true);
  };

  const [seen, setSeen] = useState<string[]>(loadSeen);
  const [wl, setWl] = useState<{ open: boolean; email: string; done: "" | "added" | "already" }>({ open: false, email: "", done: "" });
  const openWaitlist = (email = "", done: "" | "added" | "already" = "") => { setSignin(false); setPass(""); setStep("email"); setWl({ open: true, email, done }); };
  const [zoom, setZoom] = useState<{ id: string; from: string } | null>(null);
  const tap = (id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const w = Math.min(320, window.innerWidth - 40);
    const from = `translate(${r.left + r.width / 2 - cx}px, ${r.top + r.height / 2 - cy}px) scale(${(r.width / w).toFixed(3)})`;
    setZoom({ id, from });
    if (!seen.includes(id)) { const next = [...seen, id]; setSeen(next); saveSeen(next); }
  };

  const openSignin = (m: "login" | "register") => {
    if (mode !== "setup") setMode(m);
    setErr("");
    setSignin(true);
  };

  return (
    <section id="view-login" className="view">
      <main className="landpage">
        <header className="landtop">
          <span className="landlogo">Arya</span>
          <GetApp />
        </header>
        <div className="hero landhero">
          <h1 className="largetitle herotitle"><Trans i18nKey="landing.headline" components={{ em: <em /> }} /></h1>
          <p className="herosub nomargin landsub">{t("landing.subhead")}</p>
          {!isPhone() && !installed() && (
            <p className="muted landdesk">{t("a2hs.desktop")} <CopyLink id="landdesk-copy" /></p>
          )}
          <div className="landcta">
            <button id="demo-btn" className="btn primary" type="button" onClick={demo}>{t("landing.tryIt")}</button>
            <button id="signin-open" className="btn landsign" type="button" onClick={() => openSignin("login")}>{t("landing.signIn")}</button>
          </div>
          <div className="landcards">
            {CARDS.map((c, i) => (
              <button key={c.id} id={"land-" + c.id} type="button" aria-haspopup="dialog"
                className={"ftile" + (seen.includes(c.id) ? " seen" : "") + (i === 0 && seen.length === 0 ? " beat" : "")}
                onClick={e => tap(c.id, e.currentTarget)}>
                <img src={asset(`assets/characters/${c.face}.webp`)} alt="" />
                <span className="ftext"><b>{t(`landing.cards.${c.id}.title`)}</b><span className="s">{t(`landing.cards.${c.id}.sub`)}</span></span>
                <span className="fchev" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </div>
        <div className="landfoot">
          <p className="landnote">{status.registration_open ? t("landing.demoNote") : `${t("landing.demoNote")} ${t("landing.invitationNote")}`}
            {status.registration_open ? (
              <button id="register-open" className="linkbtn" type="button" onClick={() => openSignin("register")}>{t("landing.startOwnList")}</button>
            ) : (
              <button id="waitlist-open" className="linkbtn wl" type="button" onClick={() => openWaitlist()}>{t("landing.joinWaitlist")}</button>
            )}
          </p>
          <div className="landapps">
            <p className="landappscap">{t("landing.appsSoon")}</p>
            <div className="landbadges">
              <img src={asset("assets/badges/app-store.svg")} width="120" height="40" alt={t("landing.appStoreAlt")} />
              <img src={asset("assets/badges/google-play.png")} width="139" height="40" alt={t("landing.googlePlayAlt")} />
            </div>
          </div>
          <p className="landnote"><a href="/privacy/">{t("landing.privacy")}</a> · <a href="/terms/">{t("landing.terms")}</a> · <a href="/terms/#ai">{t("ai.footer")}</a> · <a href="/developers">{t("landing.developers")}</a></p>
        </div>
      </main>

      <Waitlist open={wl.open} email0={wl.email} done0={wl.done} onClose={() => setWl(w => ({ ...w, open: false }))} />

      {zoom && <CardZoom id={zoom.id} from={zoom.from} onClose={() => setZoom(null)} />}

      <Sheet open={signin} onClose={() => { setSignin(false); setPass(""); setStep("email"); }} id="signin-sheet" className="signin"
        title={team ? t("login.teamTitle") : notInvited && guest && step === "email" ? t("login.notInvitedTitle") : step === "code" ? t("login.checkEmail") : create ? t("login.createTitle") : t("login.signIn")}>
        {team && (
          <p className="muted hint">{t("login.teamHint")} <button type="button" id="team-email" className="linkbtn" onClick={() => location.assign("/")}>{t("login.teamEmailLink")}</button></p>
        )}
        {!team && status.email_signin && (notInvited && guest ? (
          <NotInvited email={guest} onJoin={e => joinFromGoogle(e, openWaitlist)} onOther={() => setGuest("")} />
        ) : (
          <EmailSignin step={step} setStep={setStep} onDone={u => enter(u, false)}
            onJoin={status.registration_open ? undefined : e => openWaitlist(e)} />
        ))}
        {!team && status.email_signin && showPassword && <p className="muted">{t("login.orUseAPassword")}</p>}
        {showPassword && (
          <form id="login-form" method="post" onSubmit={submit}>
            <label className="field">{create ? t("login.username") : t("login.emailOrUsername")}
              <input type="text" id="login-user" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                inputMode="email" required data-first value={user} onChange={e => setUser(e.target.value)} />
            </label>
            <label className="field">{t("login.password")}<input type="password" id="login-pass" name="password" autoComplete={create ? "new-password" : "current-password"} required
                value={pass} onChange={e => setPass(e.target.value)} />
            </label>
            <p><button type="submit" id="login-btn" className="btn primary wide">{create ? t("login.createAccount") : t("login.signIn")}</button></p>
            <p id="login-error" className="muted loginerr" role="alert">{err}</p>
          </form>
        )}
        {showPassword && !team && mode !== "setup" && status.registration_open && (
          <p className="nomargin"><button type="button" id="login-toggle" className="linkbtn"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}>
            {create ? t("login.haveAccount") : t("login.newHere")}</button></p>
        )}
        {showPassword && !team && mode !== "setup" && !status.registration_open && !status.email_signin && (
          <p className="nomargin"><button type="button" id="signin-waitlist" className="linkbtn"
            onClick={() => openWaitlist()}>{t("landing.noAccountWaitlist")}</button></p>
        )}
      </Sheet>
    </section>
  );
}

/* The waitlist (owner, 2026-10-30): email only. The server answers
 * added or already; a hidden field catches bots (api/waitlist.py). */
function Waitlist({ open, onClose, email0, done0 }: { open: boolean; onClose: () => void; email0: string; done0: "" | "added" | "already" }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(email0);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<"" | "added" | "already">(done0);
  // Opened from the sign-in sheet with the address already typed there.
  useEffect(() => { if (open) { setEmail(email0); setDone(done0); setErr(""); } }, [open]);
  const [busy, setBusy] = useState(false);
  const [trap, setTrap] = useState("");
  const close = () => { onClose(); setErr(""); setDone(""); };
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await postJson("/auth/waitlist", { email: email.trim(), website: trap });
      if (r.ok) { setDone(((await r.json()) as { status: "added" | "already" }).status); return; }
      setErr(r.status === 400 ? t("waitlist.badEmail") : r.status === 429 ? t("waitlist.tooMany") : t("login.wentWrong"));
    } catch { setErr(t("login.wentWrong")); }
    finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={close} id="waitlist-sheet" className="signin" title={t("landing.joinWaitlist")}>
      {done ? (
        <div className="wl-done" id="waitlist-done">
          <img src={asset(`assets/characters/${done === "added" ? "basket" : "milk"}.webp`)} alt="" />
          <h4>{t(done === "added" ? "waitlist.addedTitle" : "waitlist.alreadyTitle")}</h4>
          <p>{done === "added" ? t("waitlist.addedBody", { email: email.trim().toLowerCase() }) : t("waitlist.alreadyBody")}</p>
          <button type="button" id="waitlist-close" className="btn primary wide" onClick={close}>{t("waitlist.done")}</button>
        </div>
      ) : (
        <form id="waitlist-form" onSubmit={submit}>
          <p className="wl-intro">{t("waitlist.intro")}</p>
          <label className={"field" + (err ? " bad" : "")}>{t("waitlist.email")}
            <input type="email" id="waitlist-email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              inputMode="email" placeholder="you@example.com" required data-first value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <div className="wl-hp" aria-hidden="true"><input type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={e => setTrap(e.target.value)} /></div>
          {err && <p id="waitlist-error" className="wl-err" role="alert">{err}</p>}
          <p style={{ margin: "14px 0 0" }}><button type="submit" id="waitlist-join" className="btn primary wide" disabled={busy}>{t("waitlist.join")}</button></p>
          <p className="wl-note">{t("waitlist.privacy")}<br />{t("waitlist.yourData")}</p>
        </form>
      )}
    </Sheet>
  );
}

/* The tapped card, zoomed up over a dimmed page. It grows from the card
 * and shrinks back to it; Escape, the backdrop and Close all go back. */
function CardZoom({ id, from, onClose }: { id: string; from: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [closing, setClosing] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const card = CARDS.find(c => c.id === id)!;
  // Unmount on a timer, not on animationend: the shrink-back can be
  // skipped (reduced motion, a hidden tab, a reused animation name), and
  // a zoom layer left mounted covers the page so no other card opens.
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(onClose, 300);
    return () => window.clearTimeout(t);
  }, [closing]);
  useEffect(() => {
    // Focus goes back to the card that opened it, so keyboard users keep their place.
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setClosing(true); };
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("keydown", esc); opener?.focus?.(); };
  }, []);
  return (
    <div id="land-zoom" className={"zoombd" + (closing ? " out" : "")} onClick={() => setClosing(true)}>
      <div className="zoomcard" role="dialog" aria-modal="true" aria-labelledby="land-zoom-title"
        style={{ ["--from" as string]: from }} onClick={e => e.stopPropagation()}>
        <img src={asset(`assets/characters/${card.face}.webp`)} alt="" />
        <b id="land-zoom-title">{t(`landing.cards.${id}.title`)}</b>
        <p>{t(`landing.cards.${id}.back`)}</p>
        <button ref={close} id="land-zoom-close" type="button" className="btn primary" onClick={() => setClosing(true)}>{t("landing.close")}</button>
      </div>
    </div>
  );
}

/* Google proved the address, but it is not invited: say so plainly and
 * offer one tap onto the waitlist (the address is already proven). */
async function joinFromGoogle(email: string, open: (email: string, done: "" | "added" | "already") => void) {
  try {
    const r = await postJson("/auth/waitlist", { email });
    if (r.ok) { open(email, ((await r.json()) as { status: "added" | "already" }).status); return; }
  } catch { /* fall through to the form, which shows the error */ }
  open(email, "");
}

function NotInvited({ email, onJoin, onOther }: { email: string; onJoin: (email: string) => void; onOther: () => void }) {
  const { t } = useTranslation();
  return (
    <div id="not-invited">
      <p className="muted hint"><Trans i18nKey="login.notInvitedBody" values={{ email }} components={{ b: <b /> }} /></p>
      <p><button type="button" id="ni-join" className="btn primary wide" onClick={() => onJoin(email)}>{t("landing.joinWaitlist")}</button></p>
      <p className="muted center nomargin"><button type="button" id="ni-other" className="linkbtn" onClick={onOther}>{t("login.differentAccount")}</button></p>
    </div>
  );
}

function EmailSignin({ step, setStep, onDone, onJoin }: {
  step: "email" | "code"; setStep: (s: "email" | "code") => void; onDone: (user: string) => void; onJoin?: (email: string) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [already, setAlready] = useState(false);   // came for a code they were already sent
  const [msg, setMsg] = useState(location.search.includes("signin=failed") ? t("login.googleFailed") : "");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    const r = await postJson("/auth/email/start", { email: email.trim() });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(data.detail || t("login.wentWrong")); return false; }
    return true;
  };
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (step === "email") {
        if (await start()) { setAlready(false); setCode(""); setMsg(""); setStep("code"); }
        return;
      }
      const r = await postJson("/auth/email/verify", { email: email.trim(), code: code.trim() });
      const data = await r.json().catch(() => ({}));
      if (r.ok) { onDone(data.user); return; }
      setMsg(r.status === 401 ? t("login.codeWrong") : r.status === 403 ? t("login.emailNotInvited") : data.detail || t("login.wentWrong"));
    } catch { setMsg(t("login.wentWrong")); }
    finally { setBusy(false); }
  };
  const resend = async () => { if (await start()) setMsg(t("login.newCodeSent")); };
  const msgp = <p id="code-msg" className={"wl-err" + (msg ? "" : " empty")} role="alert">{msg}</p>;
  const join = onJoin && (
    <p className="muted center nomargin">{t("login.notInvitedYet")} <button type="button" id="code-waitlist" className="linkbtn" onClick={() => onJoin(email.trim())}>{t("landing.joinWaitlist")}</button></p>
  );

  if (step === "email") {
    return (
      <div id="email-signin">
        <p className="muted hint">{t("login.startHint")}</p>
        <form id="code-form" onSubmit={submit}>
          <label className="field">{t("login.email")}<input type="email" id="code-email" autoComplete="email" autoCapitalize="none" spellCheck={false} required
              placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <p><button type="submit" id="code-btn" className="btn primary wide" disabled={busy}>{t("login.emailMeCode")}</button></p>
          <p className="center nomargin"><button type="button" id="code-have" className="linkbtn" onClick={() => { setAlready(true); setMsg(""); setStep("code"); }}>{t("login.haveCode")}</button></p>
          <p className="muted center">{t("login.or")}</p>
          <p><a id="google-btn" className="btn wide" href="/auth/google">{t("login.continueWithGoogle")}</a></p>
          {msgp}
        </form>
        {join}
      </div>
    );
  }
  return (
    <div id="email-signin">
      <p className="muted hint">
        {already ? t("login.enterCodeHint") : <Trans i18nKey="login.codeSentTo" values={{ email: email.trim() }} components={{ b: <b /> }} />}{" "}
        {!already && <button type="button" id="code-change" className="linkbtn" onClick={() => { setMsg(""); setStep("email"); }}>{t("login.changeEmail")}</button>}
      </p>
      <form id="code-form" onSubmit={submit}>
        {already && (
          <label className="field">{t("login.email")}<input type="email" id="code-email" autoComplete="email" autoCapitalize="none" spellCheck={false} required
              placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </label>
        )}
        <label className={"field" + (msg && !already ? " bad" : "")} id="code-field">{t("login.codeFromYourEmail")}
          <input type="text" id="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} autoFocus required
            value={code} onChange={e => setCode(e.target.value)} />
        </label>
        {msgp}
        <p><button type="submit" id="code-btn" className="btn primary wide" disabled={busy}>{t("login.signIn")}</button></p>
      </form>
      {!already && onJoin && (
        <>
          <p className="muted nomargin"><b>{t("login.noEmail")}</b> {t("login.maybeNotInvited")}</p>
          <p><button type="button" id="code-waitlist" className="btn wide" onClick={() => onJoin(email.trim())}>{t("landing.joinWaitlist")}</button></p>
        </>
      )}
      {!already && <p className="center nomargin"><button type="button" id="code-resend" className="linkbtn" onClick={resend}>{t("login.sendNewCode")}</button></p>}
      {already && join}
    </div>
  );
}
