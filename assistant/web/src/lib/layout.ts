/* Edit mode on other screens (card library, 2026-10-30): a screen's
 * items in the person's order, minus the ones they hid. Items the
 * saved order does not know (a new list) keep their place at the end,
 * in their own order. */
export function arrange(ids: string[], order?: string[] | null, hidden?: string[] | null): { shown: string[]; hidden: string[] } {
  const hide = new Set(hidden || []);
  const pos = new Map((order || []).map((id, k) => [id, k]));
  const known = ids.filter(id => pos.has(id)).sort((a, b) => pos.get(a)! - pos.get(b)!);
  const rest = ids.filter(id => !pos.has(id));
  return { shown: [...known, ...rest].filter(id => !hide.has(id)), hidden: ids.filter(id => hide.has(id)) };
}
