/**
 * The texts under a dhikr, made ready to show: Arabic folded so two copies of the same words can be compared, the
 * morning's or the evening's part of an item that holds both, and hisnmuslim.com's transliteration made readable.
 * Nothing here writes a word: the display rules change only how the letter ayn is written, the spacing and the
 * brackets wrapped round the text. scripts/make-meaning-ids.py folds Arabic the same way.
 */
import type { Session } from "./adhkar.ts";

const cp = (code: number): string => String.fromCodePoint(code);
/** Vowel marks, Quranic annotation marks and the superscript alef, built from code points (an editor would turn escapes into the marks themselves). */
const MARKS = new RegExp(`[${cp(0x0610)}-${cp(0x061a)}${cp(0x064b)}-${cp(0x065f)}${cp(0x0670)}${cp(0x06d6)}-${cp(0x06ed)}${cp(0x0640)}]`, "gu");
const ALEFS = new RegExp(`[${cp(0x0622)}${cp(0x0623)}${cp(0x0625)}${cp(0x0671)}]`, "gu");
const TA_MARBUTA = new RegExp(cp(0x0629), "gu");
const ALEF_MAQSURA = new RegExp(cp(0x0649), "gu");
/** Anything that is not one of the basic Arabic letters (hamza to ya) is a gap between words. */
const NOT_LETTER = new RegExp(`[^${cp(0x0621)}-${cp(0x064a)}]+`, "gu");
const AYN = cp(0x2bf);

/** Arabic letters only, without vowel marks or tatweel: every alef as alef, ta marbuta as ha, alef maqsura as ya. */
export function foldArabic(text: string): string {
  return text.replace(MARKS, "").replace(ALEFS, cp(0x0627)).replace(TA_MARBUTA, cp(0x0647)).replace(ALEF_MAQSURA, cp(0x064a))
    .replace(NOT_LETTER, " ").trim();
}

const wordsOf = (text: string): string[] => foldArabic(text).split(" ").filter(Boolean);
const pairsOf = (words: readonly string[]): Set<string> => new Set(words.slice(1).map((w, i) => `${words[i]} ${w}`));

/**
 * How much of our words another copy holds: the share of our word pairs found in theirs, from 0 to 1 (for words of a
 * single word, whether theirs has it).
 */
export function shareOfPairs(ours: string, theirs: string): number {
  const mine = wordsOf(ours);
  const found = wordsOf(theirs);
  if (mine.length <= 1) return mine.length === 1 && found.includes(mine[0]) ? 1 : 0;
  const pairs = pairsOf(mine);
  const theirPairs = pairsOf(found);
  return [...pairs].filter((pair) => theirPairs.has(pair)).length / pairs.size;
}

/** "[In the evening:]" and "[For the evening, the supplication is read as follows: ]", as hisnmuslim.com writes them. */
const EVENING_MARK = /\[\s*(?:in|for) the evening\b[^\]]{0,80}:\s*\]/gi;

/**
 * The morning's or the evening's part of an item that gives both, split at its marker. Without exactly one marker, or
 * with nothing on one side of it, the whole text: shown in full rather than guessed at.
 */
export function sessionPart(text: string, session: Session | null): string {
  if (!session) return text;
  const marks = [...text.matchAll(EVENING_MARK)];
  if (marks.length !== 1) return text;
  const at = marks[0].index ?? 0;
  const before = text.slice(0, at).trim();
  const after = text.slice(at + marks[0][0].length).trim();
  if (!before || !after) return text;
  return session === "morning" ? before : after;
}

/** Each "(" with the ")" that closes it, or null when they do not pair up (then the brackets are left as they are). */
function bracketPairs(text: string): Map<number, number> | null {
  const open: number[] = [];
  const pairs = new Map<number, number>();
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") open.push(i);
    else if (text[i] === ")") {
      const start = open.pop();
      if (start === undefined) return null;
      pairs.set(start, i);
    }
  }
  return open.length === 0 ? pairs : null;
}

/** Brackets round the whole text go, and a pair wrapped straight round another pair becomes one. */
function unwrapped(text: string): string {
  let t = text.trim();
  for (let round = 0; round < 8; round += 1) {
    const pairs = bracketPairs(t);
    if (!pairs) return t;
    const drop = new Set<number>();
    for (const [start, end] of pairs) {
      if ((start === 0 && end === t.length - 1) || pairs.get(start + 1) === end - 1) drop.add(start).add(end);
    }
    if (drop.size === 0) return t;
    t = t.split("").filter((_, i) => !drop.has(i)).join("").trim();
  }
  return t;
}

/** One space between words, none before a comma or a closing bracket, one after a comma and between two groups. */
function spaced(text: string): string {
  return text.replace(/\s+/g, " ")
    .replace(/ ([,.;:!?)\]])/g, "$1")
    .replace(/([([]) /g, "$1")
    .replace(/([,;])(?=\p{L})/gu, "$1 ")
    .replace(/([)\]])(?=[\p{L}([])/gu, "$1 ")
    .replace(/([\p{L}\p{N}.,;:!?’'"])(?=[([])/gu, "$1 ")
    .trim();
}

/** Spacing and brackets put right; every word and letter as it was. */
export function tidyText(text: string): string {
  const once = (t: string): string => spaced(unwrapped(spaced(t)));
  return once(once(text));
}

/** hisnmuslim.com writes the letter ayn as two capital As (as in "maAAna"); on screen it is the letter's own mark. */
export function showTransliteration(text: string): string {
  return tidyText(text.replaceAll("AA", AYN));
}

export function showTranslation(text: string): string {
  return tidyText(text);
}

/**
 * Control characters and the invisible marks that reorder or hide text (bidi overrides and isolates, zero-width
 * marks, the byte order mark): fetched text never needs them, and with them a line could be shown out of order.
 */
const INVISIBLE = new RegExp(`[${cp(0x00)}-${cp(0x08)}${cp(0x0b)}${cp(0x0c)}${cp(0x0e)}-${cp(0x1f)}${cp(0x7f)}-${cp(0x9f)}` +
  `${cp(0x200b)}-${cp(0x200f)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2060)}-${cp(0x2069)}${cp(0xfeff)}]`, "gu");

export function withoutInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}

const NAMED: Readonly<Record<string, string>> = {
  lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lsquo: cp(0x2018), rsquo: cp(0x2019), ldquo: cp(0x201c),
  rdquo: cp(0x201d), hellip: cp(0x2026), amp: "&",
};

/** One entity read, once: a named one from the list, or a number for a character that may be shown. */
function entity(match: string, name: string): string {
  if (Object.hasOwn(NAMED, name)) return NAMED[name];
  const code = name.startsWith("#x") || name.startsWith("#X") ? Number.parseInt(name.slice(2), 16)
    : name.startsWith("#") ? Number.parseInt(name.slice(1), 10) : Number.NaN;
  const ok = Number.isInteger(code) && code > 0x1f && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return ok ? withoutInvisible(cp(code)) : match;
}

/**
 * Quran.com's translation as plain text: its footnote marks and any other tags out, its entities read in one pass (so
 * "&amp;lt;" stays "&lt;" and the screen escapes each character once). Whatever is left is only shown through esc().
 */
export function plainTranslation(html: string): string {
  const bare = html.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "").replace(/<\/?[a-z][^>]*>/gi, "");
  return withoutInvisible(bare.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, entity)).replace(/\s+/g, " ").trim();
}

/** A short fingerprint of a text, to tell whether two are the same without keeping either. */
export function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(h, 33) + text.charCodeAt(i)) | 0;
  return `${text.length}-${(h >>> 0).toString(36)}`;
}
