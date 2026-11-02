/**
 * One page of the Madinah mushaf as the app draws it: 15 lines (fewer on the two opening pages), each a row of words
 * in that page's King Fahd Complex font, a surah's name, or a bismillah. Pages come from Quran.com and are read
 * defensively: every glyph must be one the page fonts draw, and every ayah must belong on that page.
 */
import { PAGES, PAGE_START, SURA_AYAS } from "./data.ts";
import { isWordKey } from "./marks.ts";
import { pageOfAyah } from "./pages.ts";

export interface MushafWord { key: string; glyph: string; text: string }

export type MushafLine =
  | { n: number; kind: "words"; words: MushafWord[] }
  | { n: number; kind: "surah"; sura: number }
  | { n: number; kind: "bismillah" };

export interface MushafPage { p: number; lines: MushafLine[] }

const LINES = 15;
/**
 * A word's glyph code is a few characters of the page font: one or two for most words, four for a word carrying a
 * sakt sign (36:52's مِّن مَّرْقَدِنَا ۜ is two glyphs, a space and the sign).
 */
const GLYPH_MAX = 6;
const TEXT_MAX = 60;
/** The page fonts draw only Arabic Presentation Forms-A (U+FB50 to U+FDFF), joined by a space; built from code points. */
const GLYPHS = new RegExp(`^[${String.fromCodePoint(0xfb50)}-${String.fromCodePoint(0xfdff)} ]{1,${GLYPH_MAX}}$`, "u");
/** No mushaf line holds more than about 20 words, nor a page more than about 200: anything past these is not a page. */
const LINE_WORDS_MAX = 40;
const PAGE_WORDS_MAX = 400;

/** A word that may be drawn on this page: its glyph is from the fonts, and its ayah starts here or on the page before. */
function wordFits(key: string, glyph: unknown, page: number): glyph is string {
  if (!isWordKey(key) || typeof glyph !== "string" || !GLYPHS.test(glyph)) return false;
  const [sura, aya] = key.split(":").map(Number);
  const starts = pageOfAyah(sura, aya);
  return starts === page || starts === page - 1;
}

function readLine(value: unknown, page: number): MushafLine | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const n = v.n;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > LINES) return null;
  if (typeof v.s === "number") {
    return Number.isInteger(v.s) && v.s >= 1 && v.s <= SURA_AYAS.length ? { n, kind: "surah", sura: v.s } : null;
  }
  if (v.b === 1) return { n, kind: "bismillah" };
  if (!Array.isArray(v.w) || v.w.length === 0 || v.w.length > LINE_WORDS_MAX) return null;
  const words: MushafWord[] = [];
  for (const entry of v.w) {
    if (!Array.isArray(entry)) return null;
    const [key, glyph, text] = entry as unknown[];
    if (typeof key !== "string" || !wordFits(key, glyph, page) || typeof text !== "string" || text.length > TEXT_MAX) return null;
    words.push({ key, glyph, text });
  }
  return { n, kind: "words", words };
}

/** A page kept on the phone, read back; null when it is not a valid page for this page number. */
export function parseMushafPage(json: unknown, page: number): MushafPage | null {
  if (typeof json !== "object" || json === null) return null;
  const raw = json as Record<string, unknown>;
  if (raw.p !== page || !Number.isInteger(page) || page < 1 || page > PAGES || !Array.isArray(raw.lines) ||
    raw.lines.length > LINES) return null;
  const lines: MushafLine[] = [];
  for (const line of raw.lines) {
    const read = readLine(line, page);
    if (!read) return null;
    lines.push(read);
  }
  const words = lines.reduce((sum, l) => sum + (l.kind === "words" ? l.words.length : 0), 0);
  return lines.length > 0 && words <= PAGE_WORDS_MAX ? { p: page, lines } : null;
}

/** The surah the next page starts with, when it starts at that surah's first ayah (from the Tanzil page map). */
function nextPageStartsSurah(page: number): number | null {
  const next = PAGE_START[page];
  return next && next[1] === 1 ? next[0] : null;
}

interface ApiWord { location?: unknown; code_v2?: unknown; line_number?: unknown; page_number?: unknown; text_uthmani?: unknown }

/** The surah's name and, except for Al-Fatiha and At-Tawbah, its bismillah, in the order they sit above ayah 1. */
const headerOf = (sura: number): MushafLine[] =>
  sura === 1 || sura === 9 ? [{ n: 0, kind: "surah", sura }] : [{ n: 0, kind: "surah", sura }, { n: 0, kind: "bismillah" }];

/**
 * A page from Quran.com's page endpoint (1421 print, words of that page only) as lines. A line with no words is a
 * surah's name or bismillah: the lines just above a surah's first ayah, or the foot of a page whose next page starts
 * a surah. A line that cannot be explained, or a word from another page, makes the whole page invalid.
 */
export function pageFromApi(json: unknown, page: number): MushafPage | null {
  const verses = (json as { verses?: unknown })?.verses;
  if (!Array.isArray(verses) || !Number.isInteger(page) || page < 1 || page > PAGES) return null;
  const words = new Map<number, MushafWord[]>();
  const starts = new Map<number, number>();
  let count = 0;
  for (const verse of verses as { words?: unknown }[]) {
    if (!Array.isArray(verse?.words)) return null;
    for (const w of verse.words as ApiWord[]) {
      const key = typeof w.location === "string" ? w.location : "";
      const line = w.line_number;
      count += 1;
      if (count > PAGE_WORDS_MAX || !wordFits(key, w.code_v2, page) || w.page_number !== page || typeof line !== "number" ||
        !Number.isInteger(line) || line < 1 || line > LINES) return null;
      const text = typeof w.text_uthmani === "string" ? w.text_uthmani.slice(0, TEXT_MAX) : "";
      const row = words.get(line) ?? [];
      if (row.length >= LINE_WORDS_MAX) return null;
      words.set(line, row.concat({ key, glyph: w.code_v2, text }));
      const [sura, aya, position] = key.split(":").map(Number);
      if (aya === 1 && position === 1) starts.set(sura, line);
    }
  }
  if (words.size === 0) return null;
  const special = new Map<number, MushafLine>();
  for (const [sura, line] of starts) {
    headerOf(sura).forEach((entry, i, all) => {
      const n = line - all.length + i;
      if (n >= 1) special.set(n, { ...entry, n });
    });
  }
  const last = Math.max(...words.keys(), ...special.keys());
  const top = page > 2 ? LINES : last;
  if (top > last) {
    // The foot of the page holds the start of the next surah's header (its name, perhaps its bismillah); the rest
    // opens the next page.
    const sura = nextPageStartsSurah(page);
    const header = sura === null ? [] : headerOf(sura);
    if (header.length < top - last) return null;
    header.slice(0, top - last).forEach((entry, i) => special.set(last + 1 + i, { ...entry, n: last + 1 + i }));
  }
  const first = Math.min(...words.keys(), ...special.keys());
  const lines: MushafLine[] = [];
  for (let n = first; n <= top; n += 1) {
    const row = words.get(n);
    const extra = special.get(n);
    if ((row && extra) || (!row && !extra)) return null;
    lines.push(row ? { n, kind: "words", words: row } : (extra as MushafLine));
  }
  if (page > 2 && first !== 1) return null;
  return { p: page, lines };
}

export function pageWordKeys(page: MushafPage): string[] {
  return page.lines.flatMap((line) => (line.kind === "words" ? line.words.map((w) => w.key) : []));
}

/** "18:10:3" → "18:10". */
export function ayahOfWord(word: string): string {
  return word.split(":").slice(0, 2).join(":");
}
