import { useState, type FormEvent } from "react";
import { Trans, useTranslation } from "../i18n";
import { looksLikeMetaKey } from "../lib/ownKey";
import { OwnKeySafeBody } from "./OwnKey";
import { Sheet } from "./Sheet";

/* Sign up with your own Meta key (owner-approved mockup 2026-11-01,
 * claude.ai/artifact/B7rDvxNoEJz7DcWhNkJvx4). Two ways in: the waitlist
 * (Arya's keys, wait for an invite) or your own Meta key (start now; the
 * account runs only on that key and never on Arya's). The key is checked
 * with Meta, then an emailed code proves the address; nothing is saved
 * before the code. Shown only when /auth/status says own_key_signup. */

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const detailOf = async (r: Response) => ((await r.json().catch(() => ({}))) as { detail?: string }).detail;

export function WaysSheet({ open, onClose, onWaitlist, onKey }: { open: boolean; onClose: () => void; onWaitlist: () => void; onKey: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose} id="ways-sheet" className="signin" title={t("keySignup.waysTitle")}>
      <p className="wl-intro">{t("keySignup.waysIntro")}</p>
      <button type="button" className="ks-way" id="ways-waitlist" onClick={onWaitlist}>
        <b>{t("keySignup.waitlistTitle")}</b><span>{t("keySignup.waitlistBody")}</span><em>{t("keySignup.waitlistTag")}</em></button>
      <button type="button" className="ks-way" id="ways-key" onClick={onKey}>
        <b>{t("keySignup.keyTitle")}</b><span>{t("keySignup.keyBody")}</span><em>{t("keySignup.keyTag")}</em></button>
      <p className="wl-note">{t("keySignup.waysNote")}</p>
    </Sheet>
  );
}

export function KeySignupSheet({ open, onClose, onDone, onSignin }: {
  open: boolean; onClose: () => void; onDone: (user: string) => void; onSignin: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"form" | "code">("form");
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");
  const [ok, setOk] = useState(false);
  const [ends, setEnds] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<{ field: "key" | "email" | "code" | ""; text: string; signin?: boolean }>({ field: "", text: "" });
  const [busy, setBusy] = useState(false);
  const [safe, setSafe] = useState(false);

  const close = () => { setKey(""); setCode(""); setErr({ field: "", text: "" }); setStep("form"); onClose(); };
  const start = async () => {
    const r = await post("/auth/own-key/start", { email: email.trim(), key: key.trim(), accept: true });
    if (r.ok) { const d = await r.json().catch(() => ({})); setEnds(d.ends || key.trim().slice(-4)); return true; }
    const text = (await detailOf(r)) || t("login.wentWrong");
    const aboutEmail = /email/i.test(text);
    setErr(r.status === 409 && aboutEmail ? { field: "email", text, signin: true }
      : aboutEmail ? { field: "email", text }
      : r.status === 422 || (r.status === 400 && /LLM_/.test(text)) || r.status === 409 ? { field: "key", text }
      : { field: "", text });
    return false;
  };
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setErr({ field: "", text: "" });
    if (step === "form") {
      if (!looksLikeMetaKey(key)) { setErr({ field: "key", text: t("ownKey.notMeta") }); return; }
      setBusy(true);
      try { if (await start()) { setKey(""); setCode(""); setStep("code"); } }
      catch { setErr({ field: "", text: t("login.wentWrong") }); }
      finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      const r = await post("/auth/own-key/verify", { email: email.trim(), code: code.trim() });
      if (r.ok) { const d = await r.json().catch(() => ({})); setStep("form"); onDone(d.user); return; }
      const text = (await detailOf(r)) || t(r.status === 401 ? "login.codeWrong" : "login.wentWrong");
      // 410: the held key expired (15 min); start again from the form.
      if (r.status === 410) { setStep("form"); setErr({ field: "", text }); return; }
      setErr({ field: "code", text });
    } catch { setErr({ field: "", text: t("login.wentWrong") }); }
    finally { setBusy(false); }
  };
  const errp = err.text ? (
    <p className="wl-err" id="ks-err" role="alert">{err.text}
      {err.signin && <> <button type="button" className="linkbtn" id="ks-signin" onClick={() => { close(); onSignin(); }}>{t("login.signIn")}</button></>}</p>
  ) : null;

  return (
    <>
      <Sheet open={open && !safe} onClose={close} id="key-signup-sheet" className="signin" focusKey={step}
        title={step === "code" ? t("login.checkEmail") : t("keySignup.formTitle")}>
        {step === "form" ? (
          <form id="ks-form" onSubmit={submit}>
            <p className="wl-intro">{t("keySignup.formIntro")}</p>
            <label className={"field" + (err.field === "email" ? " bad" : "")}>{t("login.email")}
              <input type="email" id="ks-email" autoComplete="email" autoCapitalize="none" spellCheck={false} required
                placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
            </label>
            <label className={"field" + (err.field === "key" ? " bad" : "")}>{t("keySignup.keyLabel")}
              <input type="password" id="ks-key" className="ok-mono" autoComplete="off" autoCapitalize="off" spellCheck={false} required
                placeholder="LLM_…" value={key} onChange={e => setKey(e.target.value)} />
            </label>
            {errp}
            <ul className="ok-ul"><li>{t("ownKey.before1")}</li><li>{t("ownKey.before2")}</li><li>{t("ownKey.before3")}</li></ul>
            <label className="ks-check"><input type="checkbox" id="ks-accept" checked={ok} onChange={e => setOk(e.target.checked)} />
              <span>{t("keySignup.accept")}</span></label>
            <p><button type="submit" id="ks-go" className="btn primary wide" disabled={busy || !ok || !email.trim() || !key.trim()}>
              {busy ? t("ownKey.checking") : t("keySignup.go")}</button></p>
            <p className="wl-note">{t("keySignup.formNote")}</p>
            <button type="button" className="linkbtn" id="ks-safe" onClick={() => setSafe(true)}>{t("ownKey.safeLink")} ›</button>
          </form>
        ) : (
          <form id="ks-code-form" onSubmit={submit}>
            <p className="ks-ok" id="ks-checked">✓ {t("keySignup.checked", { ends })}</p>
            <p className="muted hint"><Trans i18nKey="keySignup.codeSent" values={{ email: email.trim() }} components={{ b: <b /> }} />{" "}
              <button type="button" className="linkbtn" id="ks-change" onClick={() => { setErr({ field: "", text: "" }); setStep("form"); }}>{t("login.changeEmail")}</button></p>
            <label className={"field" + (err.field === "code" ? " bad" : "")}>{t("login.codeFromYourEmail")}
              <input type="text" id="ks-code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} autoFocus required
                value={code} onChange={e => setCode(e.target.value)} />
            </label>
            {errp}
            <p><button type="submit" id="ks-create" className="btn primary wide" disabled={busy || !code.trim()}>{t("keySignup.create")}</button></p>
            <p className="wl-note">{t("keySignup.codeNote")}</p>
          </form>
        )}
      </Sheet>
      <Sheet open={open && safe} onClose={() => setSafe(false)} id="ks-safe-sheet" className="signin" title={t("ownKey.safeTitle")} closeLabel={t("common.back")}>
        <OwnKeySafeBody keyAccount />
      </Sheet>
    </>
  );
}
