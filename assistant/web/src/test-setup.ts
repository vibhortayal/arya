// Vitest setup (test only, never bundled into the app).
// jsdom has no CSS.escape, so a screen that calls it (ToCheck's editor
// focus) threw an unhandled error and vitest exited 1 with every test
// passing. This fills it in with the CSSOM spec's escape algorithm.
const g = globalThis as unknown as { CSS?: { escape?: (v: string) => string } };

function cssEscape(value: string): string {
  const s = String(value);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) { out += "�"; continue; }
    if ((c >= 0x1 && c <= 0x1f) || c === 0x7f ||
        (i === 0 && c >= 0x30 && c <= 0x39) ||
        (i === 1 && c >= 0x30 && c <= 0x39 && s.charCodeAt(0) === 0x2d)) {
      out += "\\" + c.toString(16) + " ";
      continue;
    }
    if (i === 0 && s.length === 1 && c === 0x2d) { out += "\\" + s[i]; continue; }
    if (c >= 0x80 || c === 0x2d || c === 0x5f || (c >= 0x30 && c <= 0x39) ||
        (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      out += s[i];
      continue;
    }
    out += "\\" + s[i];
  }
  return out;
}

if (!g.CSS) g.CSS = {};
if (typeof g.CSS.escape !== "function") g.CSS.escape = cssEscape;

export { cssEscape };
