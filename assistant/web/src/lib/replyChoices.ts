export type Choice = { label: string; send: string };

/* Up to 6 well-formed choices, no repeats (the server sends at most 6). */
export function replyChoices(raw: unknown): Choice[] {
  if (!Array.isArray(raw)) return [];
  const out: Choice[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const label = String((c as Choice).label ?? "").trim(), send = String((c as Choice).send ?? "").trim();
    if (label && send && !out.some(o => o.send === send)) out.push({ label, send });
  }
  return out.slice(0, 6);
}
