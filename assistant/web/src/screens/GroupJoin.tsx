import { useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { get, post } from "../lib/api";
import { useToast } from "../ui/Toast";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-group-join + group.js (openJoin,
 * preview, joinNow). The invite code comes from nav.params.code; an
 * invite link (/?join=CODE) is read by joinCodeFromUrl(), which the
 * Shell can call after sign-in. */
const fmtCode = (c: string) => (c.length === 6 ? c.slice(0, 3) + " " + c.slice(3) : c);
const cleanCode = (s: unknown) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const initial = (h?: string) => (h || "?").charAt(0).toUpperCase();

export function joinCodeFromUrl(): string {
  try { return new URLSearchParams(location.search).get("join") || ""; } catch { return ""; }
}

type Preview = { name: string; invited_by: string; people: number; lists: number; my_lists: number; full?: boolean };

export function GroupJoin() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast } = useToast();
  const paramCode = typeof nav.params.code === "string" ? nav.params.code : "";
  const [value, setValue] = useState(paramCode ? fmtCode(cleanCode(paramCode)) : "");
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const warned = useRef("");

  // Re-opened: start fresh (openJoin).
  useEffect(() => {
    setValue(paramCode ? fmtCode(cleanCode(paramCode)) : "");
    setPv(null); setErr("");
    if (!paramCode) input.current?.focus();
  }, [nav.key, paramCode]);

  const code = cleanCode(value);
  useEffect(() => {
    setPv(null); setErr("");
    if (code.length !== 6) return;
    let stale = false;
    get<Preview>("/api/group/preview?code=" + encodeURIComponent(code))
      .then(p => {
        if (stale) return;
        setPv(p);
        if (p.full && warned.current !== code) { warned.current = code; toast("That group is full."); }
      })
      .catch(e => { if (!stale) setErr(e.message); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const onInput = (v: string) => {
    const c = cleanCode(v).slice(0, 6);
    setValue(c.length === 6 ? fmtCode(c) : v);
  };

  const join = async () => {
    try {
      const g = await post("/api/group/join", { code });
      toast(`You joined ${g.group.name}. Your lists are shared now.`);
      nav.show("profile");
    } catch (e: any) { toast(e.message); warned.current = ""; }
  };

  const bul = (icon: string, title: string, sub: string) => (
    <div className="gbul"><span className="gico" aria-hidden="true">{icon}</span>
      <span className="grow"><b>{title}</b>{sub ? <span className="sub">{sub}</span> : null}</span></div>
  );

  return (
    <>
      <p><a href="#" id="gj-back" onClick={ev => { ev.preventDefault(); nav.show("profile"); }}>{t("groupJoin.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("groupJoin.joinAGroup")}</h2>
      <div className="group pad">
        <label className="field">{t("groupJoin.inviteCode")}<input type="text" id="gj-code" className="gjcode" maxLength={9} autoComplete="off" autoCapitalize="characters"
            spellCheck={false} placeholder="K7Q 4MX" ref={input} value={value} onChange={e => onInput(e.target.value)} />
        </label>
      </div>
      <div id="gj-preview">
        {err && <p className="muted">{err}</p>}
        {pv && (
          <>
            <div className="group"><div className="row">
              <span className="gm other">{initial(pv.name)}</span>
              <span className="grow"><span className="name gname">{pv.name}</span>
                <span className="sub">{t("groupJoin.invitedYou", { invited_by: pv.invited_by, people: pv.people })}{" "}{pv.people === 1 ? "person" : "people"}{" "}{t("groupJoin.list", { lists: pv.lists })}{pv.lists === 1 ? "" : "s"}</span></span>
            </div></div>
            <h3 className="sect">{t("groupJoin.whatChanges")}</h3>
            <div className="group pad">
              {bul("📋", pv.my_lists ? (pv.my_lists === 1 ? "Your list joins the group" : `Your ${pv.my_lists} lists join the group`) : "You share the group's lists", "Lists with the same name merge. Everyone can add and tick.")}
              {bul("🧾", "Your receipts stay yours", "The group can see them while you are in it.")}
              {bul("📈", "Running low and patterns use everyone's trips", "")}
              {bul("🙂", "Profile, avatar, badges and reminders stay yours", "")}
            </div>
          </>
        )}
      </div>
      <p style={{ marginTop: 16 }}><button className="btn primary wide" id="gj-go" type="button" disabled={!pv || !!pv.full} onClick={join}>{pv ? `Join ${pv.name}` : "Join"}</button></p>
      <p className="muted small" style={{ textAlign: "center" }}>{t("groupJoin.youCanLeaveAnyTime")}</p>
    </>
  );
}
