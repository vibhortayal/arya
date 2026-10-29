/* Ask Arya's reply language (assistant/docs/MULTILINGUAL-ASK.md).
 * The setting lives in /api/settings `language` ("auto" or a code);
 * /api/chat does not report a detected language, so the client
 * guesses from the text with a script and word check ($0, no model). */

export type Language = { code: string; name: string };
export const DEFAULT_LANGUAGES: Language[] = [
  { code: "auto", name: "Auto" }, { code: "en", name: "English" },
  { code: "es", name: "Español" }, { code: "hi", name: "हिन्दी" },
];

const SPANISH = new Set(("que qué el la los las de del y para por con tengo tenemos hay necesito nos " +
  "me mi mis falta faltan cuánto cuanto cuánta dónde donde cuándo cuando compra comprar lista se está " +
  "están acabando gasté gastamos mes semana leche huevos pan hoy agrega añade añadir pon quedan queda " +
  "tiene tienen es son un una unos unas al lo más mas muy también pero sí").split(" "));
/* Words that are also everyday English: they do not count alone. */
const SHARED = new Set(["me", "son", "es", "mas", "pan"]);

/** "hi" for Devanagari, "es" for Spanish, else "en". */
export function detectLanguage(text: string): "en" | "es" | "hi" {
  const t = (text || "").toLowerCase();
  if (/[ऀ-ॿ]/.test(t)) return "hi";
  if (/[¿¡ñ]/.test(t)) return "es";
  const words = t.match(/[a-záéíóúü]+/g) || [];
  const hits = words.filter(w => SPANISH.has(w) && !SHARED.has(w)).length;
  const accent = /[áéíóú]/.test(t);
  if (hits >= 2 || (accent && hits >= 1)) return "es";
  return "en";
}

const VOICE: Record<string, string> = { en: "en-US", es: "es-ES", hi: "hi-IN" };
/** The speechSynthesis lang for a reply: the fixed setting, or on
 * auto the language the reply text is in. */
export function voiceLang(setting: string, reply: string): string {
  return VOICE[setting] || VOICE[detectLanguage(reply)];
}

/** The language to offer after a message, or null. Only on auto,
 * only for a non-English message in a known language. */
export function offerFor(setting: string, message: string, languages: Language[]): Language | null {
  if (setting !== "auto") return null;
  const code = detectLanguage(message);
  if (code === "en") return null;
  return languages.find(l => l.code === code) || null;
}

const NO_KEY = "arya-lang-offer-no";
export function offerRefused(): boolean {
  try { return localStorage.getItem(NO_KEY) === "1"; } catch { return false; }
}
export function refuseOffer(): void {
  try { localStorage.setItem(NO_KEY, "1"); } catch { /* storage unavailable */ }
}

/** The toast after the setting changes. */
export function languageToast(code: string, languages: Language[]): string {
  if (code === "auto") return "Arya now answers in the language you use.";
  const name = languages.find(l => l.code === code)?.name || code;
  return `Arya now answers in ${name}.`;
}
