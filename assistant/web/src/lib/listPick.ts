import { ApiError, post } from "./api";
import { isOffline, savedRead } from "./offline";
import { pendingCount } from "./listQueue";

/* "Which list?" (owner, 2026-11-02; mockup
 * claude.ai/artifact/YTrF6swGujXdmr1ZxZUtXL). Every item lives on a
 * list. An add that names no list, when the household has two or more,
 * comes back 409 {code: "pick_list", lists, suggested, names}; with no
 * lists at all, {code: "no_lists", names}. The app asks once (the sheet
 * in ui/ListPick.tsx) and sends the add again with the list picked.
 *
 * Offline (or while older list changes wait on this phone) an add is
 * kept and sent later, so the server cannot ask then. The question is
 * asked first instead, from the lists last saved on this phone. */
export type ListRef = { id: string; name: string };
export type NeedList = { code: "pick_list" | "no_lists"; lists?: ListRef[]; suggested?: string | null; names?: string[]; message?: string };
export type Picked = ListRef | null;

export function needList(e: unknown): NeedList | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const d = e.detail as NeedList | undefined;
  return d && (d.code === "pick_list" || d.code === "no_lists") ? d : null;
}

type Asker = (need: NeedList) => Promise<Picked>;
let asker: Asker | null = null;
/* The sheet registers itself when the app shell mounts. */
export function setListAsker(a: Asker | null) { asker = a; }
export const askList = (need: NeedList): Promise<Picked> => asker ? asker(need) : Promise.resolve(null);

type Home = { list?: { items?: { item_id: string; on_list?: boolean; list?: string | null }[] }; lists?: ListRef[] };
/* The lists last saved on this phone: the Lists page's read, or the
 * Today read (its "home" part), which is there right after sign-in. */
const savedHome = (): Home | null => {
  const h = savedRead<Home>("/api/home")?.data;
  if (h?.lists) return h;
  return savedRead<{ home?: Home | null }>("/api/today")?.data?.home || h || null;
};

/* The list an add will go on without asking, from what this phone
 * knows: the item's own list, or the only list. undefined: ask. */
function knownList(home: Home | null, itemId?: string): string | null | undefined {
  const lists = home?.lists || [];
  const ids = new Set(lists.map(l => l.id));
  if (itemId) {
    const it = (home?.list?.items || []).find(i => i.item_id === itemId);
    if (it?.on_list && it.list && ids.has(it.list)) return null;      // stays where it is
  }
  if (lists.length === 1) return lists[0].id;
  return undefined;
}

/* Send an add; if it needs a list, ask which and send it again.
 * `send(listId)` makes the call (listId undefined: no list named).
 * Answers {result, list} or null when the person cancelled. */
export async function addOnList<T>(send: (listId?: string) => Promise<T>, opts: { names?: string[]; itemId?: string } = {}): Promise<{ result: T; list: Picked } | null> {
  if (isOffline() || pendingCount() > 0) {
    const home = savedHome();
    const k = knownList(home, opts.itemId);
    if (k === null) return { result: await send(), list: null };
    if (k) return { result: await send(k), list: home!.lists!.find(l => l.id === k) || null };
    const lists = home?.lists || [];
    const pick = await askList({ code: lists.length ? "pick_list" : "no_lists", lists, suggested: null, names: opts.names || [] });
    return pick ? { result: await send(pick.id), list: pick } : null;
  }
  try {
    return { result: await send(), list: null };
  } catch (e) {
    const need = needList(e);
    if (!need) throw e;
    const pick = await askList({ ...need, names: need.names?.length ? need.names : opts.names || [] });
    return pick ? { result: await send(pick.id), list: pick } : null;
  }
}

/* The common case: put one known item on the list (Running low's Add,
 * Used it then Add, an item page's Add to list). null: cancelled. */
export const addItem = (itemId: string, name: string, extra: Record<string, unknown> = {}) =>
  addOnList(lid => post("/api/list/add", { item_id: itemId, ...extra, ...(lid ? { list_id: lid } : {}) }), { names: [name], itemId });

/* Deleting a list that still has items (409 list_has_items): move them
 * to another list (the default) or take them off the shopping list. */
export type DeleteNeed = { code: "list_has_items"; count: number; lists: ListRef[]; message?: string };
export type DeleteChoice = { move_to: string } | { remove_items: true } | null;
export function deleteNeed(e: unknown): DeleteNeed | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const d = e.detail as DeleteNeed | undefined;
  return d && d.code === "list_has_items" ? d : null;
}
type DelAsker = (name: string, need: DeleteNeed) => Promise<DeleteChoice>;
let delAsker: DelAsker | null = null;
export function setDeleteAsker(a: DelAsker | null) { delAsker = a; }
export const askDelete = (name: string, need: DeleteNeed): Promise<DeleteChoice> => delAsker ? delAsker(name, need) : Promise.resolve(null);
