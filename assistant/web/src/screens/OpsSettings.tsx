import { useCallback, useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { get, post } from "../lib/api";
import { Button, Chip, Group, Row, Section } from "../ui/kit";
import { useToast } from "../ui/Toast";
import { useTranslation } from "../i18n";

/* Ops settings (owner, 2026-11-01, mock arya-ops-settings 2-4): models and
 * reading, dollar limits with per-account overrides, other caps. Owner
 * only. Reads /api/ops; saves post to /api/ops/controls. A value left
 * blank (or "Use default") hands the setting back to the environment. */

type Setting = { value: number; default: number; range: [number, number]; kind: "usd" | "int"; label: string; group: string; note: string; set: boolean };
type OpsData = {
  controls: { photo_reader: string; spark_tier: string; open_model: string | null; reasoning_effort: string | null };
  settings: Record<string, Setting>;
  overrides: Record<string, Record<string, number>>;
};
type Page = "models" | "limits" | "caps" | "accounts" | "data";
type Mirror = { store: string; configured: boolean; state: string; kind: string; done: number; total: number; result: string; ok: boolean | null };
type Acct = { user: string; usd_24h: number; owner: boolean; frozen: boolean; disabled: boolean };
type Accounts = { accounts: Acct[]; owner: { username: string | null; previous: string | null; at: number | null; undo_s: number } };

function Num({ k, s, busy, onSave }: { k: string; s: Setting; busy: boolean; onSave: (k: string, v: number | null) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState(String(s.value));
  useEffect(() => { setV(String(s.value)); }, [s.value]);
  const shown = (n: number) => (s.kind === "usd" ? `$${n}` : String(n));
  return (
    <div className="row prefrow inline">
      <div className="grow"><span className="name">{s.label}</span>
        {s.note ? <span className="sub">{s.note}</span> : null}
        <span className="sub">{t("opsSettings.default", { v: shown(s.default), lo: shown(s.range[0]), hi: shown(s.range[1]) })}</span>
        {s.set && <button type="button" className="linkbtn" disabled={busy} onClick={() => onSave(k, null)}>{t("opsSettings.useDefault")}</button>}
      </div>
      <div className="prefpicks">
        <input id={"os-" + k} className="curpick" style={{ width: 92, textAlign: "right" }} inputMode="decimal" aria-label={s.label} value={v}
          disabled={busy} onChange={ev => setV(ev.target.value)}
          onBlur={() => { const n = Number(v); if (v.trim() !== "" && n !== s.value) onSave(k, n); else setV(String(s.value)); }} />
      </div>
    </div>
  );
}

export function OpsSettings() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast } = useToast();
  const page = ((nav.params as { page?: Page }).page || "models") as Page;
  const [d, setD] = useState<OpsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [acct, setAcct] = useState("");
  const [okey, setOkey] = useState("hourly_freeze_usd");
  const [oval, setOval] = useState("");

  const [acc, setAcc] = useState<Accounts | null>(null);
  const [mir, setMir] = useState<Mirror | null>(null);
  const [delUser, setDelUser] = useState("");
  const [delWhat, setDelWhat] = useState("receipts");
  const [delConfirm, setDelConfirm] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [pw, setPw] = useState("");
  const load = useCallback(() => {
    get<OpsData>("/api/ops").then(setD, () => toast(t("ops.couldNotLoad")));
    if (page === "data") {
      get<Mirror>("/api/ops/mirror").then(setMir, () => toast(t("ops.couldNotLoad")));
      get<Accounts>("/api/ops/accounts").then(setAcc, () => {});
    }
    if (page === "accounts") get<Accounts>("/api/ops/accounts").then(setAcc, () => toast(t("ops.couldNotLoad")));
  }, [t, toast, page]);
  useEffect(() => { load(); }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { await post("/api/ops/controls", body); load(); }
    catch (e) { toast(e instanceof Error && e.message ? e.message : t("ops.couldNotSave")); load(); }
    setBusy(false);
  };
  const act = async (url: string, body: Record<string, unknown>, ok?: string) => {
    setBusy(true);
    try { await post(url, body); if (ok) toast(ok); load(); }
    catch (e) { toast(e instanceof Error && e.message ? e.message : t("ops.couldNotSave")); }
    setBusy(false);
  };
  useEffect(() => {
    if (page !== "data" || mir?.state !== "running") return;
    const id = setTimeout(load, 1500);
    return () => clearTimeout(id);
  }, [page, mir, load]);
  const saveSetting = (k: string, v: number | null) => send({ settings: { [k]: v } });

  const of = (group: string) => d ? Object.entries(d.settings).filter(([, s]) => s.group === group) : [];
  const acctKeys = d ? Object.entries(d.settings).filter(([, s]) => s.group === "account") : [];

  return (
    <>
      <p><a href="#" id="os-back" onClick={ev => { ev.preventDefault(); nav.back("ops"); }}><span aria-hidden="true">‹ </span>{t("opsSettings.backToOps")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("opsSettings.title_" + page)}</h1>
      {d && page === "models" && (
        <>
          <Section title={t("opsSettings.photoReader")} />
          <Group>
            <div className="row prefrow inline"><div className="grow"><span className="name">{t("ops.reader")}</span><span className="sub">{t("opsSettings.readerSub")}</span>
              {d.controls.photo_reader !== "wonder" && d.controls.spark_tier === "contributor" &&
                <span className="sub" style={{ color: "var(--danger)" }}>{t("opsSettings.readerWarn")}</span>}</div>
              <div className="prefpicks">
                <select id="os-reader" className="curpick" aria-label={t("ops.reader")} value={d.controls.photo_reader} disabled={busy}
                  onChange={ev => send({ photo_reader: ev.target.value })}>
                  <option value="wonder">{t("ops.readerWonder")}</option>
                  <option value="spark">{t("opsSettings.readerSparkOnly")}</option>
                  <option value="auto">{t("opsSettings.readerAuto")}</option>
                </select>
              </div></div>
            <div className="row prefrow inline"><div className="grow"><span className="name">{t("opsSettings.tier")}</span><span className="sub">{t("opsSettings.tierSub")}</span>
              {d.controls.spark_tier === "contributor" && <span className="sub" style={{ color: "var(--danger)" }}>{t("opsSettings.tierWarn")}</span>}</div>
              <div className="prefpicks">
                <select id="os-tier" className="curpick" aria-label={t("opsSettings.tier")} value={d.controls.spark_tier} disabled={busy}
                  onChange={ev => send({ spark_tier: ev.target.value })}>
                  <option value="standard">{t("opsSettings.tierStandard")}</option>
                  <option value="contributor">{t("opsSettings.tierContributor")}</option>
                </select>
              </div></div>
          </Group>
          <Section title={t("opsSettings.reasoning")} />
          <Group>
            <div className="row prefrow inline"><div className="grow"><span className="name">{t("opsSettings.effort")}</span><span className="sub">{t("opsSettings.effortSub")}</span></div>
              <div className="prefpicks">
                <select id="os-effort" className="curpick" aria-label={t("opsSettings.effort")} value={d.controls.reasoning_effort || ""} disabled={busy}
                  onChange={ev => send({ reasoning_effort: ev.target.value || null })}>
                  <option value="">{t("opsSettings.effortCode")}</option>
                  <option value="low">{t("opsSettings.low")}</option><option value="medium">{t("opsSettings.medium")}</option><option value="high">{t("opsSettings.high")}</option>
                </select>
              </div></div>
          </Group>
          <Section title={t("opsSettings.openModel")} />
          <Group>
            <OpenModel value={d.controls.open_model || ""} busy={busy} onSave={v => send({ open_model: v || null })} />
          </Group>
          <p className="muted small" style={{ margin: "10px 4px 30px" }}>{t("opsSettings.footer")}</p>
        </>
      )}
      {d && page === "limits" && (
        <>
          <p className="muted" style={{ margin: "0 0 6px" }}>{t("opsSettings.limitsIntro")}</p>
          <Section title={t("opsSettings.perAccount")} />
          <Group>{acctKeys.map(([k, s]) => <Num key={k} k={k} s={s} busy={busy} onSave={saveSetting} />)}</Group>
          <Section title={t("opsSettings.wholeApp")} />
          <Group>{of("app").map(([k, s]) => <Num key={k} k={k} s={s} busy={busy} onSave={saveSetting} />)}</Group>
          <Section title={t("opsSettings.overrides")} />
          <Group>
            {Object.entries(d.overrides).map(([u, vals]) => (
              <Row key={u} name={u}
                sub={Object.entries(vals).map(([k, v]) => `${d.settings[k]?.label || k} ${d.settings[k]?.kind === "usd" ? "$" : ""}${v}`).join(" · ")}
                right={<Chip disabled={busy} onClick={() => send({ overrides: { [u]: Object.fromEntries(Object.keys(vals).map(k => [k, null])) } })}>{t("opsSettings.remove")}</Chip>} />
            ))}
            <div className="pad" id="os-add">
              <input id="os-acct" className="curpick" style={{ width: "100%" }} placeholder={t("opsSettings.acctPlaceholder")} aria-label={t("opsSettings.acctPlaceholder")}
                value={acct} onChange={ev => setAcct(ev.target.value)} />
              <p style={{ display: "flex", gap: 10, margin: "10px 0 0" }}>
                <select id="os-okey" className="curpick" aria-label={t("opsSettings.whichLimit")} value={okey} onChange={ev => setOkey(ev.target.value)}>
                  {acctKeys.map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                </select>
                <input id="os-oval" className="curpick" style={{ width: 90, textAlign: "right" }} inputMode="decimal" placeholder="10" aria-label={t("opsSettings.value")}
                  value={oval} onChange={ev => setOval(ev.target.value)} />
              </p>
              <p style={{ margin: "10px 0 0" }}>
                <Button kind="primary" wide disabled={busy || !acct.trim() || oval.trim() === ""}
                  onClick={async () => { await send({ overrides: { [acct.trim()]: { [okey]: Number(oval) } } }); setOval(""); }}>{t("opsSettings.addOverride")}</Button>
              </p>
            </div>
          </Group>
          <p className="muted small" style={{ margin: "10px 4px 30px" }}>{t("opsSettings.limitsFooter")}</p>
        </>
      )}
      {acc && page === "accounts" && (
        <>
          <Section title={t("opsSettings.everyone")} />
          <Group>
            {acc.accounts.map(a => (
              <Row key={a.user} name={a.user}
                sub={[a.owner ? t("opsSettings.ownerTag") : "", a.frozen ? t("opsSettings.frozenTag") : "", a.disabled ? t("opsSettings.offTag") : "", `$${a.usd_24h.toFixed(2)} ${t("opsSettings.today")}`].filter(Boolean).join(" · ")}
                right={a.owner ? undefined : (
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    {a.frozen && <Chip disabled={busy} onClick={() => act("/api/usage/unfreeze", { user: a.user }, t("ops.unfrozen", { user: a.user }))}>{t("ops.unfreeze")}</Chip>}
                    <Chip disabled={busy} onClick={() => act("/api/ops/accounts", { user: a.user, disabled: !a.disabled })}>{a.disabled ? t("opsSettings.switchOn") : t("opsSettings.switchOff")}</Chip>
                  </span>)} />
            ))}
            <button className="navrow" id="os-waitlist" type="button" onClick={() => nav.show("waitlist")}>
              <span className="grow">{t("opsSettings.invites")}<span className="sub">{t("opsSettings.invitesSub")}</span></span><span className="chev">›</span></button>
          </Group>
          <Section title={t("opsSettings.ownerSection")} />
          <Group>
            <Row name={t("opsSettings.ownerName")} sub={acc.owner.username || t("opsSettings.ownerEnv")} />
            <div className="pad" id="os-owner">
              <p className="muted nomargin">{t("opsSettings.ownerNote")}</p>
              <select id="os-newowner" className="curpick" style={{ width: "100%", marginTop: 8 }} aria-label={t("opsSettings.newOwner")} value={newOwner} onChange={ev => setNewOwner(ev.target.value)}>
                <option value="">{t("opsSettings.newOwner")}</option>
                {acc.accounts.filter(a => !a.owner).map(a => <option key={a.user} value={a.user}>{a.user}</option>)}
              </select>
              <input id="os-ownerpw" type="password" className="curpick" style={{ width: "100%", marginTop: 8 }} placeholder={t("opsSettings.yourPassword")} aria-label={t("opsSettings.yourPassword")}
                value={pw} onChange={ev => setPw(ev.target.value)} />
              <p style={{ margin: "10px 0 0" }}>
                <Button kind="danger" wide disabled={busy || !newOwner}
                  onClick={async () => { await act("/api/ops/owner", { username: newOwner, password: pw, confirm: newOwner }, t("opsSettings.ownerChanged")); setPw(""); setNewOwner(""); }}>{t("opsSettings.changeOwner")}</Button>
              </p>
            </div>
          </Group>
        </>
      )}
      {page === "data" && mir && (
        <>
          <Section title={t("opsSettings.deleteTitle")} />
          <Group>
            <div className="pad" id="os-delete">
              <p className="muted nomargin">{t("opsSettings.deleteNote")}</p>
              <select id="os-deluser" className="curpick" style={{ width: "100%", marginTop: 8 }} aria-label={t("opsSettings.whichAccount")} value={delUser} onChange={ev => setDelUser(ev.target.value)}>
                <option value="">{t("opsSettings.whichAccount")}</option>
                {(acc?.accounts || []).map(a => <option key={a.user} value={a.user}>{a.user}</option>)}
              </select>
              <select id="os-delwhat" className="curpick" style={{ width: "100%", marginTop: 8 }} aria-label={t("opsSettings.whatDelete")} value={delWhat} onChange={ev => setDelWhat(ev.target.value)}>
                <option value="receipts">{t("opsSettings.delReceipts")}</option>
                <option value="names">{t("opsSettings.delNames")}</option>
              </select>
              <input id="os-delconfirm" className="curpick" style={{ width: "100%", marginTop: 8 }} placeholder={t("opsSettings.typeName")} aria-label={t("opsSettings.typeName")}
                value={delConfirm} onChange={ev => setDelConfirm(ev.target.value)} />
              <p style={{ margin: "10px 0 0" }}>
                <Button kind="danger" wide disabled={busy || !delUser || delConfirm.trim().toLowerCase() !== delUser.toLowerCase()}
                  onClick={async () => { await act("/api/ops/delete", { user: delUser, what: delWhat, confirm: delConfirm }, t("opsSettings.deleted")); setDelConfirm(""); }}>{t("opsSettings.deleteNow")}</Button>
              </p>
            </div>
          </Group>
          <Section title={t("opsSettings.mirrorTitle")} />
          <Group>
            <Row name={t("opsSettings.mirrorStore")} sub={mir.configured ? t("opsSettings.mirrorMode", { mode: mir.store }) : t("opsSettings.mirrorNone")} />
            <Row name={t("opsSettings.backfill")} sub={t("opsSettings.backfillSub")}
              right={<Chip disabled={busy || !mir.configured || mir.state === "running"} onClick={() => act("/api/ops/mirror", { kind: "backfill" })}>{t("opsSettings.run")}</Chip>} />
            <Row name={t("opsSettings.verify")} sub={t("opsSettings.verifySub")}
              right={<Chip disabled={busy || !mir.configured || mir.state === "running"} onClick={() => act("/api/ops/mirror", { kind: "verify" })}>{t("opsSettings.run")}</Chip>} />
            {(mir.state === "running" || mir.result) && (
              <Row name={mir.state === "running" ? t("opsSettings.running", { done: mir.done, total: mir.total }) : mir.result}
                sub={mir.state === "running" ? "" : t("opsSettings.lastRun", { kind: mir.kind })}
                right={mir.state === "running" ? undefined : <span className={"opschip " + (mir.ok ? "ok" : "bad")}>{mir.ok ? t("ops.ok") : t("ops.check")}</span>} />
            )}
          </Group>
        </>
      )}
      {d && page === "caps" && (
        <>
          <Group>{of("caps").map(([k, s]) => <Num key={k} k={k} s={s} busy={busy} onSave={saveSetting} />)}</Group>
          <p className="muted small" style={{ margin: "10px 4px 30px" }}>{t("opsSettings.capsFooter")}</p>
        </>
      )}
    </>
  );
}

function OpenModel({ value, busy, onSave }: { value: string; busy: boolean; onSave: (v: string) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <div className="row prefrow inline"><div className="grow"><span className="name">{t("opsSettings.openName")}</span><span className="sub">{t("opsSettings.openSub")}</span></div>
      <div className="prefpicks">
        <input id="os-open" className="curpick" aria-label={t("opsSettings.openName")} placeholder={t("opsSettings.openDefault")} value={v} disabled={busy}
          onChange={ev => setV(ev.target.value)} onBlur={() => { if (v.trim() !== value) onSave(v.trim()); }} />
      </div></div>
  );
}
