/**
 * Arabic folded for matching only: what the speech model writes and what the Uthmani text says are compared after both
 * lose their vowel marks, Quranic signs and letter variants. The text itself is never changed or kept folded; this
 * runs in memory, on a copy, each time.
 */

/** Vowel marks, tanwin, shadda, sukun, the dagger alef, Quranic annotation signs, tatweel and the ayah marks. */
const MARKS = /[ؐ-ؚـً-ٰٟۖ-ۭ]/g;
const ALEFS = /[آأإٱٲٳٵ]/g;
/** Anything that is not an Arabic letter becomes a space: digits, ayah numbers, punctuation, Latin. */
const NOT_LETTER = /[^ء-غف-ي]+/g;

export function fold(text: string): string {
  return text.normalize("NFC")
    .replace(MARKS, "")
    .replace(ALEFS, "ا")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .replace(NOT_LETTER, " ")
    .trim()
    .replace(/ +/g, " ");
}

/** The folded words, none empty. */
export function foldWords(text: string): string[] {
  const folded = fold(text);
  return folded ? folded.split(" ") : [];
}

/** The folded letters with no spaces: the speech model joins and splits words differently from the mushaf. */
export function foldCompact(text: string): string {
  return fold(text).replace(/ /g, "");
}

/** How many single-letter edits turn a into b (Levenshtein), over code points. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[y.length];
}

/** 1 for the same word, 0 for nothing in common; the share of letters that need no edit. */
export function wordSimilarity(a: string, b: string): number {
  const longest = Math.max(Array.from(a).length, Array.from(b).length);
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest;
}
