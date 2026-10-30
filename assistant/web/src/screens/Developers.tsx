import { useEffect } from "react";
import { useTranslation } from "../i18n";
import { useToast } from "../ui/Toast";

/* The public developer page at /developers (owner approved the mockup
 * 2026-10-30): what the open Lists API is, how to get a code, one curl
 * to try, and every endpoint. It needs no sign-in, so the app shows it
 * before it asks who you are. Text is docs/API.md in short form. */
export const DEV_PATH = "/developers";
export const isDevelopersPath = (path: string) => path.replace(/\/+$/, "") === DEV_PATH;

export const REFERENCE_URL = "https://github.com/vibhortayal/arya/blob/main/docs/API.md";
export const SCHEMA_PATH = "/api/v1/openapi.json";

type Row = readonly [verb: string, path: string, what: string];
/* Group titles and row texts are keys under developers.* in en.json. */
export const GROUPS: { title: string; rows: Row[] }[] = [
  { title: "gLists", rows: [
    ["GET", "/lists", "rLists"], ["GET", "/lists/{id}", "rList"], ["POST", "/lists/{id}/items", "rAdd"],
    ["PATCH", "/items/{id}", "rPatch"], ["DELETE", "/items/{id}", "rDelete"]] },
  { title: "gExport", rows: [
    ["GET", "/lists/{id}/export", "rExport"], ["POST", "/lists/import", "rImport"], ["GET", "/receipts/export", "rReceiptsExport"]] },
  { title: "gReceipts", rows: [
    ["GET", "/receipts", "rReceipts"], ["GET", "/receipts/{id}", "rReceipt"],
    ["GET", "/analysis/spending", "rSpending"], ["GET", "/analysis/purchases", "rPurchases"]] },
];

/* The try-it command uses the address the page was opened at. */
export const curlLine = (origin: string) =>
  `curl -H "Authorization: Bearer $TOKEN" \\\n  ${origin}/api/v1/lists`;

export function Developers() {
  const { t } = useTranslation();
  const { toast } = useToast();
  useEffect(() => {
    document.body.classList.add("dev");
    document.title = t("developers.title");
    return () => document.body.classList.remove("dev");
  }, [t]);
  const curl = curlLine(location.origin);
  const copy = async () => {
    try { await navigator.clipboard.writeText(curl); toast(t("developers.copied")); }
    catch { toast(t("developers.copyFailed")); }
  };
  return (
    <div className="devpage">
      <header className="devtop">
        <a className="devbrand" href="/">{t("developers.brand")}</a>
        <nav className="devlinks" aria-label={t("developers.linksLabel")}>
          <a className="devtext" href={REFERENCE_URL} rel="noopener">{t("developers.reference")}</a>
          <a className="devtext" href={SCHEMA_PATH}>{t("developers.schema")}</a>
          <a className="btn secondary" href="/">{t("developers.openApp")}</a>
        </nav>
      </header>
      <div className="devcols">
        <div className="devhero">
          <h1 className="herotitle">{t("developers.headline1")}<br />{t("developers.headline2")}</h1>
          <p className="herosub">{t("developers.sub")}</p>
          <a className="btn primary devcta" href="/">{t("developers.getCode")}</a>

          <h2 className="sect">{t("developers.step1")}</h2>
          <div className="group pad">
            <p className="nomargin">{t("developers.step1Body")}</p>
            <p className="muted" style={{ marginTop: 8 }}>{t("developers.sameCode")}</p>
          </div>

          <h2 className="sect">{t("developers.step2")}</h2>
          <div className="group pad">
            <pre className="devcode">{curl}</pre>
            <div className="devcopy">
              <span className="muted">{t("developers.answersJson")}</span>
              <button type="button" className="btn secondary" onClick={copy}>{t("developers.copy")}</button>
            </div>
          </div>

        </div>
        <div className="devright">
          {GROUPS.map(g => (
            <section key={g.title}>
              <h2 className="sect">{t("developers." + g.title)}</h2>
              <div className="group">
                {g.rows.map(([verb, path, what]) => (
                  <div className="devrow" key={verb + path}>
                    <span className="devverb">{verb}</span>
                    <span className="devpath">{path}</span>
                    <span className="devwhat">{t("developers." + what)}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <h2 className="sect">{t("developers.later")}</h2>
          <div className="group pad"><p className="muted nomargin">{t("developers.laterBody")}</p></div>
        </div>
        <div className="devgoodcol">
          <h2 className="sect">{t("developers.good")}</h2>
          <div className="group pad devgood">
            <p><b>{t("developers.ownTitle")}</b> {t("developers.ownBody")}</p>
            <p><b>{t("developers.limitsTitle")}</b> {t("developers.limitsBody")}</p>
            <p><b>{t("developers.errorsTitle")}</b> {t("developers.errorsBody")} <code>{'{"error":{"code","message"}}'}</code></p>
            <p><b>{t("developers.stableTitle")}</b> {t("developers.stableBody")}</p>
          </div>
        </div>
      </div>
      <footer className="devfoot">
        <a href={REFERENCE_URL} rel="noopener">{t("developers.reference")}</a>
        <a href={SCHEMA_PATH}>{t("developers.schema")}</a>
        <a href="/">{t("developers.backToApp")}</a>
      </footer>
    </div>
  );
}
