import { useState, type FormEvent } from "react";
import { useSession } from "../app/session";
import { Sheet } from "../ui/Sheet";
import { asset } from "../lib/format";
import { Trans, useTranslation } from "../i18n";

/* Port of the landing page and boot() sign-in (pwa/index.html
 * #view-login, app.js boot). Three modes: bootstrap (no accounts yet,
 * setup), sign in, and public registration, which shows only when the
 * server reports it open. Optional email-code and Google sign-in. */
type Mode = "setup" | "login" | "register";

const postJson = (path: string, body?: unknown) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const detail = async (r: Response) => ((await r.json().catch(() => ({}))) as { detail?: string }).detail;

export function Login() {
  const { t } = useTranslation();
  const { status, enter } = useSession();
  const [mode, setMode] = useState<Mode>(status.has_users ? "login" : "setup");
  const [signin, setSignin] = useState(!status.has_users || location.search.includes("signin=failed"));
  const [how, setHow] = useState(false);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const create = mode !== "login";

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

  return (
    <section id="view-login" className="view">
      <header className="landtop">
        <span className="landlogo">Arya</span>
        <button id="signin-open" className="landsign" type="button" onClick={() => setSignin(true)}>{t("login.signIn")}</button>
      </header>
      <div className="hero">
        <h2 className="largetitle herotitle"><Trans i18nKey="login.hero" components={{ em: <em /> }} /></h2>
        <p className="herosub nomargin">{t("login.aryaKeepsYourListKnows")}</p>
        <div className="group peek" aria-label={t("login.whatAryaShowsYou")}>
          <Peek img="milk" name="Whole Milk" sub={t("login.every7DaysLastBought")} tag={t("common.runningLow")} kind="low" />
          <Peek img="egg" name="Organic Eggs" sub={t("login.traderJoeSShoppersSay")} tag={t("login.storeAlert")} kind="alert" />
          <Peek img="vegetable" name="Baby Spinach" sub={t("login.useByFriday")} tag={t("common.useSoon")} />
        </div>
        <p className="peekcap">{t("login.fromYourReceiptsNoTyping")}</p>
        <p className="landcta"><button id="demo-btn" className="btn primary wide" type="button" onClick={demo}>{t("login.tryTheDemo")}</button></p>
        <p className="landmeta muted"><span>{t("login.noAccountNeededFictionalHousehold")}</span>
          <button id="how-open" className="linkbtn" type="button" onClick={() => setHow(true)}>{t("login.howItWorks")}</button></p>
        <p className="questline"><img src={asset("assets/scenes/hero.webp")} alt="" />
          <span><Trans i18nKey="login.questLine" components={{ b: <b /> }} /></span></p>
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

      <Sheet open={how} onClose={() => setHow(false)} id="how-sheet" title={t("login.howItWorks")}>
        <p>{t("login.aryaLearnsWhatYourHousehold")}</p>
        <p>{t("login.whenYouWantItFun")}</p>
        <p className="muted">{t("login.theDemoOpensAFictional")}</p>
        <p className="muted nomargin">{t("login.builtOnMetaModelsEntry")}</p>
      </Sheet>
    </section>
  );
}

function Peek({ img, name, sub, tag, kind }: { img: string; name: string; sub: string; tag: string; kind?: string }) {
  return (
    <div className="row"><img className="rowface" src={asset(`assets/characters/${img}.webp`)} alt="" />
      <div className="grow"><span className="name">{name}</span><span className="sub">{sub}</span></div>
      <span className={"peektag" + (kind ? " " + kind : "")}>{tag}</span></div>
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
