/**
 * Records shared across devices:
 * the prayer marks, the Quran log, the adhkar, the Friday routine, the mushaf's marks and notes, the muraja'ah plan and
 * Learn. Books keep their own route (books/sync.ts); everything else travels as records through POST /app/records.
 *
 * A collection turns one saved value (one store key) into records, each a kind and an id with its data (a prayer day,
 * a Quran reading, a lesson), and back. The sync state keeps, per record, the stamp it last had and a hash of its data:
 * a save is compared record by record, so a change is stamped (later than both now and the stamp it changed) and
 * marked for the Worker, and a record gone is noted as removed. What the Worker sends is merged record by record: the
 * newer stamp wins, except where a record changed here too and its collection can join the two (a prayer day keeps
 * the marks of both, adhkar keep the higher count). A device's first sync only listens until it has heard everything,
 * and its own copy of a record the others already have gives way to theirs (or is joined with it).
 *
 * Pure apart from postRecords, which never throws.
 */
import { CapacitorHttp, type HttpOptions, type HttpResponse } from "@capacitor/core";
import { cleanShown } from "../talk/text.ts";

export const RECORD_ID = /^[A-Za-z0-9-]{1,64}$/;
export const RECORD_KIND = /^[a-z][a-z0-9]{0,15}(\.[a-z][a-z0-9]{0,15})?$/;
/** The Worker's limits (src/records.ts there). */
export const PER_REQUEST = 2000;
export const RECORD_BYTES_MAX = 64 * 1024;
export const REQUEST_BYTES_MAX = 4 * 1024 * 1024;
export const SYNC_DEADLINE_MS = 45000;
const ERROR_MAX = 300;

export type Data = Record<string, unknown>;
export interface Rec { kind: string; id: string; data: Data }
export interface Stamped extends Rec { updated: number }
export interface Removed { kind: string; id: string; at: number }

/** One saved value seen as records. */
export interface Collection<T = unknown> {
  /** The store key it is saved under. */
  key: string;
  /** The kinds of record it owns. */
  kinds: readonly string[];
  toRecords(value: T): Rec[];
  /** The value made again from all its records; `current` gives what stays on this device (a theme, a last page). */
  fromRecords(records: readonly Rec[], current: T): T;
  /** Joins two versions of one record changed on two devices; omitted, the newer one wins. */
  merge?(kind: string, mine: Data, theirs: Data): Data;
}

export interface RecordsSync {
  v: 1;
  /** The Worker this is for: another address starts afresh. */
  worker: string;
  /**
   * The kinds this app version syncs, as one string. A version that syncs more kinds asks the Worker for everything
   * once more, so records of a new kind that arrived before the update (and were passed over) are taken in.
   */
  kinds: string;
  cursor: number;
  /** This device has heard everything once, so it may send. */
  listened: boolean;
  /** By "kind/id": the stamp the record last had and a hash of its data. */
  known: Record<string, { u: number; h: string }>;
  /** Records changed here that the Worker has not taken yet. */
  dirty: string[];
  /** Records removed here that the Worker has not taken yet. */
  removed: Removed[];
}

export type RecordsNote =
  | { state: "idle" } | { state: "syncing" } | { state: "synced"; at: Date } | { state: "signin" }
  | { state: "missing" } | { state: "moved" } | { state: "offline" } | { state: "refused"; error: string }
  | { state: "busy"; until: Date } | { state: "partial" };

/** One line on how the user's records' sync stands, or "" when there is nothing to say. */
export function recordsMessage(note: RecordsNote, timeZone?: string): string {
  const at = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  switch (note.state) {
    case "synced": return `Your records are in step with your other devices, ${at(note.at)}.`;
    case "syncing": return "Syncing your records with your other devices.";
    case "signin": return "Sign in to Talk in Settings to keep your records the same on every device.";
    case "missing": return "Your Worker does not sync these records yet. It needs its latest update.";
    case "moved": return "The Worker address in Settings is not right, so records cannot sync.";
    case "offline": return "Records could not sync just now. They sync when you are back online.";
    case "busy": return `Syncing paused after many syncs this hour; it picks up after ${at(note.until)}.`;
    case "partial": return "Most of your records are in step; the rest follow with the next sync.";
    case "refused": return `Records did not sync: ${note.error}`;
    default: return "";
  }
}

export interface Wire { cursor: number; records: Stamped[]; removed: Removed[] }
export interface Reply { cursor: number; more: boolean; records: Stamped[]; removed: Removed[] }
export type Sent = { ok: true; reply: Reply } | { ok: false; why: "signin" | "missing" | "moved" | "offline" } |
  { ok: false; why: "refused"; error: string } | { ok: false; why: "busy"; retryAfter: number };

/** Seconds the Worker asks to wait after too many syncs (its Retry-After), kept between a minute and an hour. */
export function retryAfterOf(headers: Record<string, string> | undefined): number {
  const raw = headers ? Object.entries(headers).find(([name]) => name.toLowerCase() === "retry-after")?.[1] : undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.min(3600, Math.max(60, Math.round(seconds))) : 600;
}
export type Post = (options: HttpOptions) => Promise<HttpResponse>;
const nativePost: Post = (options) => CapacitorHttp.post(options);

const time = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const plainObject = (v: unknown): v is Data => typeof v === "object" && v !== null && !Array.isArray(v);
export const keyOf = (kind: string, id: string): string => `${kind}/${id}`;
const split = (key: string): { kind: string; id: string } => {
  const at = key.indexOf("/");
  return { kind: key.slice(0, at), id: key.slice(at + 1) };
};

export function emptyRecordsSync(worker = ""): RecordsSync {
  return { v: 1, worker, kinds: "", cursor: 0, listened: false, known: {}, dirty: [], removed: [] };
}

/** The kinds a set of collections syncs, as RecordsSync keeps them. */
export const kindsOf = (collections: readonly Collection[]): string =>
  collections.flatMap((c) => c.kinds).sort().join(",");

/** The saved state, checked; anything odd starts afresh, which only means sending everything once more. */
export function checkRecordsSync(json: string | null): RecordsSync {
  if (json === null) return emptyRecordsSync();
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    if (!plainObject(v) || v.v !== 1 || typeof v.worker !== "string" || v.worker.length > 500 ||
      !(v.cursor === 0 || time(v.cursor)) || !plainObject(v.known) || !Array.isArray(v.dirty) ||
      !Array.isArray(v.removed)) return emptyRecordsSync();
    const known: RecordsSync["known"] = {};
    for (const [key, entry] of Object.entries(v.known)) {
      const e = entry as Record<string, unknown>;
      const { kind, id } = split(key);
      if (RECORD_KIND.test(kind) && RECORD_ID.test(id) && plainObject(e) && time(e.u) && typeof e.h === "string" &&
        e.h.length <= 32) known[key] = { u: e.u, h: e.h };
    }
    const dirty = (v.dirty as unknown[]).filter((k): k is string => typeof k === "string" && k in known);
    const removed = (v.removed as unknown[]).flatMap((r) => {
      const e = r as Record<string, unknown>;
      return plainObject(e) && typeof e.kind === "string" && RECORD_KIND.test(e.kind) && typeof e.id === "string" &&
        RECORD_ID.test(e.id) && time(e.at) ? [{ kind: e.kind, id: e.id, at: e.at }] : [];
    });
    return { v: 1, worker: v.worker, kinds: typeof v.kinds === "string" ? v.kinds.slice(0, 2000) : "",
      cursor: v.cursor as number, listened: v.listened === true, known, dirty: [...new Set(dirty)], removed };
  } catch {
    return emptyRecordsSync();
  }
}

/** JSON with every object's keys sorted, so the same data always reads the same, whichever device built it. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A short hash of the canonical text (FNV-1a, two lanes): enough to tell a changed record from an unchanged one. */
export function hashOf(data: Data): string {
  const text = canonical(data);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

const owns = (collection: Collection, key: string): boolean => collection.kinds.includes(split(key).kind);

/** Only records the Worker takes: a fitting kind and id, and data no bigger than it allows. */
function sendable(rec: Rec): boolean {
  return RECORD_KIND.test(rec.kind) && RECORD_ID.test(rec.id) && plainObject(rec.data) &&
    new TextEncoder().encode(JSON.stringify(rec.data)).length <= RECORD_BYTES_MAX;
}

/** The value's records by key, each once. */
export function recordsOf<T>(collection: Collection<T>, value: T): Map<string, Rec> {
  const map = new Map<string, Rec>();
  for (const rec of collection.toRecords(value)) {
    if (collection.kinds.includes(rec.kind) && sendable(rec)) map.set(keyOf(rec.kind, rec.id), rec);
  }
  return map;
}

/**
 * A value saved here, compared with what the sync state knows of its collection: each record new or changed is
 * stamped and marked, each one gone is noted as removed. `now` 0 stamps just after the record's last stamp.
 */
export function stampSaved<T>(collection: Collection<T>, value: T, sync: RecordsSync, now: number): RecordsSync {
  const current = recordsOf(collection, value);
  const known = { ...sync.known };
  const dirty = new Set(sync.dirty);
  let removed = sync.removed;
  let changed = false;
  for (const [key, rec] of current) {
    const h = hashOf(rec.data);
    const old = known[key];
    if (old && old.h === h) continue;
    known[key] = { u: Math.max(now, (old?.u ?? 0) + 1), h };
    dirty.add(key);
    removed = removed.filter((r) => keyOf(r.kind, r.id) !== key);
    changed = true;
  }
  for (const key of Object.keys(known)) {
    if (!owns(collection as Collection, key) || current.has(key)) continue;
    const { kind, id } = split(key);
    removed = [...removed.filter((r) => keyOf(r.kind, r.id) !== key), { kind, id, at: Math.max(now, known[key].u + 1) }];
    delete known[key];
    dirty.delete(key);
    changed = true;
  }
  return changed ? { ...sync, known, dirty: [...dirty], removed } : sync;
}

/** A first sync with a Worker: every record here is marked for it, stamped now. */
export function startFresh(values: ReadonlyArray<[Collection, unknown]>, worker: string, now: number): RecordsSync {
  let sync = emptyRecordsSync(worker);
  for (const [collection, value] of values) sync = stampSaved(collection, value, sync, now);
  return sync;
}

/** What the next request sends: up to PER_REQUEST marked records (about 4 MB) and the removals; nothing while listening. */
export function outgoing(values: ReadonlyArray<[Collection, unknown]>, sync: RecordsSync, listen = false): Wire {
  if (listen) return { cursor: sync.cursor, records: [], removed: [] };
  const marked = new Set(sync.dirty);
  const records: Stamped[] = [];
  let size = 0;
  outer: for (const [collection, value] of values) {
    for (const [key, rec] of recordsOf(collection, value)) {
      if (!marked.has(key) || !sync.known[key]) continue;
      if (records.length >= PER_REQUEST) break outer;
      const weight = JSON.stringify(rec.data).length + 64;
      if (size + weight > REQUEST_BYTES_MAX) break outer;
      records.push({ ...rec, updated: sync.known[key].u });
      size += weight;
    }
  }
  return { cursor: sync.cursor, records, removed: sync.removed.slice(0, PER_REQUEST) };
}

export interface Applied {
  sync: RecordsSync;
  /** The values that changed, by store key. */
  values: Map<string, unknown>;
}

/** What the Worker took of `wire`: marks cleared for records not changed again since, removals sent taken off. */
export function acknowledge(sync: RecordsSync, wire: Wire): RecordsSync {
  if (wire.records.length === 0 && wire.removed.length === 0) return sync;
  const sentAt = new Map(wire.records.map((r) => [keyOf(r.kind, r.id), r.updated]));
  return {
    ...sync,
    dirty: sync.dirty.filter((key) => !(sentAt.has(key) && sync.known[key]?.u === sentAt.get(key))),
    removed: sync.removed.filter((r) => !wire.removed.some((w) => w.kind === r.kind && w.id === r.id && w.at === r.at)),
  };
}

/**
 * Pages of one paged run as one answer, each record's last word kept (a record on one page and removed on a later one
 * is removed; removed and then written again is written), with the last page's cursor. A child (a Learn item) and its
 * parent (its track) can arrive on different pages: taken in together, the reader sees both.
 */
export function joinPages(pages: readonly Reply[]): Reply {
  const last = new Map<string, { record?: Stamped; removed?: Removed }>();
  for (const page of pages) {
    for (const record of page.records) {
      const key = keyOf(record.kind, record.id);
      last.delete(key);
      last.set(key, { record });
    }
    for (const removal of page.removed) {
      const key = keyOf(removal.kind, removal.id);
      last.delete(key);
      last.set(key, { removed: removal });
    }
  }
  const events = [...last.values()];
  return {
    cursor: pages.length ? pages[pages.length - 1].cursor : 0,
    more: false,
    records: events.flatMap((e) => (e.record ? [e.record] : [])),
    removed: events.flatMap((e) => (e.removed ? [e.removed] : [])),
  };
}

/**
 * After a value is made again from records, what the sync state knows of its collection is brought in line with it: a
 * record its reader refused (a Learn item without its track, a count past its limit) is forgotten, not noted as removed
 * here, so it is never deleted on the user's other devices; a record that just arrived and that the reader tidied keeps its
 * stamp and takes the tidied hash, so the tidying is not sent as a change. Only records that arrived are re-hashed: a
 * change made here whose save is still being written must still look changed when that save is stamped.
 */
function settle(collection: Collection, value: unknown, known: RecordsSync["known"], dirty: Set<string>,
  arrived: ReadonlySet<string>): void {
  const kept = recordsOf(collection, value);
  for (const key of Object.keys(known)) {
    if (!owns(collection, key)) continue;
    const rec = kept.get(key);
    if (!rec) {
      delete known[key];
      dirty.delete(key);
    } else if (arrived.has(key) && !dirty.has(key)) {
      known[key] = { u: known[key].u, h: hashOf(rec.data) };
    }
  }
}

/**
 * The Worker's answer to `wire`, taken in: first what it took (acknowledge), then what other devices changed, then its
 * cursor. `first`: this device is still listening on its first sync. A paged run is taken in once, whole (joinPages).
 */
export function applyReply(values: ReadonlyArray<[Collection, unknown]>, sync: RecordsSync, wire: Wire, reply: Reply,
  now: number, first = false): Applied {
  const acked = acknowledge(sync, wire);
  const known = { ...acked.known };
  const dirty = new Set(acked.dirty);
  const removed = acked.removed;
  const removedAt = new Map(removed.map((r) => [keyOf(r.kind, r.id), r.at]));
  const byKind = new Map<string, Collection>();
  const maps = new Map<Collection, Map<string, Rec>>();
  for (const [collection, value] of values) {
    collection.kinds.forEach((kind) => byKind.set(kind, collection));
    maps.set(collection, recordsOf(collection, value));
  }
  const touched = new Set<Collection>();
  const arrived = new Set<string>();
  for (const theirs of reply.records) {
    const collection = byKind.get(theirs.kind);
    const key = keyOf(theirs.kind, theirs.id);
    if (!collection || !RECORD_ID.test(theirs.id) || !time(theirs.updated) || !plainObject(theirs.data)) continue;
    // Removed here while this exchange was on its way: the removal goes next, and wins.
    if ((removedAt.get(key) ?? 0) >= theirs.updated) continue;
    const map = maps.get(collection)!;
    const mine = map.get(key);
    const theirsH = hashOf(theirs.data);
    const mineDirty = dirty.has(key) && mine !== undefined;
    if (mine && hashOf(mine.data) === theirsH) {
      // The same on both: take their stamp, nothing to send.
      known[key] = { u: theirs.updated, h: theirsH };
      dirty.delete(key);
      continue;
    }
    let data = theirs.data;
    let stamp = theirs.updated;
    let keepMarked = false;
    const mineNewer = mineDirty && !first && (known[key]?.u ?? 0) > theirs.updated;
    if (mineDirty && collection.merge) {
      data = collection.merge(theirs.kind, mine.data, theirs.data);
      keepMarked = hashOf(data) !== theirsH;
      // A join that simply takes theirs, from a kind with nothing to join (the join turned the other way gives mine),
      // leaves a newer change made here as it is. A join that equals theirs because mine is already inside it (a
      // count of 1 against 3, fajr against fajr and dhuhr) takes theirs: keeping mine would lose what theirs holds.
      if (!keepMarked && mineNewer && hashOf(collection.merge(theirs.kind, theirs.data, mine.data)) !== theirsH) continue;
      stamp = keepMarked ? Math.max(now, theirs.updated + 1, known[key]?.u ?? 0) : theirs.updated;
    } else if (mineNewer) {
      continue;
    }
    map.set(key, { kind: theirs.kind, id: theirs.id, data });
    arrived.add(key);
    known[key] = { u: stamp, h: hashOf(data) };
    if (keepMarked) dirty.add(key);
    else dirty.delete(key);
    touched.add(collection);
  }
  for (const r of reply.removed) {
    const collection = byKind.get(r.kind);
    const key = keyOf(r.kind, r.id);
    if (!collection) continue;
    const map = maps.get(collection)!;
    // A record changed here after the removal stays; on a first sync, the others' removal wins over what was here.
    if (!first && dirty.has(key) && (known[key]?.u ?? 0) > r.at) continue;
    if (map.delete(key)) touched.add(collection);
    delete known[key];
    dirty.delete(key);
  }
  const changed = new Map<string, unknown>();
  for (const [collection, value] of values) {
    if (!touched.has(collection)) continue;
    const made = collection.fromRecords([...maps.get(collection)!.values()], value);
    settle(collection, made, known, dirty, arrived);
    changed.set(collection.key, made);
  }
  return {
    sync: { ...acked, cursor: reply.cursor, known, dirty: [...dirty], removed,
      listened: sync.listened || (first && !reply.more) },
    values: changed,
  };
}

/** The Worker's answer, checked; null when it is not one. Each record's data is checked when its value is made again. */
export function readReply(body: unknown): Reply | null {
  const v = body as Record<string, unknown> | null;
  if (!v || v.ok !== true || !(v.cursor === 0 || time(v.cursor)) || typeof v.more !== "boolean" ||
    !Array.isArray(v.records) || !Array.isArray(v.removed) ||
    v.records.length + v.removed.length > PER_REQUEST) return null;
  const records = (v.records as unknown[]).flatMap((r) => {
    const e = r as Record<string, unknown>;
    return plainObject(e) && typeof e.kind === "string" && RECORD_KIND.test(e.kind) && typeof e.id === "string" &&
      RECORD_ID.test(e.id) && time(e.updated) && plainObject(e.data)
      ? [{ kind: e.kind, id: e.id, updated: e.updated, data: e.data }] : [];
  });
  const removed = (v.removed as unknown[]).flatMap((r) => {
    const e = r as Record<string, unknown>;
    return plainObject(e) && typeof e.kind === "string" && RECORD_KIND.test(e.kind) && typeof e.id === "string" &&
      RECORD_ID.test(e.id) && time(e.at) ? [{ kind: e.kind, id: e.id, at: e.at }] : [];
  });
  return { cursor: v.cursor as number, more: v.more, records, removed };
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** One exchange with the Worker; says why when it did not work. Never throws. */
export async function postRecords(worker: string, session: string, wire: Wire, send: Post = nativePost,
  deadline = SYNC_DEADLINE_MS): Promise<Sent> {
  let response: HttpResponse | null;
  try {
    response = await withDeadline(send({
      url: `${worker}/app/records`, data: wire, responseType: "json", disableRedirects: true,
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
  if (response.status === 404) return { ok: false, why: "missing" };
  if (response.status === 429) return { ok: false, why: "busy", retryAfter: retryAfterOf(response.headers) };
  if (response.status >= 300 && response.status < 400) return { ok: false, why: "moved" };
  const own = response.status >= 400 ? cleanShown(body?.error, ERROR_MAX) : "";
  return { ok: false, why: "refused", error: own || "The Worker did not take the changes." };
}
