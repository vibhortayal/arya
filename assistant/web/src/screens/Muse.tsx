import { useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { api, post } from "../lib/api";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-muse ("Connect an AI agent") plus
 * app.js paintTokenRow / mintInto / SETUP_PROMPT. Back lands on Profile.
 * The Shell already renders <section id="view-muse">; no second one. */

const SETUP_PROMPT = `You are connected to my Arya — my grocery assistant at https://arya.teamnightshift.org. Arya keeps a living model of my purchases, inventory and shopping list.

Your job when I talk to you:
- A receipt photo or PDF, or a pasted order (Instacart, Amazon, an email): read it and file it in Arya as structured data — merchant, date, each line (name, quantity, price, line total), subtotal, tax, total. Leave delivery fees and tips out. Report back the total Arya verified, never your own arithmetic.
- Questions about my list, my spending, or whether something expired: answer from Arya's data, not from memory of our chats.
- Anything else: answer normally. Bring Arya in only when my message is about my groceries, receipts, spending or list.

Rules: never guess a product name you cannot read — flag it and let Arya queue it for me. If a name is unknown, check the retailer's own online catalog, propose the match with its source, and wait for my word before settling it. Returns are refunds, never purchases.

My connector token lives in your secure credential store — the one I pasted when we set this up. Send it as a Bearer token and never print it.`;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
    if (navigator.clipboard) navigator.clipboard.writeText(inputRef.current?.value ?? "").catch(() => { /* selected; copy by hand */ });
    toast(t("muse.tokenCopied"));
  };
  const revoke = async () => {
    try { await api("/auth/token", { method: "DELETE" }); toast(t("muse.revoked")); paint(); }
    catch (e) { toast(errMsg(e)); }
  };

  return (
    <>
      <p><a href="#" id="pfm-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("muse.connectAnAiAgent")}</h1>
      <div className="group pad">
        <p className="muted nomargin">{t("muse.useAryaFromAnAi")}</p>
        <p className="muted nomargin" style={{ marginTop: 6 }}>{t("muse.sameCodeListsApi")} <a href="/developers">{t("muse.developerPage")}</a></p>
        <div className="row" id="profile-token-row" style={{ marginTop: 10 }}>
          {token !== null ? (
            <>
              <input className="grow" data-token-value readOnly value={token} ref={inputRef} />
              <button className="btn" data-copy="1" onClick={copy}>{t("muse.copy")}</button>
              <span className="sub">{t("muse.copyItNowItIs")}</span>
            </>
          ) : has === null ? (demo ? <span className="sub grow" id="muse-demo">{t("muse.demoNoCode")}</span> : null) : (
            <>
              <span className="sub grow">{has ? t("muse.active") : t("muse.noCode")}</span>
              <button className="btn" data-mint="1" onClick={mint}>{has ? t("muse.newCode") : t("muse.makeCode")}</button>
              {has && <button className="btn danger" data-revoke="1" onClick={revoke}>{t("muse.revoke")}</button>}
            </>
          )}
        </div>
        <p style={{ marginTop: 10 }}>
          <button className="btn" data-copy-prompt="1" type="button" onClick={() => {
            if (navigator.clipboard) navigator.clipboard.writeText(SETUP_PROMPT).catch(() => { /* not allowed here */ });
            toast(t("muse.promptCopied"));
          }}>{t("muse.copySetupPrompt")}</button> <span className="sub">{t("muse.pasteItIntoYourAssistant")}</span>
        </p>
      </div>
    </>
  );
}
