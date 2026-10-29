import { useState, type FormEvent } from "react";
import { useSession } from "../app/session";
import { Sheet } from "../ui/Sheet";
import { asset } from "../lib/format";

/* Port of the landing page and boot() sign-in (pwa/index.html
 * #view-login, app.js boot). Three modes: bootstrap (no accounts yet,
 * setup), sign in, and public registration, which shows only when the
 * server reports it open. Optional email-code and Google sign-in. */
type Mode = "setup" | "login" | "register";

const postJson = (path: string, body?: unknown) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const detail = async (r: Response) => ((await r.json().catch(() => ({}))) as { detail?: string }).detail;

export function Login() {
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
    if (!r.ok) { setErr((await detail(r)) || (mode === "login" ? "Sign-in failed." : "Could not create the account.")); return; }
    enter((await r.json()).user, false);
  };

  const demo = async () => {
    const r = await fetch("/auth/demo", { method: "POST" });
    if (r.ok) { enter("demo", true); return; }
    setErr((await detail(r)) || "The demo did not open. Try again.");
    setSignin(true);
  };

  return (
    <section id="view-login" className="view">
      <header className="landtop">
        <span className="landlogo">Arya</span>
        <button id="signin-open" className="landsign" type="button" onClick={() => setSignin(true)}>Sign in</button>
      </header>
      <div className="hero">
        <h2 className="largetitle herotitle">Groceries, <em>sorted.</em></h2>
        <p className="herosub nomargin">Arya keeps your list, knows what&rsquo;s running low, and tells you what&rsquo;s up at your store before you go.</p>
        <div className="group peek" aria-label="What Arya shows you">
          <Peek img="milk" name="Whole Milk" sub="Every ~7 days, last bought 10 days ago" tag="Running low" kind="low" />
          <Peek img="egg" name="Organic Eggs" sub="Trader Joe’s: shoppers say out today" tag="Store alert" kind="alert" />
          <Peek img="vegetable" name="Baby Spinach" sub="Use by Friday" tag="Use soon" />
        </div>
        <p className="peekcap">From your receipts. No typing it all in.</p>
        <p className="landcta"><button id="demo-btn" className="btn primary wide" type="button" onClick={demo}>Try the demo</button></p>
        <p className="landmeta muted"><span>No account needed &middot; fictional household</span>
          <button id="how-open" className="linkbtn" type="button" onClick={() => setHow(true)}>How it works</button></p>
        <p className="questline"><img src={asset("assets/scenes/hero.webp")} alt="" />
          <span><b>Want it fun?</b> Quest turns your list into a treasure hunt through the store.</span></p>
      </div>

      <Sheet open={signin} onClose={() => setSignin(false)} id="signin-sheet" className="signin"
        title={create ? "Create your account" : "Sign in"}>
        {status.email_signin && <EmailSignin onDone={u => enter(u, false)} />}
        <form id="login-form" onSubmit={submit}>
          <label className="field">{create ? "Username" : "Email or username"}
            <input type="text" id="login-user" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              inputMode="email" required data-first value={user} onChange={e => setUser(e.target.value)} />
          </label>
          <label className="field">Password
            <input type="password" id="login-pass" autoComplete={create ? "new-password" : "current-password"} required
              value={pass} onChange={e => setPass(e.target.value)} />
          </label>
          <p><button type="submit" id="login-btn" className="btn primary wide">{create ? "Create account" : "Sign in"}</button></p>
          <p id="login-error" className="muted loginerr" role="alert">{err}</p>
        </form>
        {mode !== "setup" && status.registration_open && (
          <p className="nomargin"><button type="button" id="login-toggle" className="linkbtn"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}>
            {create ? "Already have an account? Sign in" : "New here? Create account"}</button></p>
        )}
      </Sheet>

      <Sheet open={how} onClose={() => setHow(false)} id="how-sheet" title="How it works">
        <p>Arya learns what your household buys from its receipts and keeps your lists. It tells you what is running low and why, what is out or cheaper at your store, and what to use soon.</p>
        <p>When you want it fun, Quest turns the list into a hunt through the real store: you walk it in photos from one shopper&rsquo;s walkthrough video, with a 3D model of the aisle one tap away. The receipt at checkout settles the score.</p>
        <p className="muted">The demo opens a fictional household, no account needed. Your hunts, list changes and chats last only for this visit. The camera and microphone call the Meta API live.</p>
        <p className="muted nomargin">Built on Meta models. Entry in the Meta AI Developer Hackathon.</p>
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
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState(location.search.includes("signin=failed") ? "Google sign-in did not finish. Try again." : "");

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const r = sent ? await postJson("/auth/email/verify", { email: email.trim(), code }) : await postJson("/auth/email/start", { email: email.trim() });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(data.detail || "Something went wrong."); return; }
    if (sent) { onDone(data.user); return; }
    setSent(true);
    setMsg("We emailed you a code. Enter it here.");
  };

  return (
    <div id="email-signin">
      <p><a id="google-btn" className="btn wide" href="/auth/google">Continue with Google</a></p>
      <form id="code-form" onSubmit={submit}>
        <label className="field">Email
          <input type="email" id="code-email" autoComplete="email" autoCapitalize="none" spellCheck={false} required
            value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        {sent && (
          <label className="field" id="code-field">Code from your email
            <input type="text" id="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={10} autoFocus
              value={code} onChange={e => setCode(e.target.value)} />
          </label>
        )}
        <p><button type="submit" id="code-btn" className="btn wide">{sent ? "Sign in" : "Email me a code"}</button></p>
        <p id="code-msg" className="muted loginerr" role="alert">{msg}</p>
      </form>
      <p className="muted">Or use a password:</p>
    </div>
  );
}
