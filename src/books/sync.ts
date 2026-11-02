/**
 * The user's library on every device, including books imported from Goodreads.
 * Each device keeps its whole library and swaps changes with the user's Worker (POST /app/books), with the Talk session as
 * the bearer, natively, so no Origin goes and no redirect is followed (as the TV's shelf does, books/shelf.ts).
 *
 * Every book carries `updated`, the time it last changed on any device; a change made here is stamped later than the
 * copy it changed, so it wins over that copy. The Worker keeps the newest of each book and a note of each removal, and
 * hands every device what changed since its cursor. What this device changed and the Worker has not taken yet is
 * kept in the sync state (dirty books, removals, the goal), saved beside the library, so nothing is lost to a closed
 * app or a dead network. A cover file stays on the phone that saved it: books travel without it, and each device saves
 * its own copy of an Open Library cover (a cover the user photographed stays where the user took it).
 *
 * A device's first sync only listens until it has everything, so a book it added before (the same ISBN, or the same
 * title and author) is folded into the copy the other devices already have instead of being sent as a second one.
 *
 * Pure apart from postBooks, which never throws.
 */
import { CapacitorHttp, type HttpOptions, type HttpResponse } from "@capacitor/core";
import { cleanShown } from "../talk/text.ts";
import { retryAfterOf } from "../sync/records.ts";
import { toIsbn13 } from "./isbn.ts";
import { GOAL_MAX, readBook, sameBook, titleKey, type Book, type Library } from "./library.ts";

/** The ids the Worker takes; every id this app makes fits (a UUID, or a time and a random tail). */
export const SYNC_ID = /^[A-Za-z0-9-]{1,64}$/;
/** The Worker's limits (src there): books and removals per request, and one book's size. */
export const PER_REQUEST = 2000;
export const BOOK_BYTES_MAX = 64 * 1024;
/** Half the Worker's 8 MiB body limit, so a request of big books still goes. */
export const REQUEST_BYTES_MAX = 4 * 1024 * 1024;
export const SYNC_DEADLINE_MS = 45000;
const ERROR_MAX = 300;

export interface Removed { id: string; at: number }

export interface SyncState {
  v: 1;
  /** The Worker this is for: another address starts afresh. */
  worker: string;
  /** How far this device has heard from the Worker; 0 before its first answer. */
  cursor: number;
  /** Books changed here that the Worker has not taken yet. */
  dirty: string[];
  /** Books removed here that the Worker has not taken yet. */
  removed: Removed[];
  /** When the year's goal last changed (0: never), and whether the Worker still needs it. */
  goalAt: number;
  goalDirty: boolean;
  /** This device has heard everything once, so it may send: a first sync cut off half way listens again next time. */
  listened: boolean;
}

export type BookSyncState =
  | { state: "idle" }
  | { state: "syncing" }
  | { state: "synced"; at: Date }
  | { state: "signin" }
  | { state: "missing" }
  | { state: "moved" }
  | { state: "offline" }
  | { state: "refused"; error: string }
  | { state: "busy"; until: Date };

export interface Wire {
  cursor: number;
  books: Book[];
  removed: Removed[];
  goal: { value: number; updated: number } | null;
}

export interface Reply {
  cursor: number;
  more: boolean;
  books: unknown[];
  removed: Removed[];
  goal: { value: number; updated: number } | null;
}

export type Sent = { ok: true; reply: Reply } | { ok: false; why: "signin" | "missing" | "moved" | "offline" } |
  { ok: false; why: "refused"; error: string } | { ok: false; why: "busy"; retryAfter: number };

export type Post = (options: HttpOptions) => Promise<HttpResponse>;
const nativePost: Post = (options) => CapacitorHttp.post(options);

const time = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;

export function emptySync(worker = ""): SyncState {
  return { v: 1, worker, cursor: 0, dirty: [], removed: [], goalAt: 0, goalDirty: false, listened: false };
}

/** The saved state, checked; anything odd starts afresh, which only means sending everything once more. */
export function checkSync(json: string | null): SyncState {
  if (json === null) return emptySync();
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    if (typeof v !== "object" || v === null || v.v !== 1 || typeof v.worker !== "string" || v.worker.length > 500 ||
      !(v.cursor === 0 || time(v.cursor)) || !Array.isArray(v.dirty) || !Array.isArray(v.removed)) return emptySync();
    const dirty = v.dirty.filter((id): id is string => typeof id === "string" && SYNC_ID.test(id));
    const removed = (v.removed as unknown[]).flatMap((r) => {
      const e = r as Record<string, unknown>;
      return typeof e?.id === "string" && SYNC_ID.test(e.id) && time(e.at) ? [{ id: e.id, at: e.at }] : [];
    });
    return { v: 1, worker: v.worker, cursor: v.cursor as number, dirty: [...new Set(dirty)], removed,
      goalAt: v.goalAt === 0 || time(v.goalAt) ? v.goalAt as number : 0, goalDirty: v.goalDirty === true,
      listened: v.listened === true };
  } catch {
    return emptySync();
  }
}

/** The book with its photo and stamp left out: what is compared to tell a real change from a cover saved here. */
const content = (b: Book): string => JSON.stringify({ ...b, photo: null, updated: 0 });

/**
 * A change made on this device, stamped: each book that changed (beyond its cover file) gets a time later than both
 * now and its own last stamp, and is marked for the Worker; each book gone is noted as removed; a new goal is marked.
 */
export function stampChanges(prev: Library, next: Library, now: number, sync: SyncState): { library: Library; sync: SyncState } {
  const before = new Map(prev.books.map((b) => [b.id, b]));
  const dirty = new Set(sync.dirty);
  let stamped = false;
  const books = next.books.map((book) => {
    const old = before.get(book.id);
    if (old === book || (old && content(old) === content(book))) return book;
    stamped = true;
    dirty.add(book.id);
    return { ...book, updated: Math.max(now, (old?.updated ?? 0) + 1, book.updated) };
  });
  const kept = new Set(next.books.map((b) => b.id));
  const gone = prev.books.filter((b) => !kept.has(b.id));
  gone.forEach((b) => dirty.delete(b.id));
  const removed = [...sync.removed.filter((r) => !gone.some((b) => b.id === r.id)),
    ...gone.filter((b) => SYNC_ID.test(b.id)).map((b) => ({ id: b.id, at: Math.max(now, b.updated + 1) }))];
  const goalMoved = prev.goal !== next.goal;
  if (!stamped && gone.length === 0 && !goalMoved) return { library: next, sync };
  return {
    library: stamped ? { ...next, books } : next,
    sync: { ...sync, dirty: [...dirty], removed, ...(goalMoved ? { goalAt: Math.max(now, sync.goalAt + 1), goalDirty: true } : {}) },
  };
}

/**
 * The first sync with a Worker: every book here is marked for it (one never stamped is stamped now), and the goal
 * too when one is set. Removals made before any sync never reached a Worker, so none are kept.
 */
export function startFresh(library: Library, worker: string, now: number): { library: Library; sync: SyncState } {
  const books = library.books.map((b) => (b.updated > 0 ? b : { ...b, updated: now }));
  return {
    library: books.some((b, i) => b !== library.books[i]) ? { ...library, books } : library,
    sync: { ...emptySync(worker), dirty: books.filter((b) => SYNC_ID.test(b.id)).map((b) => b.id),
      goalAt: library.goal ? now : 0, goalDirty: library.goal > 0 },
  };
}

const bytes = (b: Book): number => new TextEncoder().encode(JSON.stringify(b)).length;

/**
 * What the next request sends: up to PER_REQUEST of the books marked, without their cover file, and the removals and
 * the goal not yet taken. `listen` sends nothing (a first sync hearing everything first). A book too big for the Worker
 * is left out and named in `tooBig`, so it is not tried again and again.
 */
export function outgoing(library: Library, sync: SyncState, listen = false): { wire: Wire; tooBig: string[] } {
  if (listen) return { wire: { cursor: sync.cursor, books: [], removed: [], goal: null }, tooBig: [] };
  const marked = new Set(sync.dirty);
  const tooBig: string[] = [];
  const books: Book[] = [];
  let size = 0;
  for (const book of library.books) {
    if (books.length >= PER_REQUEST) break;
    if (!marked.has(book.id) || !SYNC_ID.test(book.id) || !time(book.updated)) continue;
    const plain = { ...book, photo: null };
    const weight = bytes(plain);
    if (weight > BOOK_BYTES_MAX) tooBig.push(book.id);
    else if (size + weight > REQUEST_BYTES_MAX) break;
    else {
      books.push(plain);
      size += weight;
    }
  }
  const goal = sync.goalDirty ? { value: Math.min(GOAL_MAX, Math.max(0, library.goal)), updated: Math.max(1, sync.goalAt) } : null;
  return { wire: { cursor: sync.cursor, books, removed: sync.removed.slice(0, PER_REQUEST), goal }, tooBig };
}

/** Progress and lessons from two copies of one book, each entry once (by its id), in date order. */
function union<T extends { id: string; date: string }>(a: readonly T[], b: readonly T[]): T[] {
  const seen = new Set(a.map((e) => e.id));
  return [...a, ...b.filter((e) => !seen.has(e.id))].sort((x, y) => x.date.localeCompare(y.date));
}

export interface Applied {
  library: Library;
  sync: SyncState;
  /** Cover files no book here shows any more, to delete once the library is saved. */
  freed: string[];
  /** Books that arrived from another device. */
  arrived: number;
}

/**
 * The Worker's answer to `wire`, taken in: first what it took (marks cleared for books not changed again since), then
 * what other devices changed (a book marked here and newer than theirs stays as it is here), then its cursor.
 * `first` folds a book added here before any sync into the same book arriving from another device.
 */
export function applyReply(library: Library, sync: SyncState, wire: Wire, reply: Reply, now: number, first = false): Applied {
  const sentAt = new Map(wire.books.map((b) => [b.id, b.updated]));
  // A working copy, changed in place here only, and where each book sits in it.
  const books = [...library.books];
  const pos = new Map(books.map((b, i) => [b.id, i]));
  const dirty = new Set(sync.dirty.filter((id) => {
    const i = pos.get(id);
    return !(i !== undefined && sentAt.get(id) === books[i].updated);
  }));
  const removed = sync.removed.filter((r) => !wire.removed.some((w) => w.id === r.id && w.at === r.at));
  const removedAt = new Map(removed.map((r) => [r.id, r.at]));
  const twinOf = first ? twinFinder(books, (b) => dirty.has(b.id) && !sentAt.has(b.id)) : () => undefined;
  const freed: string[] = [];
  let arrived = 0;
  for (const raw of reply.books) {
    const theirs = readBook(raw);
    if (!theirs || !SYNC_ID.test(theirs.id) || !time(theirs.updated)) continue;
    // Removed here while this exchange was on its way: the removal goes next, and wins.
    if ((removedAt.get(theirs.id) ?? 0) >= theirs.updated) continue;
    const i = pos.get(theirs.id);
    if (i !== undefined) {
      const mine = books[i];
      if (dirty.has(mine.id) && mine.updated > theirs.updated) continue;
      const keep = mine.photo && (ownPhoto(mine.photo) || theirs.coverId === null || theirs.coverId === mine.coverId)
        ? mine.photo : null;
      if (mine.photo && !keep) freed.push(mine.photo);
      books[i] = { ...theirs, photo: keep };
      dirty.delete(mine.id);
      continue;
    }
    const twin = twinOf(theirs);
    if (twin) {
      const at = pos.get(twin.id)!;
      const merged: Book = { ...theirs, photo: twin.photo, progress: union(theirs.progress, twin.progress),
        lessons: union(theirs.lessons, twin.lessons), commentary: theirs.commentary || twin.commentary };
      const grew = content(merged) !== content({ ...theirs, photo: twin.photo });
      books[at] = grew ? { ...merged, updated: Math.max(now, theirs.updated + 1) } : merged;
      pos.delete(twin.id);
      pos.set(merged.id, at);
      dirty.delete(twin.id);
      if (grew) dirty.add(merged.id);
      continue;
    }
    pos.set(theirs.id, books.length);
    books.push({ ...theirs, photo: null });
    arrived += 1;
  }
  const gone = new Set<string>();
  for (const r of reply.removed) {
    const i = pos.get(r.id);
    if (i === undefined) continue;
    const mine = books[i];
    if (dirty.has(mine.id) && mine.updated > r.at) continue;
    gone.add(mine.id);
    dirty.delete(mine.id);
    if (mine.photo) freed.push(mine.photo);
  }
  const kept = gone.size ? books.filter((b) => !gone.has(b.id)) : books;
  let goal = library.goal;
  let { goalAt, goalDirty } = sync;
  if (wire.goal && goalAt === wire.goal.updated) goalDirty = false;
  if (reply.goal && reply.goal.updated > goalAt) {
    goal = reply.goal.value;
    goalAt = reply.goal.updated;
    goalDirty = false;
  }
  const changed = kept.length !== library.books.length || kept.some((b, i) => b !== library.books[i]) ||
    goal !== library.goal;
  const inUse = new Set(kept.flatMap((b) => (b.photo ? [b.photo] : [])));
  return {
    library: changed ? { ...library, books: kept, goal } : library,
    sync: { ...sync, cursor: reply.cursor, dirty: [...dirty], removed, goalAt, goalDirty,
      listened: sync.listened || (first && !reply.more) },
    freed: [...new Set(freed)].filter((name) => !inUse.has(name)),
    arrived,
  };
}

/** A cover the user photographed personally, not one saved from Open Library ("covers/ol-<id>.jpg"): a sync never lets it go. */
const ownPhoto = (name: string): boolean => !name.startsWith("covers/ol-");

function add<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Finds, for a book arriving on a first sync, the copy of it added here and never sent (the same ISBN when both have
 * one, else the same title and first author), each copy at most once. Keyed once, so a big library is no slower to
 * fold than to read.
 */
function twinFinder(books: readonly Book[], candidate: (b: Book) => boolean): (theirs: Book) => Book | undefined {
  const byIsbn = new Map<string, Book[]>();
  const byTitle = new Map<string, Book[]>();
  for (const b of books) {
    if (!candidate(b)) continue;
    if (b.isbn) add(byIsbn, toIsbn13(b.isbn), b);
    add(byTitle, titleKey(b), b);
  }
  const used = new Set<string>();
  return (theirs) => {
    const pool = [...(theirs.isbn ? byIsbn.get(toIsbn13(theirs.isbn)) ?? [] : []), ...(byTitle.get(titleKey(theirs)) ?? [])];
    const twin = pool.find((b) => !used.has(b.id) && sameBook(b, theirs));
    if (twin) used.add(twin.id);
    return twin;
  };
}

/** The Worker's answer, checked; null when it is not one. Books are checked one by one when taken in (readBook). */
export function readReply(body: unknown): Reply | null {
  const v = body as Record<string, unknown> | null;
  // The Worker sends at most PER_REQUEST rows a reply: more is no answer from it.
  if (!v || v.ok !== true || !(v.cursor === 0 || time(v.cursor)) || typeof v.more !== "boolean" ||
    !Array.isArray(v.books) || !Array.isArray(v.removed) || v.books.length + v.removed.length > PER_REQUEST) return null;
  const removed = (v.removed as unknown[]).flatMap((r) => {
    const e = r as Record<string, unknown>;
    return typeof e?.id === "string" && SYNC_ID.test(e.id) && time(e.at) ? [{ id: e.id, at: e.at }] : [];
  });
  const g = v.goal as Record<string, unknown> | null | undefined;
  const goal = g && typeof g.value === "number" && Number.isInteger(g.value) && g.value >= 0 && g.value <= GOAL_MAX &&
    time(g.updated) ? { value: g.value, updated: g.updated } : null;
  return { cursor: v.cursor as number, more: v.more, books: v.books as unknown[], removed, goal };
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** One exchange with the Worker; says why when it did not work. Never throws. */
export async function postBooks(worker: string, session: string, wire: Wire, send: Post = nativePost,
  deadline = SYNC_DEADLINE_MS): Promise<Sent> {
  let response: HttpResponse | null;
  try {
    response = await withDeadline(send({
      url: `${worker}/app/books`, data: wire, responseType: "json", disableRedirects: true,
      connectTimeout: 15000, readTimeout: 40000,
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${session}` },
    }), deadline);
  } catch {
    response = null;
  }
  if (response === null) return { ok: false, why: "offline" };
  const body = response.data !== null && typeof response.data === "object" ? response.data as Record<string, unknown> : null;
  if (response.status === 200) {
    const reply = readReply(body);
    return reply ? { ok: true, reply } : { ok: false, why: "refused", error: "The Worker's answer was not one the app knows." };
  }
  if (response.status === 401) return { ok: false, why: "signin" };
  // Not found: a Worker from before books were synced. Sent elsewhere: the address in Settings is not the Worker.
  if (response.status === 404) return { ok: false, why: "missing" };
  if (response.status === 429) return { ok: false, why: "busy", retryAfter: retryAfterOf(response.headers) };
  if (response.status >= 300 && response.status < 400) return { ok: false, why: "moved" };
  const own = response.status >= 400 ? cleanShown(body?.error, ERROR_MAX) : "";
  return { ok: false, why: "refused", error: own || "The Worker did not take the books." };
}

/** Books' line about syncing, or "" when there is nothing to say. */
export function syncMessage(sync: BookSyncState, timeZone?: string): string {
  switch (sync.state) {
    case "synced":
      return `In step with your other devices, ${sync.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit",
        hour12: false, timeZone })}.`;
    case "syncing": return "Syncing your books with your other devices.";
    case "signin": return "Sign in to Talk in Settings to keep your books the same on every device.";
    case "missing": return "Your Worker does not sync books yet. It needs its latest update.";
    case "moved": return "The Worker address in Settings is not right, so books cannot sync.";
    case "offline": return "Books could not sync just now. They sync when you are back online.";
    case "refused": return `Books did not sync: ${sync.error}`;
    case "busy": return `Syncing paused after many syncs this hour; it picks up after ${sync.until.toLocaleTimeString("en-GB",
      { hour: "2-digit", minute: "2-digit", hour12: false, timeZone })}.`;
    default: return "";
  }
}
