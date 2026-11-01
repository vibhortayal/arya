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
type Page = "models" | "limits" | "caps";

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

  const load = useCallback(() => { get<OpsData>("/api/ops").then(setD, () => toast(t("ops.couldNotLoad"))); }, [t, toast]);
  useEffect(() => { load(); }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { await post("/api/ops/controls", body); load(); }
    catch (e) { toast(e instanceof Error && e.message ? e.message : t("ops.couldNotSave")); load(); }
    setBusy(false);
  };
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
