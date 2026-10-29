import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";

/* The app's strings. Every user-facing string lives in en.json, keyed
 * by screen (today.*, lists.*, hunt.*, settings.*, ...) with shared
 * words under common.*. Components call t("key") from useTranslation();
 * code outside a component (pure helpers) imports `t` from here.
 * English is the only language with resources, and the fallback, so
 * the app reads English whatever the setting says. Server text, user
 * data and store or item names are not keys: they show as they come.
 * Rule: no literal English in components (web/PORTING.md). */

export const resources = { en: { translation: en } } as const;

i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  // The resources are bundled, so init is synchronous: t() works at
  // import time and on the first render.
  initAsync: false,
  // React escapes text already.
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** The i18n language for the Settings "language" value ("auto" or a
 * code from /api/settings). Auto follows the browser. A language with
 * no resources falls back to English. */
export function i18nLanguage(setting: string | undefined | null, browser?: string): string {
  if (setting && setting !== "auto") return setting;
  const nav = browser ?? (typeof navigator !== "undefined" ? navigator.language : "");
  return (nav || "en").split("-")[0].toLowerCase() || "en";
}

/** Follow the Settings language (session.tsx calls this when it changes). */
export function applyLanguage(setting: string | undefined | null): void {
  const lng = i18nLanguage(setting);
  if (i18n.language !== lng) void i18n.changeLanguage(lng);
}

export const t = i18n.t.bind(i18n);
export { useTranslation, Trans } from "react-i18next";
export default i18n;
