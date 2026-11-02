/**
 * What the user writes into the mushaf while reading and revising (muraja'ah): mistakes on words, notes on ayahs and pages,
 * where the user stopped, and the page colour. Every change returns new marks.
 */
import { PAGES, SURA_AYAS } from "./data.ts";
import { pageOfAyah } from "./pages.ts";

export type Theme = "paper" | "night";

export interface Mistake { count: number; last: string }
export interface Note { text: string; updated: string }

export interface MushafMarks {
  v: 1;
  /** By word, "sura:ayah:word". */
  mistakes: Record<string, Mistake>;
  /** By ayah, "sura:ayah". */
  notes: Record<string, Note>;
  /** By page number. */
  pageNotes: Record<string, Note>;
  /** Where the user stopped reading (a bookmark): moved by reading on and by the user's log, never by a revision link. */
  lastPage: number;
  /** When lastPage was set (ms since 1970), 0 before it ever was: of two devices' bookmarks, the newer one wins. */
  lastPageAt: number;
  theme: Theme;
}

export const NOTE_MAX = 1000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** No word in the Quran is past this position in its ayah (the longest ayah, 2:282, has 128 words). */
const WORD_MAX = 200;

export function emptyMarks(): MushafMarks {
  return { v: 1, mistakes: {}, notes: {}, pageNotes: {}, lastPage: 1, lastPageAt: 0, theme: "paper" };
}

function parseKey(key: string, parts: number): number[] | null {
  if (typeof key !== "string" || !/^\d{1,3}(:\d{1,3}){1,2}$/.test(key)) return null;
  const numbers = key.split(":").map(Number);
  return numbers.length === parts ? numbers : null;
}

const realAyah = (sura: number, aya: number): boolean =>
  sura >= 1 && sura <= SURA_AYAS.length && aya >= 1 && aya <= SURA_AYAS[sura - 1];

export function isAyahKey(key: string): boolean {
  const n = parseKey(key, 2);
  return n !== null && realAyah(n[0], n[1]);
}

export function isWordKey(key: string): boolean {
  const n = parseKey(key, 3);
  return n !== null && realAyah(n[0], n[1]) && n[2] >= 1 && n[2] <= WORD_MAX;
}

const isPage = (page: number): boolean => Number.isInteger(page) && page >= 1 && page <= PAGES;
const clean = (text: string): string => Array.from(text.replace(/\r\n?/g, "\n").trim()).slice(0, NOTE_MAX).join("");

export function markMistake(marks: MushafMarks, word: string, today: string): MushafMarks {
  if (!isWordKey(word) || !DAY_KEY.test(today)) return marks;
  const count = (marks.mistakes[word]?.count ?? 0) + 1;
  return { ...marks, mistakes: { ...marks.mistakes, [word]: { count, last: today } } };
}

export function clearMistakes(marks: MushafMarks, word: string): MushafMarks {
  if (!Object.hasOwn(marks.mistakes, word)) return marks;
  const { [word]: _gone, ...rest } = marks.mistakes;
  return { ...marks, mistakes: rest };
}

export function mistakesOnPage(marks: MushafMarks, words: readonly string[]): number {
  return words.reduce((sum, w) => sum + (Object.hasOwn(marks.mistakes, w) ? marks.mistakes[w].count : 0), 0);
}

function withNote(notes: Record<string, Note>, key: string, text: string, today: string): Record<string, Note> {
  const value = clean(text);
  const { [key]: _old, ...rest } = notes;
  return value ? { ...rest, [key]: { text: value, updated: today } } : rest;
}

export function setAyahNote(marks: MushafMarks, ayah: string, text: string, today: string): MushafMarks {
  if (!isAyahKey(ayah) || !DAY_KEY.test(today)) return marks;
  return { ...marks, notes: withNote(marks.notes, ayah, text, today) };
}

export function setPageNote(marks: MushafMarks, page: number, text: string, today: string): MushafMarks {
  if (!isPage(page) || !DAY_KEY.test(today)) return marks;
  return { ...marks, pageNotes: withNote(marks.pageNotes, String(page), text, today) };
}

/** No bookmark is from before the app existed (2026). */
const BOOKMARK_EARLIEST = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;
/** A bookmark time as saved on this device: a whole number of ms from 2026 on (this clock may since have gone back). */
const savedBookmarkTime = (at: unknown): at is number =>
  typeof at === "number" && Number.isSafeInteger(at) && at >= BOOKMARK_EARLIEST;
/** A bookmark time from another device: also never more than a day ahead of this clock. */
export const validBookmarkTime = (at: unknown, now = Date.now()): at is number =>
  savedBookmarkTime(at) && at <= now + DAY_MS;

/** Moves the bookmark to a page, stamped with the time it moved (a time out of range leaves the marks as they are). */
export function setLastPage(marks: MushafMarks, page: number, at: number): MushafMarks {
  if (!validBookmarkTime(at)) return marks;
  return { ...marks, lastPage: isPage(page) ? page : 1, lastPageAt: at };
}

/**
 * Moves the bookmark now: always later than its last move, even if this clock has gone back since. A last move dated
 * more than a day ahead (a clock that was wrong, then corrected) is not followed, so the bookmark never freezes.
 */
export function moveBookmark(marks: MushafMarks, page: number, now = Date.now()): MushafMarks {
  const after = validBookmarkTime(marks.lastPageAt, now) ? marks.lastPageAt + 1 : 0;
  return setLastPage(marks, page, Math.max(now, after));
}

export function setTheme(marks: MushafMarks, theme: Theme): MushafMarks {
  return { ...marks, theme: theme === "night" ? "night" : "paper" };
}

export interface NoteEntry { page: number; kind: "page" | "ayah" | "mistake"; key: string; text: string; date: string }

/** Every note and mistake, in mushaf order, for the revision list. */
export function notesList(marks: MushafMarks): NoteEntry[] {
  const pageOf = (key: string): number => {
    const [sura, aya] = key.split(":").map(Number);
    return pageOfAyah(sura, aya) ?? 1;
  };
  const entries: NoteEntry[] = [
    ...Object.entries(marks.pageNotes).map(([page, n]) => ({ page: Number(page), kind: "page" as const, key: page, text: n.text, date: n.updated })),
    ...Object.entries(marks.notes).map(([key, n]) => ({ page: pageOf(key), kind: "ayah" as const, key, text: n.text, date: n.updated })),
    ...Object.entries(marks.mistakes).map(([key, m]) => ({ page: pageOf(key), kind: "mistake" as const, key,
      text: `${m.count} mistake${m.count === 1 ? "" : "s"}`, date: m.last })),
  ];
  const order = { page: 0, ayah: 1, mistake: 2 };
  return entries.sort((a, b) => a.page - b.page || order[a.kind] - order[b.kind] || a.key.localeCompare(b.key));
}

function readNotes(value: unknown, valid: (key: string) => boolean): Record<string, Note> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, n]) => {
    const note = n as Record<string, unknown> | null;
    const text = typeof note?.text === "string" ? clean(note.text) : "";
    const updated = typeof note?.updated === "string" && DAY_KEY.test(note.updated) ? note.updated : null;
    return valid(key) && text && updated ? [[key, { text, updated }]] : [];
  }));
}

/** Reads saved marks back, keeping only what is valid. */
export function checkMarks(json: string | null): { marks: MushafMarks; damaged: boolean } {
  if (json === null) return { marks: emptyMarks(), damaged: false };
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null || raw.v !== 1) return { marks: emptyMarks(), damaged: true };
    const source = typeof raw.mistakes === "object" && raw.mistakes !== null ? raw.mistakes as Record<string, unknown> : {};
    const mistakes = Object.fromEntries(Object.entries(source).flatMap(([key, m]) => {
      const entry = m as Record<string, unknown> | null;
      const count = entry?.count;
      const last = entry?.last;
      return isWordKey(key) && typeof count === "number" && Number.isInteger(count) && count > 0 && count < 10000 &&
        typeof last === "string" && DAY_KEY.test(last) ? [[key, { count, last }]] : [];
    }));
    const lastPage = typeof raw.lastPage === "number" && isPage(raw.lastPage) ? raw.lastPage : 1;
    // Only the lower bound: a saved time never goes missing because this clock was set back.
    const lastPageAt = savedBookmarkTime(raw.lastPageAt) ? raw.lastPageAt : 0;
    return {
      marks: {
        v: 1, mistakes, notes: readNotes(raw.notes, isAyahKey),
        pageNotes: readNotes(raw.pageNotes, (key) => /^\d{1,3}$/.test(key) && isPage(Number(key))),
        lastPage, lastPageAt, theme: raw.theme === "night" ? "night" : "paper",
      },
      damaged: false,
    };
  } catch {
    return { marks: emptyMarks(), damaged: true };
  }
}
