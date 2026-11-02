/**
 * What the user learns, kept on the device: tracks (Trading, Tafsir and the rest), the items in each (courses, lectures,
 * books), the study time logged against them, and the lessons the user writes in the user's own words for review. Every change
 * returns a new Learn; nothing is changed in place. The app never types or shows Quran or hadith text: a lesson's
 * source is only what the user typed.
 */
import { isPublicHost } from "../agenda/calendars.ts";
import { parseDayKey, shiftKey } from "../agenda/days.ts";
import { weekStart } from "../body/summary.ts";
import { STEP_MAX, firstDue } from "./review.ts";

export type TrackKind = "islamic" | "worldly";
export type ItemKind = "course" | "lecture" | "book" | "video" | "article" | "other";
export type ItemStatus = "todo" | "doing" | "done";

export interface LearnTrack { id: string; name: string; kind: TrackKind; weeklyMinutes: number; archived: boolean; added: string }

export interface LearnItem {
  id: string;
  trackId: string;
  title: string;
  kind: ItemKind;
  url: string | null;
  status: ItemStatus;
  /** Its place in the track: lower comes first. */
  order: number;
  added: string;
  /** The day it was marked done, while it is done. */
  done: string | null;
}

export interface StudySession { id: string; trackId: string; itemId: string | null; date: string; minutes: number; note: string }

export interface Lesson {
  id: string;
  trackId: string;
  itemId: string | null;
  date: string;
  text: string;
  /** Where it is from, as the user typed it ("Al-Baqarah 255", "Sahih Muslim 2699", a page). */
  source: string;
  /** The day it comes back for review. */
  due: string;
  /** How far along the review intervals it is (learn/review.ts). */
  step: number;
}

export interface Learn { v: 1; tracks: LearnTrack[]; items: LearnItem[]; sessions: StudySession[]; lessons: Lesson[] }

export const TRACK_KINDS: readonly TrackKind[] = ["islamic", "worldly"];
export const TRACK_KIND_LABEL: Readonly<Record<TrackKind, string>> = { islamic: "Islamic", worldly: "Worldly" };
export const ITEM_KINDS: readonly ItemKind[] = ["course", "lecture", "book", "video", "article", "other"];
export const ITEM_KIND_LABEL: Readonly<Record<ItemKind, string>> = {
  course: "Course", lecture: "Lecture", book: "Book", video: "Video", article: "Article", other: "Other",
};
export const STATUSES: readonly ItemStatus[] = ["todo", "doing", "done"];
export const STATUS_LABEL: Readonly<Record<ItemStatus, string>> = { todo: "To do", doing: "Doing", done: "Done" };

export const NAME_MAX = 200;
export const NOTE_MAX = 300;
export const LESSON_MAX = 1000;
export const SOURCE_MAX = 200;
export const URL_MAX = 500;
export const MINUTES_MIN = 1;
export const MINUTES_MAX = 600;
export const WEEKLY_MAX = 3000;
/** Past these, Learn stops taking more: far beyond a lifetime of study, short of freezing the phone. */
export const TRACKS_MAX = 50;
export const ITEMS_MAX = 5000;
export const SESSIONS_MAX = 20000;
export const LESSONS_MAX = 20000;

const ID = /^[A-Za-z0-9-]{1,64}$/;
/** The same rule as books/library.ts: characters that hide or spoof what text says go; U+200C and U+200D stay. */
const INVISIBLE = [0x200b, 0x2060, 0xfeff].map((c) => String.fromCodePoint(c)).join("") +
  `${String.fromCodePoint(0xe0000)}-${String.fromCodePoint(0xe007f)}`;
const HIDDEN = new RegExp(`(?![\\n\\t])[\\p{Cc}\\p{Bidi_Control}${INVISIBLE}]`, "gu");

export const isId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

export function emptyLearn(): Learn {
  return { v: 1, tracks: [], items: [], sessions: [], lessons: [] };
}

/** A random id; every id it makes matches the id rule (hex and dashes, or digits, letters and a dash). */
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Text that may run over lines (lessons): hidden characters out, runs of spaces made one. */
const clip = (text: string, max: number): string =>
  Array.from(text.replace(HIDDEN, "").replace(/[ \t]+/g, " ").trim()).slice(0, max).join("");
/** Text on one line (names, titles, sources, notes). */
const line = (text: string, max: number): string => clip(text.replace(/\s+/g, " "), max);
/**
 * A name as compared: case, marks (harakat, accents) and punctuation set aside, so "Tafsir" and "tafsīr", or the
 * Arabic with and without its vowels, are one name. A name made only of punctuation compares as itself.
 */
const nameKey = (s: string): string =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() || s;

/**
 * A link typed or given: written out as https://, at most 500 characters, nothing hidden, no backslash, no sign-in in
 * it; else null. Kept as the parser reads it, so what is shown is what opens.
 */
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^https:\/\//i.test(text) || text.length > URL_MAX || /[\s\\]/.test(text) || text.replace(HIDDEN, "") !== text) {
    return null;
  }
  try {
    const url = new URL(text);
    // A public site only: no address on the user's own network or the phone itself (a link may come from another device).
    const ok = url.protocol === "https:" && url.hostname !== "" && !url.username && !url.password &&
      isPublicHost(url.hostname);
    return ok && url.href.length <= URL_MAX ? url.href : null;
  } catch {
    return null;
  }
}

/** Minutes as typed: a whole number from `min` to `max`, else null. */
export function parseMinutes(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.trim()) : Number.NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** "45 min", "4 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

const weekly = (n: number): number => (Number.isFinite(n) ? Math.min(WEEKLY_MAX, Math.max(0, Math.round(n))) : 0);

export const trackOf = (learn: Learn, id: string | null): LearnTrack | undefined => learn.tracks.find((t) => t.id === id);
export const itemOf = (learn: Learn, id: string | null): LearnItem | undefined => learn.items.find((i) => i.id === id);
/** The item, only if it belongs to that track. */
const itemIn = (learn: Learn, trackId: string, id: string | null): LearnItem | undefined =>
  id === null ? undefined : learn.items.find((i) => i.id === id && i.trackId === trackId);

/** Why an addition was refused: nothing to add, the store is full, the track is gone, the minutes, or a same-name track. */
export type Refusal = "empty" | "full" | "track" | "minutes" | "exists";
/** The new Learn and the new record's id; when refused, the Learn unchanged, why, and (for "exists") the track there. */
export interface Added { learn: Learn; id: string | null; refused: Refusal | null }

const refuse = (learn: Learn, refused: Refusal, id: string | null = null): Added => ({ learn, id, refused });

export interface TrackDraft { name: string; kind: TrackKind; weeklyMinutes: number }

/** Adds a track; one with the same name (ignoring case and punctuation), archived or not, is refused. */
export function addTrack(learn: Learn, draft: TrackDraft, today: string): Added {
  const name = line(draft.name, NAME_MAX);
  if (!name) return refuse(learn, "empty");
  const same = learn.tracks.find((t) => nameKey(t.name) === nameKey(name));
  if (same) return refuse(learn, "exists", same.id);
  if (learn.tracks.length >= TRACKS_MAX) return refuse(learn, "full");
  const track: LearnTrack = {
    id: newId(), name, kind: TRACK_KINDS.includes(draft.kind) ? draft.kind : "worldly",
    weeklyMinutes: weekly(draft.weeklyMinutes), archived: false, added: today,
  };
  return { learn: { ...learn, tracks: [...learn.tracks, track] }, id: track.id, refused: null };
}

function withTrack(learn: Learn, id: string, change: (track: LearnTrack) => LearnTrack): Learn {
  return { ...learn, tracks: learn.tracks.map((t) => (t.id === id ? change(t) : t)) };
}

export function setArchived(learn: Learn, id: string, archived: boolean): Learn {
  return withTrack(learn, id, (t) => ({ ...t, archived }));
}

export function setWeeklyMinutes(learn: Learn, id: string, minutes: number): Learn {
  return withTrack(learn, id, (t) => ({ ...t, weeklyMinutes: weekly(minutes) }));
}

export interface ItemDraft { title: string; kind: ItemKind; url: string | null }

/** Adds an item at the end of its track. */
export function addItem(learn: Learn, trackId: string, draft: ItemDraft, today: string): Added {
  if (!trackOf(learn, trackId)) return refuse(learn, "track");
  const title = line(draft.title, NAME_MAX);
  if (!title) return refuse(learn, "empty");
  if (learn.items.length >= ITEMS_MAX) return refuse(learn, "full");
  const last = learn.items.reduce((max, i) => (i.trackId === trackId ? Math.max(max, i.order) : max), 0);
  const item: LearnItem = {
    id: newId(), trackId, title, kind: ITEM_KINDS.includes(draft.kind) ? draft.kind : "other", url: cleanUrl(draft.url),
    status: "todo", order: last + 1, added: today, done: null,
  };
  return { learn: { ...learn, items: [...learn.items, item] }, id: item.id, refused: null };
}

const NEXT_STATUS: Readonly<Record<ItemStatus, ItemStatus>> = { todo: "doing", doing: "done", done: "todo" };

function withItem(learn: Learn, id: string, change: (item: LearnItem) => LearnItem): Learn {
  return { ...learn, items: learn.items.map((i) => (i.id === id ? change(i) : i)) };
}

/** To do, then doing, then done (dated today), then to do again. */
export function cycleItem(learn: Learn, id: string, today: string): Learn {
  return withItem(learn, id, (i) => {
    const status = NEXT_STATUS[i.status];
    return { ...i, status, done: status === "done" ? today : null };
  });
}

/** Removes an item. The user's time and lessons stay with the track; they no longer name the item. */
export function removeItem(learn: Learn, id: string): Learn {
  const unname = <T extends { itemId: string | null }>(r: T): T => (r.itemId === id ? { ...r, itemId: null } : r);
  return {
    ...learn, items: learn.items.filter((i) => i.id !== id), sessions: learn.sessions.map(unname),
    lessons: learn.lessons.map(unname),
  };
}

export interface SessionDraft { trackId: string; itemId: string | null; minutes: number; note: string }

/** Logs study time today. Study on an item not yet begun starts it, as reading a page starts a book. */
export function logSession(learn: Learn, draft: SessionDraft, today: string): Added {
  if (!trackOf(learn, draft.trackId)) return refuse(learn, "track");
  const minutes = parseMinutes(draft.minutes, MINUTES_MIN, MINUTES_MAX);
  if (minutes === null) return refuse(learn, "minutes");
  if (learn.sessions.length >= SESSIONS_MAX) return refuse(learn, "full");
  const item = itemIn(learn, draft.trackId, draft.itemId);
  const session: StudySession = {
    id: newId(), trackId: draft.trackId, itemId: item?.id ?? null, date: today, minutes, note: line(draft.note, NOTE_MAX),
  };
  const items = item?.status === "todo" ? withItem(learn, item.id, (i) => ({ ...i, status: "doing" })).items : learn.items;
  return { learn: { ...learn, items, sessions: [...learn.sessions, session] }, id: session.id, refused: null };
}

export function removeSession(learn: Learn, id: string): Learn {
  return { ...learn, sessions: learn.sessions.filter((s) => s.id !== id) };
}

export interface LessonDraft { trackId: string; itemId: string | null; text: string; source: string }

/** A lesson in the user's own words; it comes back for review tomorrow. */
export function addLesson(learn: Learn, draft: LessonDraft, today: string): Added {
  if (!trackOf(learn, draft.trackId)) return refuse(learn, "track");
  const text = clip(draft.text, LESSON_MAX);
  if (!text) return refuse(learn, "empty");
  if (learn.lessons.length >= LESSONS_MAX) return refuse(learn, "full");
  const lesson: Lesson = {
    id: newId(), trackId: draft.trackId, itemId: itemIn(learn, draft.trackId, draft.itemId)?.id ?? null, date: today,
    text, source: line(draft.source, SOURCE_MAX), due: firstDue(today), step: 0,
  };
  return { learn: { ...learn, lessons: [...learn.lessons, lesson] }, id: lesson.id, refused: null };
}

export function removeLesson(learn: Learn, id: string): Learn {
  return { ...learn, lessons: learn.lessons.filter((l) => l.id !== id) };
}

export const activeTracks = (learn: Learn): LearnTrack[] => learn.tracks.filter((t) => !t.archived);
export const archivedTracks = (learn: Learn): LearnTrack[] => learn.tracks.filter((t) => t.archived);

/** A track's items in their order (the sort keeps ties in the order they were added). */
export function trackItems(learn: Learn, trackId: string): LearnItem[] {
  return learn.items.filter((i) => i.trackId === trackId).sort((a, b) => a.order - b.order);
}

/** What the user is on: the first item being done, else the first still to do. */
export function nextItem(learn: Learn, trackId: string): LearnItem | null {
  const items = trackItems(learn, trackId);
  return items.find((i) => i.status === "doing") ?? items.find((i) => i.status === "todo") ?? null;
}

/** A track's lessons, the newest first. */
export function trackLessons(learn: Learn, trackId: string): Lesson[] {
  return learn.lessons.filter((l) => l.trackId === trackId).reverse()
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

/** The study logged on a track in the week (Monday to Sunday) holding `today`, the newest first. */
export function weekSessions(learn: Learn, trackId: string, today: string): StudySession[] {
  const first = weekStart(today);
  const last = shiftKey(first, 6);
  return learn.sessions.filter((s) => s.trackId === trackId && s.date >= first && s.date <= last).reverse()
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

/** Minutes studied this week on one track, or on every track still studied when none is named; one pass. */
export function weekMinutes(learn: Learn, today: string, trackId: string | null = null): number {
  const ids = new Set(trackId === null ? activeTracks(learn).map((t) => t.id) : [trackId]);
  const first = weekStart(today);
  const last = shiftKey(first, 6);
  return learn.sessions.reduce((sum, s) => (ids.has(s.trackId) && s.date >= first && s.date <= last ? sum + s.minutes : sum), 0);
}

/** The weekly targets of every track still studied, added up. */
export function weekTarget(learn: Learn): number {
  return activeTracks(learn).reduce((sum, t) => sum + t.weeklyMinutes, 0);
}

type Raw = Record<string, unknown>;
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const day = (v: unknown): string | null => (typeof v === "string" && parseDayKey(v) ? v : null);
const record = (v: unknown): Raw | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Raw) : null);
const whole = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null;

function readTrack(value: unknown): LearnTrack | null {
  const v = record(value);
  const name = line(str(v?.name, NAME_MAX * 2), NAME_MAX);
  if (!v || !isId(v.id) || !name) return null;
  return {
    id: v.id, name, kind: TRACK_KINDS.includes(v.kind as TrackKind) ? (v.kind as TrackKind) : "worldly",
    weeklyMinutes: whole(v.weeklyMinutes, 0, WEEKLY_MAX) ?? 0, archived: v.archived === true,
    added: day(v.added) ?? "2000-01-01",
  };
}

function readItem(value: unknown, tracks: ReadonlySet<string>): LearnItem | null {
  const v = record(value);
  const title = line(str(v?.title, NAME_MAX * 2), NAME_MAX);
  if (!v || !isId(v.id) || !isId(v.trackId) || !tracks.has(v.trackId) || !title) return null;
  const status = STATUSES.includes(v.status as ItemStatus) ? (v.status as ItemStatus) : "todo";
  return {
    id: v.id, trackId: v.trackId, title, kind: ITEM_KINDS.includes(v.kind as ItemKind) ? (v.kind as ItemKind) : "other",
    url: cleanUrl(v.url), status, order: whole(v.order, -1e9, 1e9) ?? 0, added: day(v.added) ?? "2000-01-01",
    done: status === "done" ? day(v.done) : null,
  };
}

/** An item named by a session or lesson, kept only when it is an item of the same track. */
const ownItem = (v: Raw, items: ReadonlyMap<string, string>, trackId: string): string | null =>
  isId(v.itemId) && items.get(v.itemId) === trackId ? v.itemId : null;

function readSession(value: unknown, tracks: ReadonlySet<string>, items: ReadonlyMap<string, string>): StudySession | null {
  const v = record(value);
  const date = day(v?.date);
  const minutes = whole(v?.minutes, 0, MINUTES_MAX);
  if (!v || !isId(v.id) || !isId(v.trackId) || !tracks.has(v.trackId) || !date || !minutes) return null;
  return {
    id: v.id, trackId: v.trackId, itemId: ownItem(v, items, v.trackId), date, minutes,
    note: line(str(v.note, NOTE_MAX * 2), NOTE_MAX),
  };
}

function readLesson(value: unknown, tracks: ReadonlySet<string>, items: ReadonlyMap<string, string>): Lesson | null {
  const v = record(value);
  const date = day(v?.date);
  const text = clip(str(v?.text, LESSON_MAX * 2), LESSON_MAX);
  if (!v || !isId(v.id) || !isId(v.trackId) || !tracks.has(v.trackId) || !date || !text) return null;
  return {
    id: v.id, trackId: v.trackId, itemId: ownItem(v, items, v.trackId), date, text,
    source: line(str(v.source, SOURCE_MAX * 2), SOURCE_MAX), due: day(v.due) ?? firstDue(date),
    step: whole(v.step, 0, STEP_MAX) ?? 0,
  };
}

/** Records read, one per id (the first wins), at most `max`. */
function readAll<T extends { id: string }>(values: unknown, max: number, read: (value: unknown) => T | null): T[] {
  const seen = new Set<string>();
  return list(values).slice(0, max).flatMap((value) => {
    const r = read(value);
    if (!r || seen.has(r.id)) return [];
    seen.add(r.id);
    return [r];
  });
}

/**
 * Learn as saved or as another device sent it, every field checked and cut to its limit. `damaged` when it is not
 * one at all, or when any record had to be left out, so the copy as saved is kept aside before anything replaces it.
 */
export function checkLearn(json: string | null): { learn: Learn; damaged: boolean } {
  if (json === null) return { learn: emptyLearn(), damaged: false };
  try {
    const raw = record(JSON.parse(json));
    if (!raw || raw.v !== 1) return { learn: emptyLearn(), damaged: true };
    const lists = [raw.tracks, raw.items, raw.sessions, raw.lessons];
    const tracks = readAll(raw.tracks, TRACKS_MAX, readTrack);
    const trackIds = new Set(tracks.map((t) => t.id));
    const items = readAll(raw.items, ITEMS_MAX, (v) => readItem(v, trackIds));
    const itemTracks = new Map(items.map((i) => [i.id, i.trackId]));
    const sessions = readAll(raw.sessions, SESSIONS_MAX, (v) => readSession(v, trackIds, itemTracks));
    const lessons = readAll(raw.lessons, LESSONS_MAX, (v) => readLesson(v, trackIds, itemTracks));
    const kept = tracks.length + items.length + sessions.length + lessons.length;
    const given = lists.reduce((n: number, x) => n + list(x).length, 0);
    const shaped = lists.every((x) => Array.isArray(x));
    return { learn: { v: 1, tracks, items, sessions, lessons }, damaged: !shaped || kept !== given };
  } catch {
    return { learn: emptyLearn(), damaged: true };
  }
}
