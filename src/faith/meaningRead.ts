/**
 * What comes from hisnmuslim.com and Quran.com, and the phone's own copy of it, read defensively. Every size is capped
 * before anything is kept, every field must be the type it should be, and an item whose Arabic is not ours is left out
 * (a site that renumbered would otherwise put another dhikr's meaning under ours). Anything that does not hold up comes
 * to nothing, never to a crash; what is kept is plain text, shown only through esc().
 */
import { plainTranslation, shareOfPairs, withoutInvisible } from "./meaningText.ts";

/** A chapter is about 30 KB; far past that it is not one. The phone's own copy is held to the same. */
export const CHAPTER_CHARS_MAX = 1_000_000;
/** The longest of the book's texts is a few thousand characters. */
export const TEXT_MAX = 6_000;
export const ARABIC_MAX = 20_000;
const ITEMS_MAX = 200;
const TITLES_MAX = 5;
/** A word's transliteration is a few letters; an ayah has under 150 words. */
const WORD_MAX = 60;
const WORDS_MAX = 300;
const VERSES_MAX = 10;
const TRANSLATIONS_MAX = 10;
const CHAPTERS_MAX = 10;
const RANGES_MAX = 20;
/** Our words must be at least this much in their Arabic for the item to be the same dhikr (the right ones are 0.8 and up). */
export const MATCH_MIN = 0.6;

export interface HisnText { transliteration: string; translation: string }
export interface QuranRange { sura: number; from: number; to: number }
/** A word's place in its ayah, and its transliteration. */
export type QuranWord = readonly [number, string];
export interface QuranVerse { words: readonly QuranWord[]; translation: string }
/** `stamp`: which of our words the items were checked against (meaning.ts), so a copy checked for others is not shown. */
export interface KeptChapter { fetched: number; stamp: string; items: ReadonlyMap<number, HisnText> }
export interface KeptRange { fetched: number; verses: readonly QuranVerse[] }
export interface Kept { hisn: Map<number, KeptChapter>; quran: Map<string, KeptRange> }

const BOM = String.fromCodePoint(0xfeff);
const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const textOf = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max && v.trim() ? v : null);
/** Text to be shown: capped, and without the invisible marks that could reorder it on screen. */
const shownText = (v: unknown, max: number): string | null => {
  const text = textOf(v, max);
  const clean = text === null ? "" : withoutInvisible(text);
  return clean.trim() ? clean : null;
};
const whole = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export const rangeKey = (r: QuranRange): string => `${r.sura}:${r.from}-${r.to}`;

/** How big a parsed answer is as text, or Infinity when it cannot be measured (a cycle, or too deep). */
function sizeOf(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * An answer as JSON: the phone's native layer hands it over parsed, or as text (perhaps with a byte order mark). Either
 * way it is held to CHAPTER_CHARS_MAX before anything walks it (what the native layer itself parsed is out of reach).
 */
function asJson(raw: unknown): unknown {
  if (typeof raw !== "string") return sizeOf(raw) > CHAPTER_CHARS_MAX ? null : raw;
  if (raw.length > CHAPTER_CHARS_MAX) return null;
  try {
    return JSON.parse(raw.startsWith(BOM) ? raw.slice(1) : raw);
  } catch {
    return null;
  }
}

/**
 * One of hisnmuslim.com's chapters ({ title: [items] }): the items asked for, by id, each with our Arabic for it. An id
 * there twice, a field of the wrong type or size, or Arabic that is not ours leaves that item out. Null when it is not
 * a chapter at all.
 */
export function readHisnChapter(raw: unknown, wanted: ReadonlyMap<number, readonly string[]>): Map<number, HisnText> | null {
  const json = asJson(raw);
  // One title holds the chapter's items; an object of many keys is not a chapter (and is not walked).
  if (!plain(json) || Object.keys(json).length > TITLES_MAX) return null;
  const items = Object.values(json).find(Array.isArray) as unknown[] | undefined;
  if (!items || items.length > ITEMS_MAX) return null;
  const times = new Map<unknown, number>();
  for (const item of items) if (plain(item)) times.set(item.ID, (times.get(item.ID) ?? 0) + 1);
  const read = new Map<number, HisnText>();
  for (const item of items) {
    if (!plain(item) || typeof item.ID !== "number" || times.get(item.ID) !== 1) continue;
    const ours = wanted.get(item.ID);
    const arabic = textOf(item.ARABIC_TEXT, ARABIC_MAX);
    const transliteration = shownText(item.LANGUAGE_ARABIC_TRANSLATED_TEXT, TEXT_MAX);
    const translation = shownText(item.TRANSLATED_TEXT, TEXT_MAX);
    if (!ours || !arabic || !transliteration || !translation) continue;
    if (ours.every((words) => shareOfPairs(words, arabic) >= MATCH_MIN)) read.set(item.ID, { transliteration, translation });
  }
  return read;
}

/** An ayah's words with a transliteration, in order; null when one is not what a word should be. */
function readWords(raw: unknown): QuranWord[] | null {
  if (!Array.isArray(raw) || raw.length > WORDS_MAX) return null;
  const words: QuranWord[] = [];
  for (const w of raw) {
    if (!plain(w)) return null;
    // The ayah's number at its end, and any other mark, have nothing to say.
    if (w.char_type_name !== "word") continue;
    const said = plain(w.transliteration) ? shownText(w.transliteration.text, WORD_MAX) : null;
    if (!said || !whole(w.position, 1, WORDS_MAX)) return null;
    words.push([w.position, said.trim()]);
  }
  return words.length > 0 ? words : null;
}

/** One ayah from Quran.com's verses: its key must be the one asked for, with the translation asked for. */
function readVerse(raw: unknown, key: string, resource: number): QuranVerse | null {
  if (!plain(raw) || raw.verse_key !== key || !Array.isArray(raw.translations) || raw.translations.length > TRANSLATIONS_MAX) return null;
  const words = readWords(raw.words);
  const chosen = (raw.translations as unknown[]).find((t) => plain(t) && t.resource_id === resource);
  const english = plain(chosen) ? textOf(chosen.text, TEXT_MAX) : null;
  const translation = english ? plainTranslation(english) : "";
  return words && translation ? { words, translation } : null;
}

/** Quran.com's verses/by_range answer for a range: exactly its ayat, in order, each whole; null otherwise. */
export function readQuranRange(raw: unknown, range: QuranRange, resource: number): QuranVerse[] | null {
  const json = asJson(raw);
  const verses = plain(json) ? json.verses : null;
  const count = range.to - range.from + 1;
  if (!Array.isArray(verses) || count < 1 || count > VERSES_MAX || verses.length !== count) return null;
  const read: QuranVerse[] = [];
  for (const [i, verse] of verses.entries()) {
    const one = readVerse(verse, `${range.sura}:${range.from + i}`, resource);
    if (!one) return null;
    read.push(one);
  }
  return read;
}

const goodTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function keptChapter(raw: unknown): KeptChapter | null {
  if (!plain(raw) || !goodTime(raw.fetched) || !plain(raw.items) || typeof raw.stamp !== "string" || raw.stamp.length > 64) return null;
  const items = new Map<number, HisnText>();
  for (const [id, item] of Object.entries(raw.items).slice(0, ITEMS_MAX)) {
    if (!/^\d{1,4}$/.test(id) || !plain(item)) continue;
    const transliteration = shownText(item.transliteration, TEXT_MAX);
    const translation = shownText(item.translation, TEXT_MAX);
    if (transliteration && translation) items.set(Number(id), { transliteration, translation });
  }
  return { fetched: raw.fetched, stamp: raw.stamp, items };
}

const RANGE_KEY = /^(\d{1,3}):(\d{1,3})-(\d{1,3})$/;

function keptRange(key: string, raw: unknown): KeptRange | null {
  const match = RANGE_KEY.exec(key);
  if (!match || !plain(raw) || !goodTime(raw.fetched) || !Array.isArray(raw.verses)) return null;
  const count = Number(match[3]) - Number(match[2]) + 1;
  if (count < 1 || count > VERSES_MAX || raw.verses.length !== count) return null;
  const verses: QuranVerse[] = [];
  for (const v of raw.verses as unknown[]) {
    if (!plain(v) || !Array.isArray(v.words) || v.words.length === 0 || v.words.length > WORDS_MAX) return null;
    const words = (v.words as unknown[]).flatMap((w): QuranWord[] => {
      if (!Array.isArray(w) || w.length !== 2 || !whole(w[0], 1, WORDS_MAX)) return [];
      const said = shownText(w[1], WORD_MAX);
      return said ? [[w[0], said]] : [];
    });
    const translation = shownText(v.translation, TEXT_MAX);
    if (words.length !== v.words.length || !translation) return null;
    verses.push({ words, translation });
  }
  return { fetched: raw.fetched, verses };
}

const nothingKept = (): Kept => ({ hisn: new Map(), quran: new Map() });

/** The phone's own copy, read back: what holds up is kept, the rest left out; a damaged copy is nothing. */
export function readKept(text: string | null): Kept {
  if (text === null || text.length > CHAPTER_CHARS_MAX) return nothingKept();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return nothingKept();
  }
  if (!plain(raw) || raw.v !== 1) return nothingKept();
  const kept = nothingKept();
  for (const [chapter, value] of Object.entries(plain(raw.hisn) ? raw.hisn : {}).slice(0, CHAPTERS_MAX)) {
    const read = /^\d{1,3}$/.test(chapter) ? keptChapter(value) : null;
    if (read) kept.hisn.set(Number(chapter), read);
  }
  for (const [key, value] of Object.entries(plain(raw.quran) ? raw.quran : {}).slice(0, RANGES_MAX)) {
    const read = keptRange(key, value);
    if (read) kept.quran.set(key, read);
  }
  return kept;
}

/** The copy the phone keeps: the same shape readKept reads. */
export function keptText(kept: Kept): string {
  const hisn = Object.fromEntries([...kept.hisn].map(([chapter, c]) => [chapter, { fetched: c.fetched, stamp: c.stamp,
    items: Object.fromEntries(c.items) }]));
  const quran = Object.fromEntries([...kept.quran].map(([key, r]) => [key, { fetched: r.fetched, verses: r.verses }]));
  return JSON.stringify({ v: 1, hisn, quran });
}
