import { DEFAULT_LANGUAGES, detectLanguage, languageToast, offerFor, voiceLang } from "./language";

test("detects Hindi, Spanish and English", () => {
  expect(detectLanguage("दूध खत्म हो गया")).toBe("hi");
  expect(detectLanguage("¿Qué nos falta para la semana?")).toBe("es");
  expect(detectLanguage("Se acabó la leche")).toBe("es");
  expect(detectLanguage("cuanto gastamos en el mes")).toBe("es");
  expect(detectLanguage("What's running low?")).toBe("en");
  expect(detectLanguage("Add café latte to my list")).toBe("en");
  expect(detectLanguage("")).toBe("en");
});

test("offers only on auto, for a non-English message", () => {
  expect(offerFor("auto", "¿Qué nos falta?", DEFAULT_LANGUAGES)?.name).toBe("Español");
  expect(offerFor("auto", "दूध खत्म", DEFAULT_LANGUAGES)?.code).toBe("hi");
  expect(offerFor("auto", "What's running low?", DEFAULT_LANGUAGES)).toBeNull();
  expect(offerFor("es", "¿Qué nos falta?", DEFAULT_LANGUAGES)).toBeNull();
  expect(offerFor("en", "दूध खत्म", DEFAULT_LANGUAGES)).toBeNull();
});

test("voice follows the setting, or the reply on auto", () => {
  expect(voiceLang("es", "Milk is low")).toBe("es-ES");
  expect(voiceLang("hi", "x")).toBe("hi-IN");
  expect(voiceLang("en", "¿Qué?")).toBe("en-US");
  expect(voiceLang("auto", "Te falta leche y pan.")).toBe("es-ES");
  expect(voiceLang("auto", "दूध खत्म हो गया")).toBe("hi-IN");
  expect(voiceLang("auto", "Milk is low.")).toBe("en-US");
});

test("toast text", () => {
  expect(languageToast("es", DEFAULT_LANGUAGES)).toBe("Arya now answers in Español.");
  expect(languageToast("auto", DEFAULT_LANGUAGES)).toBe("Arya now answers in the language you use.");
});
