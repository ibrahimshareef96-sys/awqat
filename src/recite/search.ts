/**
 * Recite to find: which ayah a few recited words belong to. The speech model's Arabic and every ayah are folded
 * (fold.ts) and joined without spaces; three-letter pieces pick the likely ayahs, then an edit distance that lets the
 * recitation sit anywhere inside an ayah, or run across two or three in a row, scores them. Pure, so it runs in the
 * worker and in tests alike.
 */
import { foldCompact } from "./fold.ts";
import type { Verse } from "./tanzil.ts";

export interface SearchIndex {
  verses: readonly Verse[];
  /** Each ayah folded, without spaces. */
  compact: readonly string[];
  /** Each three-letter piece: the ayahs it appears in. */
  grams: ReadonlyMap<string, readonly number[]>;
  /** Ayahs whose folded words are the same, by those words (an ayah the Quran says more than once). */
  repeats: ReadonlyMap<string, readonly number[]>;
}

export interface Match {
  sura: number;
  /** The first ayah the recitation fell in, and the last (the same unless it ran on). */
  aya: number;
  lastAya: number;
  /** 1 when every letter heard is in the ayah in order, falling with each edit. */
  score: number;
}

export type SearchResult =
  | { kind: "short" }
  | { kind: "none" }
  /** `same` holds the other places these exact words stand (an ayah said more than once in the Quran). */
  | { kind: "found"; best: Match; same: Match[] }
  | { kind: "unsure"; matches: Match[] };

/** Fewer letters than this cannot pick one ayah out of 6,236. */
export const MIN_LETTERS = 8;
export const FOUND_SCORE = 0.78;
export const UNSURE_SCORE = 0.55;
/** A second ayah this close to the best one makes the result unsure. */
const MARGIN = 0.06;
const CANDIDATES = 25;
/** How many ayahs either side of a likely one a recitation may run into. */
const WINDOW = 2;

function trigrams(text: string): Set<string> {
  const letters = Array.from(text);
  const out = new Set<string>();
  for (let i = 0; i + 3 <= letters.length; i++) out.add(letters.slice(i, i + 3).join(""));
  return out;
}

export function buildIndex(verses: readonly Verse[]): SearchIndex {
  const compact = verses.map((v) => foldCompact(v.text));
  const grams = new Map<string, number[]>();
  const byText = new Map<string, number[]>();
  compact.forEach((text, i) => {
    for (const gram of trigrams(text)) {
      const list = grams.get(gram);
      if (list) list.push(i);
      else grams.set(gram, [i]);
    }
    byText.set(text, [...(byText.get(text) ?? []), i]);
  });
  const repeats = new Map([...byText].filter(([, list]) => list.length > 1));
  return { verses, compact, grams, repeats };
}

/**
 * The stretch of the text the query is closest to, and how many single-letter edits apart they are. The stretch may
 * start and end anywhere; `start` and `end` are letter positions in the text (end exclusive).
 */
export function infixMatch(query: string, text: string): { distance: number; start: number; end: number } {
  const q = Array.from(query);
  const t = Array.from(text);
  let previous = new Uint32Array(t.length + 1);
  // Where in the text the stretch ending at each cell began.
  let previousStart = Uint32Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= q.length; i++) {
    const row = new Uint32Array(t.length + 1);
    const rowStart = new Uint32Array(t.length + 1);
    row[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const diagonal = previous[j - 1] + (q[i - 1] === t[j - 1] ? 0 : 1);
      const up = previous[j] + 1;
      const left = row[j - 1] + 1;
      if (diagonal <= up && diagonal <= left) { row[j] = diagonal; rowStart[j] = previousStart[j - 1]; }
      else if (up <= left) { row[j] = up; rowStart[j] = previousStart[j]; }
      else { row[j] = left; rowStart[j] = rowStart[j - 1]; }
    }
    previous = row;
    previousStart = rowStart;
  }
  let end = 0;
  for (let j = 1; j <= t.length; j++) if (previous[j] < previous[end]) end = j;
  return { distance: q.length === 0 ? 0 : previous[end], start: q.length === 0 ? 0 : previousStart[end], end };
}

/** The fewest edits that turn the query into some stretch of the text. */
export const infixDistance = (query: string, text: string): number => infixMatch(query, text).distance;

/** The likeliest ayahs: those sharing the most rare three-letter pieces with what was heard. */
function candidates(index: SearchIndex, query: string): number[] {
  const scores = new Map<number, number>();
  const total = index.verses.length;
  for (const gram of trigrams(query)) {
    const list = index.grams.get(gram);
    if (!list) continue;
    const weight = Math.log(total / list.length);
    for (const i of list) scores.set(i, (scores.get(i) ?? 0) + weight);
  }
  return [...scores].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, CANDIDATES).map(([i]) => i);
}

/**
 * The best place for the query in the ayahs around a likely one (up to WINDOW either side, within its surah), and
 * which ayahs that place starts and ends in.
 */
function scored(index: SearchIndex, query: string, at: number): { first: number; last: number; score: number } {
  const sura = index.verses[at].sura;
  let from = at;
  let to = at;
  while (from > 0 && at - from < WINDOW && index.verses[from - 1].sura === sura) from -= 1;
  while (to < index.verses.length - 1 && to - at < WINDOW && index.verses[to + 1].sura === sura) to += 1;
  // Each ayah's first letter position in the joined window.
  const starts: number[] = [];
  let text = "";
  for (let i = from; i <= to; i++) {
    starts.push(Array.from(text).length);
    text += index.compact[i];
  }
  const match = infixMatch(query, text);
  const ayahAt = (letter: number): number => {
    let i = starts.length - 1;
    while (i > 0 && starts[i] > letter) i -= 1;
    return from + i;
  };
  const length = Array.from(query).length;
  return { first: ayahAt(match.start), last: ayahAt(Math.max(match.start, match.end - 1)),
    score: Math.max(0, 1 - match.distance / length) };
}

const toMatch = (index: SearchIndex, first: number, last: number, score: number): Match =>
  ({ sura: index.verses[first].sura, aya: index.verses[first].aya, lastAya: index.verses[last].aya, score });

export function searchRecitation(index: SearchIndex, transcript: string): SearchResult {
  const query = foldCompact(transcript);
  if (Array.from(query).length < MIN_LETTERS) return { kind: "short" };
  const found = candidates(index, query).map((i) => scored(index, query, i))
    .sort((a, b) => b.score - a.score || a.first - b.first || a.last - b.last);
  // One entry per place: the same ayahs reached from two candidates count once.
  const seen = new Set<string>();
  const distinct = found.filter((m) => {
    const key = `${m.first}-${m.last}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
  const best = distinct[0];
  if (!best || best.score < UNSURE_SCORE) return { kind: "none" };
  const words = (m: { first: number; last: number }): string => index.compact.slice(m.first, m.last + 1).join("");
  // The same words elsewhere: an ayah said again word for word (found from the index, since the search stops at the
  // first place it fits), and any other span the search reached with the same words.
  const repeated = best.first === best.last ? (index.repeats.get(index.compact[best.first]) ?? []) : [];
  const same = [...repeated.filter((i) => i !== best.first).map((i) => ({ first: i, last: i, score: best.score })),
    ...distinct.slice(1).filter((m) => words(m) === words(best) && !repeated.includes(m.first))];
  // A rival is another place altogether: not the same words, and not a span overlapping the best one.
  const apart = (m: { first: number; last: number }): boolean => m.last < best.first || m.first > best.last;
  const rivals = distinct.slice(1).filter((m) => words(m) !== words(best) && apart(m));
  const close = rivals.some((m) => m.score >= best.score - MARGIN);
  if (best.score >= FOUND_SCORE && !close) {
    return { kind: "found", best: toMatch(index, best.first, best.last, best.score),
      same: same.map((m) => toMatch(index, m.first, m.last, m.score)) };
  }
  return { kind: "unsure", matches: [best, ...rivals].slice(0, 3).map((m) => toMatch(index, m.first, m.last, m.score)) };
}
