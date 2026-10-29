import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "../app/session";
import { Sheet } from "../ui/Sheet";
import { asset } from "../lib/format";
import { Trans, useTranslation } from "../i18n";
import { A2hsSteps, isIOS, useA2hs } from "../ui/A2hs";

/* The logged-out landing (B1 flip cards, owner 2026-10-29) and
 * sign-in. Three modes: bootstrap (no accounts yet,
 * setup), sign in, and public registration, which shows only when the
 * server reports it open. Optional email-code and Google sign-in. */
type Mode = "setup" | "login" | "register";

/* Landing flip cards (B1, owner 2026-10-29): each card wobbles until
 * it is first tapped; a tap flips it to its back. The cards a visitor
 * has tapped stay still for good (localStorage, per browser). */
export const CARDS = [
  { id: "habits", face: "milk" },
  { id: "news", face: "egg" },
  { id: "quest", face: "compass" },
  { id: "map", face: "binoculars" },
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
 * apply. About 1.2 s after load, and every 8 s, it jiggles (a soft
 * glow with reduced motion), until it is first tapped (localStorage). */
export const GETAPP_KEY = "arya.landing.getapp";

export function getAppTapped(): boolean {
  try { return localStorage.getItem(GETAPP_KEY) === "1"; } catch { return false; }
}

const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
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
  const [signin, setSignin] = useState(!status.has_users || location.search.includes("signin=failed"));
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
    if (r.ok) { enter("demo", true); return; }
    setErr((await detail(r)) || t("login.demoFailed"));
    setSignin(true);
  };

  const [seen, setSeen] = useState<string[]>(loadSeen);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const tap = (id: string) => {
    setFlipped(f => ({ ...f, [id]: !f[id] }));
    if (!seen.includes(id)) { const next = [...seen, id]; setSeen(next); saveSeen(next); }
  };

  const openSignin = (m: "login" | "register") => {
    if (mode !== "setup") setMode(m);
    setErr("");
    setSignin(true);
  };

  return (
    <section id="view-login" className="view">
      <div className="landpage">
        <header className="landtop">
          <span className="landlogo">Arya</span>
          <GetApp />
          <button id="signin-open" className="linkbtn landsign" type="button" onClick={() => openSignin("login")}>{t("landing.signIn")}</button>
        </header>
        <div className="hero landhero">
          <h2 className="largetitle herotitle"><Trans i18nKey="landing.headline" components={{ em: <em /> }} /></h2>
          <p className="herosub nomargin landsub">{t("landing.subhead")}</p>
          <div className="landcards">
            {CARDS.map(c => (
              <button key={c.id} id={"land-" + c.id} type="button" aria-pressed={!!flipped[c.id]}
                className={"ftile" + (seen.includes(c.id) ? " seen" : "") + (flipped[c.id] ? " on" : "")}
                onClick={() => tap(c.id)}>
                <span className="in">
                  <span className="face front" aria-hidden={!!flipped[c.id]}><span className="flipi" aria-hidden="true">↻</span>
                    <img src={asset(`assets/characters/${c.face}.webp`)} alt="" />
                    <b>{t(`landing.cards.${c.id}.title`)}</b><span className="s">{t(`landing.cards.${c.id}.sub`)}</span></span>
                  <span className="face back" aria-hidden={!flipped[c.id]}>
                    <b>{t(`landing.cards.${c.id}.title`)}</b><span className="s">{t(`landing.cards.${c.id}.back`)}</span></span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="landfoot">
          <button id="demo-btn" className="btn primary wide" type="button" onClick={demo}>{t("landing.tryIt")}</button>
          {status.registration_open && (
            <button id="register-open" className="btn secondary wide" type="button" onClick={() => openSignin("register")}>{t("landing.startOwnList")}</button>
          )}
          <p className="landnote">{t("landing.demoNote")}</p>
        </div>
      </div>

      <Sheet open={signin} onClose={() => setSignin(false)} id="signin-sheet" className="signin"
        title={create ? t("login.createTitle") : t("login.signIn")}>
        {status.email_signin && <EmailSignin onDone={u => enter(u, false)} />}
        <form id="login-form" onSubmit={submit}>
          <label className="field">{create ? t("login.username") : t("login.emailOrUsername")}
            <input type="text" id="login-user" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              inputMode="email" required data-first value={user} onChange={e => setUser(e.target.value)} />
          </label>
          <label className="field">{t("login.password")}<input type="password" id="login-pass" autoComplete={create ? "new-password" : "current-password"} required
              value={pass} onChange={e => setPass(e.target.value)} />
          </label>
          <p><button type="submit" id="login-btn" className="btn primary wide">{create ? t("login.createAccount") : t("login.signIn")}</button></p>
          <p id="login-error" className="muted loginerr" role="alert">{err}</p>
        </form>
        {mode !== "setup" && status.registration_open && (
          <p className="nomargin"><button type="button" id="login-toggle" className="linkbtn"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}>
            {create ? t("login.haveAccount") : t("login.newHere")}</button></p>
        )}
      </Sheet>
    </section>
  );
}

function EmailSignin({ onDone }: { onDone: (user: string) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState(location.search.includes("signin=failed") ? t("login.googleFailed") : "");

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const r = sent ? await postJson("/auth/email/verify", { email: email.trim(), code }) : await postJson("/auth/email/start", { email: email.trim() });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(data.detail || t("login.wentWrong")); return; }
    if (sent) { onDone(data.user); return; }
    setSent(true);
    setMsg(t("login.emailedCode"));
  };

  return (
    <div id="email-signin">
      <p><a id="google-btn" className="btn wide" href="/auth/google">{t("login.continueWithGoogle")}</a></p>
      <form id="code-form" onSubmit={submit}>
        <label className="field">{t("login.email")}<input type="email" id="code-email" autoComplete="email" autoCapitalize="none" spellCheck={false} required
            value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        {sent && (
          <label className="field" id="code-field">{t("login.codeFromYourEmail")}<input type="text" id="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} autoFocus
              value={code} onChange={e => setCode(e.target.value)} />
          </label>
        )}
        <p><button type="submit" id="code-btn" className="btn wide">{sent ? t("login.signIn") : t("login.emailMeCode")}</button></p>
        <p id="code-msg" className="muted loginerr" role="alert">{msg}</p>
      </form>
      <p className="muted">{t("login.orUseAPassword")}</p>
    </div>
  );
}
