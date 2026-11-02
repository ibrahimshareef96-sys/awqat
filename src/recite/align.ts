/**
 * Memorise: the page's words are hidden and each few seconds of recitation is lined up against them, from where the
 * reciter has got to. A word heard as said is shown; a different word heard in its place, or a word passed over, is a
 * slip. The speech model only writes Arabic; these rules decide (the approach of hifz-tester, MIT, written anew here).
 * Pure: the page's words in, a new state out.
 */
import { foldWords, wordSimilarity } from "./fold.ts";

export type WordMark = "said" | "different" | "skipped" | "peeked";

export interface Memorise {
  /** The page's words in reading order, as "sura:ayah:word" keys, and folded for matching. */
  keys: readonly string[];
  folded: readonly string[];
  /** One per word: null while hidden. */
  marks: readonly (WordMark | null)[];
  /** What was heard in a word's place, for a "different" one. */
  heard: readonly (string | null)[];
  /** The next word to be said. */
  next: number;
}

/** Two words this alike are the same word heard through a phone's microphone. */
export const SAME_WORD = 0.7;
/** How many words past the heard ones the reciter may have skipped in one go. */
const LOOKAHEAD = 6;
/** A stretch of speech that fits the page this badly is noise or talk, not recitation, and is let go. */
const NOISE_COST = 0.75;
/** To pick up somewhere else on the page, a stretch must fit there at least this well. */
const JUMP_COST = 0.35;

export function startMemorise(words: readonly { key: string; text: string }[]): Memorise {
  const usable = words.map((w) => ({ key: w.key, folded: foldWords(w.text).join("") })).filter((w) => w.folded !== "");
  return { keys: usable.map((w) => w.key), folded: usable.map((w) => w.folded), marks: usable.map(() => null),
    heard: usable.map(() => null), next: 0 };
}

type Step = { kind: "match" | "different"; at: number; heard: string } | { kind: "skip"; at: number } | { kind: "extra" };

/**
 * Lines the heard words up against the page from `from`: every heard word is used, the page may stop anywhere.
 * Returns the steps and their cost (a different word, a skipped word or an extra word each cost 1).
 */
function align(expected: readonly string[], from: number, heard: readonly string[]): { cost: number; steps: Step[] } {
  const span = Math.min(expected.length - from, heard.length + LOOKAHEAD);
  const rows = heard.length + 1;
  const cols = span + 1;
  const cost = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const back = Array.from({ length: rows }, () => new Array<"d" | "u" | "l">(cols).fill("d"));
  for (let j = 1; j < cols; j++) { cost[0][j] = j; back[0][j] = "l"; }
  for (let i = 1; i < rows; i++) {
    cost[i][0] = i;
    back[i][0] = "u";
    for (let j = 1; j < cols; j++) {
      const same = wordSimilarity(heard[i - 1], expected[from + j - 1]) >= SAME_WORD;
      const diagonal = cost[i - 1][j - 1] + (same ? 0 : 1);
      const up = cost[i - 1][j] + 1;
      const left = cost[i][j - 1] + 1;
      if (diagonal <= up && diagonal <= left) { cost[i][j] = diagonal; back[i][j] = "d"; }
      else if (left <= up) { cost[i][j] = left; back[i][j] = "l"; }
      else { cost[i][j] = up; back[i][j] = "u"; }
    }
  }
  // The page may stop anywhere: the cheapest end along the last row, the furthest of equals.
  let end = 0;
  for (let j = 1; j < cols; j++) if (cost[rows - 1][j] <= cost[rows - 1][end]) end = j;
  const steps: Step[] = [];
  let i = rows - 1;
  let j = end;
  while (i > 0 || j > 0) {
    const move = i === 0 ? "l" : j === 0 ? "u" : back[i][j];
    if (move === "d") {
      const same = wordSimilarity(heard[i - 1], expected[from + j - 1]) >= SAME_WORD;
      steps.push({ kind: same ? "match" : "different", at: from + j - 1, heard: heard[i - 1] });
      i -= 1; j -= 1;
    } else if (move === "l") { steps.push({ kind: "skip", at: from + j - 1 }); j -= 1; }
    else { steps.push({ kind: "extra" }); i -= 1; }
  }
  return { cost: cost[rows - 1][end], steps: steps.reverse() };
}

/** Where on the page this stretch fits best when it does not fit where the reciter was. */
function relocate(m: Memorise, heard: readonly string[]): number | null {
  let best: { at: number; cost: number } | null = null;
  for (let at = 0; at < m.folded.length; at++) {
    if (at === m.next || wordSimilarity(heard[0], m.folded[at]) < SAME_WORD) continue;
    const { cost } = align(m.folded, at, heard);
    if (!best || cost < best.cost) best = { at, cost };
  }
  return best && best.cost / heard.length <= JUMP_COST ? best.at : null;
}

/** A few seconds of recitation, as the speech model wrote it, laid on the page. */
export function hearChunk(m: Memorise, transcript: string): Memorise {
  const heard = foldWords(transcript);
  if (heard.length === 0 || m.next >= m.folded.length) return m;
  let from = m.next;
  let result = align(m.folded, from, heard);
  if (result.cost / heard.length > JUMP_COST) {
    // Started further on, went back to repeat, or the model misheard all of it: pick up where it fits, else let go.
    const elsewhere = relocate(m, heard);
    if (elsewhere !== null) { from = elsewhere; result = align(m.folded, from, heard); }
    else if (result.cost / heard.length > NOISE_COST) return m;
  }
  const marks = [...m.marks];
  const heardWords = [...m.heard];
  // Only words up to the last one actually heard count; the page beyond stays hidden.
  const reached = result.steps.reduce((last, s) => (s.kind === "match" || s.kind === "different" ? Math.max(last, s.at) : last), -1);
  // The first stretch of a page may start anywhere on it: words before where it began were not skipped, only not
  // recited yet, so they stay hidden.
  const fresh = m.marks.every((mark) => mark === null);
  const began = result.steps.reduce((first, s) => (s.kind === "match" || s.kind === "different" ? Math.min(first, s.at) : first),
    Number.POSITIVE_INFINITY);
  for (const step of result.steps) {
    if (step.kind === "extra" || step.at > reached) continue;
    if (fresh && step.at < began) continue;
    // A word already said stays said when the reciter goes over it again.
    if (marks[step.at] === "said" || marks[step.at] === "peeked") continue;
    if (step.kind === "match") marks[step.at] = "said";
    else if (step.kind === "different") { marks[step.at] = "different"; heardWords[step.at] = step.heard; }
    else if (from === m.next) marks[step.at] = "skipped";
  }
  return { ...m, marks, heard: heardWords, next: reached >= 0 ? Math.max(m.next, reached + 1) : m.next };
}

/** Shows the next word, counted as a peek. */
export function peek(m: Memorise): Memorise {
  if (m.next >= m.folded.length) return m;
  const marks = [...m.marks];
  marks[m.next] = "peeked";
  return { ...m, marks, next: m.next + 1 };
}

/** The reciter says this slip was a mishearing: the word counts as said. */
export function clearSlip(m: Memorise, key: string): Memorise {
  const at = m.keys.indexOf(key);
  if (at < 0 || (m.marks[at] !== "different" && m.marks[at] !== "skipped")) return m;
  const marks = [...m.marks];
  const heard = [...m.heard];
  marks[at] = "said";
  heard[at] = null;
  return { ...m, marks, heard };
}

export interface MemoriseSummary { said: number; different: number; skipped: number; peeked: number; hidden: number; done: boolean }

export function summarise(m: Memorise): MemoriseSummary {
  const count = (mark: WordMark | null): number => m.marks.filter((x) => x === mark).length;
  const hidden = count(null);
  return { said: count("said"), different: count("different"), skipped: count("skipped"), peeked: count("peeked"), hidden,
    done: hidden === 0 };
}

/** The words to keep as revision mistakes: the slips and the peeks. */
export function slips(m: Memorise): string[] {
  return m.keys.filter((_, i) => m.marks[i] === "different" || m.marks[i] === "skipped" || m.marks[i] === "peeked");
}
