import { useState } from "react";
import { useNav } from "../app/nav";
import { PlacesRows, usePlacesDrop } from "./StoresFind";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-stores-add: a Google pick is the only
 * way a store enters the directory. The Shell renders the section. */
export function StoresAdd() {
  const { t } = useTranslation();
  const nav = useNav();
  const [q, setQ] = useState("");
  const drop = usePlacesDrop(q);

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("common.addAStore")}</h2>
      <div className="group pad dropanchor">
        <label className="field">{t("storesAdd.searchGoogleForTheStore")}<input type="text" id="sa-q" placeholder="Costco" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <p className="muted nomargin" style={{ fontSize: 13 }}>{t("storesAdd.everyStoreCarriesItsReal")}</p>
        <div id="sa-results" className="gdrop" hidden={!drop.rows.length}>
          {drop.rows.length > 0 && <PlacesRows rows={drop.rows} pick={drop.pick} />}
        </div>
      </div>
      <p className="muted">{t("storesAdd.theStoreJoinsTheShared")}</p>
    </>
  );
}
