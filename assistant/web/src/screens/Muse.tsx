import { useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { api, post } from "../lib/api";
import { useTranslation } from "../i18n";

/* "Use Arya in Muse" (owner, 2026-11-02; mockup
 * claude.ai/artifact/GzhrLQrGXDqcymtvsb4zsJ): make a code, tell Muse
 * to connect, paste the code into the secure box Muse opens, try it.
 * Other AI apps sit in a fold. Code minting is unchanged (app.js
 * paintTokenRow / mintInto). Back lands on Profile.
 * The Shell already renders <section id="view-muse">; no second one. */

const SETUP_PROMPT = `You are connected to my Arya — my grocery assistant at https://arya.teamnightshift.org. Arya keeps a living model of my purchases, inventory and shopping list.

Your job when I talk to you:
- A receipt photo or PDF, or a pasted order (Instacart, Amazon, an email): read it and file it in Arya as structured data — merchant, date, each line (name, quantity, price, line total), subtotal, tax, total. Leave delivery fees and tips out. Report back the total Arya verified, never your own arithmetic.
- Questions about my list, my spending, or whether something expired: answer from Arya's data, not from memory of our chats.
- Anything else: answer normally. Bring Arya in only when my message is about my groceries, receipts, spending or list.

Rules: never guess a product name you cannot read — flag it and let Arya queue it for me. If a name is unknown, check the retailer's own online catalog, propose the match with its source, and wait for my word before settling it. Returns are refunds, never purchases.

My connector token lives in your secure credential store — the one I pasted when we set this up. Send it as a Bearer token and never print it.`;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const MCP_URL = "https://arya.teamnightshift.org/api/mcp";

/* Copy, or leave the text selected to copy by hand. */
function copyText(text: string) {
  try { if (navigator.clipboard) return navigator.clipboard.writeText(text).then(() => true, () => false); } catch { /* not allowed */ }
  return Promise.resolve(false);
}

export function Muse() {
  const { t } = useTranslation();
  const nav = useNav();
  const { demo } = useSession();
  const { toast } = useToast();
  // null = not loaded (row empty); a string = a freshly minted token shown once.
  const [has, setHas] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const paint = async () => {
    setToken(null);
    try { setHas((await api<{ has_token: boolean }>("/auth/token")).has_token); }
    catch { setHas(null); }
  };
  useEffect(() => { paint(); }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const mint = async () => {
    try { setToken((await post<{ token: string }>("/auth/token")).token); }
    catch (e) { toast(errMsg(e)); }
  };
  const copy = () => {
    inputRef.current?.select();
    copyText(inputRef.current?.value ?? "");
    toast(t("muse.tokenCopied"));
  };
  const revoke = async () => {
    try { await api("/auth/token", { method: "DELETE" }); toast(t("muse.revoked")); paint(); }
    catch (e) { toast(errMsg(e)); }
  };
  const copyLine = (text: string) => { copyText(text); toast(t("muse.copied")); };

  const step = (n: number, title: string, id: string) => (
    <h3 className="sect muse-step" id={id}><span className="num" aria-hidden="true">{n}</span>{title}</h3>
  );
  const line = (text: string, id: string, label?: string) => (
    <div className="muse-line">
      {label && <span className="sub">{label}</span>}
      <div className="row"><code className="grow">{text}</code>
        <button className="btn" type="button" data-copy-line={id} aria-label={t("muse.copyThis", { what: text })} onClick={() => copyLine(text)}>{t("muse.copyShort")}</button></div>
    </div>
  );
  const connect = t("muse.connectLine", { url: MCP_URL });
  const tries = [t("muse.try1"), t("muse.try2"), t("muse.try3")];

  return (
    <>
      <p><a href="#" id="pfm-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("muse.title")}</h1>
      <p className="muted" id="muse-intro">{t("muse.intro")}</p>

      {step(1, t("muse.step1"), "muse-s1")}
      <div className="group pad">
        <div className="row" id="profile-token-row">
          {token !== null ? (
            <>
              <input className="grow" data-token-value readOnly value={token} ref={inputRef} />
              <button className="btn primary" data-copy="1" type="button" onClick={copy}>{t("muse.copyShort")}</button>
            </>
          ) : has === null ? (demo ? <span className="sub grow" id="muse-demo">{t("muse.demoNoCode")}</span> : null) : (
            <>
              <span className="sub grow">{has ? t("muse.active") : t("muse.noCode")}</span>
              <button className="btn primary" data-mint="1" type="button" onClick={mint}>{has ? t("muse.newCode") : t("muse.makeCode")}</button>
            </>
          )}
        </div>
        <p className={"sub nomargin" + (token !== null ? " muse-once" : "")} style={{ marginTop: 8 }}>{token !== null ? t("muse.copyItNow") : t("muse.shownOnce")}</p>
      </div>

      {step(2, t("muse.step2"), "muse-s2")}
      <div className="group pad">
        <p className="nomargin">{t("muse.inMuseSay")}</p>
        {line(connect, "connect")}
        {line(MCP_URL, "url", t("muse.addressOnly"))}
      </div>

      {step(3, t("muse.step3"), "muse-s3")}
      <div className="group pad"><p className="nomargin">{t("muse.pasteBody")}</p></div>

      {step(4, t("muse.step4"), "muse-s4")}
      <div className="group pad">
        <p className="nomargin">{t("muse.askMuse")}</p>
        {tries.map((q, k) => (
          <div className="row muse-try" key={k}><span className="grow">“{q}”</span>
            <button className="btn" type="button" data-copy-try={k} aria-label={t("muse.copyThis", { what: q })} onClick={() => copyLine(q)}>{t("muse.copyShort")}</button></div>
        ))}
      </div>

      <details className="group pad" id="muse-other">
        <summary>{t("muse.otherApps")}</summary>
        <p className="sub">{t("muse.otherBody")}</p>
        {line("Authorization: Bearer " + t("muse.yourCode"), "header", t("muse.header"))}
        <p style={{ marginTop: 10 }}>
          <button className="btn" data-copy-prompt="1" type="button" onClick={() => { copyText(SETUP_PROMPT); toast(t("muse.promptCopied")); }}>{t("muse.copySetupPrompt")}</button>
        </p>
        <p className="sub nomargin">{t("muse.promptWhy")}</p>
      </details>

      <div className="group pad" id="muse-help">
        <b>{t("muse.notWorking")}</b>
        <p className="sub nomargin">{t("muse.notWorkingBody")}</p>
        {has && token === null && <button className="btn danger" data-revoke="1" type="button" style={{ marginTop: 10 }} onClick={revoke}>{t("muse.revoke")}</button>}
      </div>
      <p className="sub" style={{ textAlign: "center" }}>{t("muse.sameCodeListsApi")} <a href="/developers">{t("muse.developerPage")}</a></p>
    </>
  );
}
