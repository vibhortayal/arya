import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/* The on-screen "Reading the receipt…" block from Receipts (approved
   2026-11-02 mockup), shared by the after-trip screens. A read can run
   past a minute (a 77-second read looked failed on 2026-11-04), so after
   45 seconds the sub line says Arya is still reading. */
export const SLOW_AFTER_S = 45;

export function ReadingBlock({ id, demo }: { id: string; demo?: boolean }) {
  const { t } = useTranslation();
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(h);
  }, []);
  const slow = secs >= SLOW_AFTER_S;
  return (
    <div id={id} role="status" aria-live="polite">
      <p className="nomargin rcread-head"><strong>{t("receiptRead.readingOne")}</strong></p>
      <div className="pbar ind" role="progressbar" aria-valuemin={0} aria-valuemax={1}><i /></div>
      <p className="muted small nomargin">{slow ? t("receiptRead.stillReading") : t("receiptRead.readingOneSub")} {t("receiptRead.stay")}</p>
      {demo && <p className="rcread-demo">{t("receiptRead.demoNote")}</p>}
    </div>
  );
}
