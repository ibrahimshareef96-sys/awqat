/**
 * The Weekly Review kept as a muhasabah: what the user wrote looking back on a week, and up to three intentions for
 * the week after it. One review a week, kept under the Monday that week begins on (body/summary.ts weekStart, the
 * same rule as study "since Monday" and training days), in the place's calendar days: a review written on Sunday
 * belongs to the week it ends. The newest 52 are kept. The intentions show on Home for the seven days after the review
 * that set them, until a new review replaces them. Nothing here is counted or scored. Every change returns a new log.
 * Pure.
 */
import { parseDayKey, shiftKey } from "../agenda/days.ts";
import { weekStart } from "../body/summary.ts";
import { cleanShown } from "../talk/text.ts";

export const REVIEWS_MAX = 52;
export const REFLECTION_MAX = 600;
export const INTENTION_MAX = 80;
export const INTENTIONS_MAX = 3;
/** Days after a review its intentions stay on Home: until the same weekday a week on. */
export const INTENTION_DAYS = 7;
/** A past review's first line, as the history lists it. */
const LINE_MAX = 70;

export const PROMPT_KEYS = ["well", "short", "change"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export const PROMPTS: Readonly<Record<PromptKey, string>> = {
  well: "What went well, alhamdulillah?",
  short: "What fell short, and what got in the way?",
  change: "What will you change next week?",
};

export const REVIEW_ERRORS = {
  empty: "Write a line, or an intention, to keep this week's review.",
};

export interface Intention {
  text: string;
  done: boolean;
}

export interface WeekReflection {
  /** The Monday of the week it was written in (YYYY-MM-DD). */
  week: string;
  /** The day it was last saved. */
  day: string;
  well: string;
  short: string;
  change: string;
  intentions: Intention[];
}

export interface ReviewLog {
  v: 1;
  /** Newest week first, one review a week. */
  reviews: WeekReflection[];
}

/** What the review's form holds, as typed. */
export interface ReviewDraft {
  well: string;
  short: string;
  change: string;
  intentions: readonly string[];
}

export const emptyReviewLog = (): ReviewLog => ({ v: 1, reviews: [] });

/** The week a day belongs to: its Monday. */
export const weekOf = (day: string): string => weekStart(day);

/**
 * A reflection: each line cleaned as any text the app shows is (talk/text.ts: what hides or turns text goes, the marks
 * real scripts need stay), its own line breaks kept, at most one empty line in a row, at most REFLECTION_MAX characters.
 */
export function cleanReflection(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.slice(0, REFLECTION_MAX * 4).split(/\r\n?|\n/).map((line) => cleanShown(line, REFLECTION_MAX))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return Array.from(text).slice(0, REFLECTION_MAX).join("").trim();
}

/** An intention: one short line. */
export const cleanIntention = (value: unknown): string => cleanShown(value, INTENTION_MAX);

const byWeek = (a: WeekReflection, b: WeekReflection): number => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0);

export function reviewOf(log: ReviewLog, week: string): WeekReflection | null {
  return log.reviews.find((r) => r.week === week) ?? null;
}

const isEmpty = (r: Pick<WeekReflection, PromptKey | "intentions">): boolean =>
  PROMPT_KEYS.every((k) => r[k] === "") && r.intentions.length === 0;

/**
 * This week's review saved over any saved earlier in the week. An intention kept word for word keeps its tick. A review
 * with nothing written is not kept: with one kept this week, clearing every field lets it go (`review` null).
 */
export function saveReview(log: ReviewLog, draft: ReviewDraft, day: string): { log: ReviewLog; review: WeekReflection | null } |
  { error: string } {
  if (!parseDayKey(day)) return { error: REVIEW_ERRORS.empty };
  const week = weekOf(day);
  const before = reviewOf(log, week);
  const others = log.reviews.filter((r) => r.week !== week);
  const texts = [...new Set(draft.intentions.map(cleanIntention).filter(Boolean))].slice(0, INTENTIONS_MAX);
  const review: WeekReflection = {
    week, day, well: cleanReflection(draft.well), short: cleanReflection(draft.short), change: cleanReflection(draft.change),
    intentions: texts.map((text) => ({ text, done: before?.intentions.some((i) => i.text === text && i.done) ?? false })),
  };
  if (isEmpty(review)) return before ? { log: { v: 1, reviews: others }, review: null } : { error: REVIEW_ERRORS.empty };
  // The newest 52 are kept; the oldest goes, here and on the user's other devices.
  return { log: { v: 1, reviews: [review, ...others].sort(byWeek).slice(0, REVIEWS_MAX) }, review };
}

/** One intention ticked done, or back; anything not there leaves the log as it is. */
export function toggleIntention(log: ReviewLog, week: string, index: number): ReviewLog {
  const review = reviewOf(log, week);
  if (!review || !Number.isInteger(index) || index < 0 || index >= review.intentions.length) return log;
  const intentions = review.intentions.map((i, n) => (n === index ? { ...i, done: !i.done } : i));
  return { v: 1, reviews: log.reviews.map((r) => (r.week === week ? { ...r, intentions } : r)) };
}

/**
 * The intentions Home shows: the newest review's, for the seven days after it was written. A review dated more than a
 * day ahead of today (another device's clock was wrong) is passed over, so it can never hold Home for good; a day
 * ahead is allowed for a device in a zone that has reached tomorrow.
 */
export function homeIntentions(log: ReviewLog, today: string): { week: string; intentions: Intention[] } | null {
  const tomorrow = shiftKey(today, 1);
  const newest = log.reviews.find((r) => r.day <= tomorrow);
  if (!newest || newest.intentions.length === 0 || today > shiftKey(newest.day, INTENTION_DAYS)) return null;
  return { week: newest.week, intentions: newest.intentions };
}

/** A review's first line, for the history: the first thing written, cut short. */
export function firstLine(review: WeekReflection): string {
  const text = PROMPT_KEYS.map((k) => review[k]).find(Boolean)?.split("\n")[0] ?? review.intentions[0]?.text ?? "";
  const chars = Array.from(text);
  return chars.length > LINE_MAX ? `${chars.slice(0, LINE_MAX).join("").trim()}…` : text;
}

/** Every week's review but this one, newest first, by its first line. */
export function pastReviews(log: ReviewLog, thisWeek: string): { week: string; line: string }[] {
  return log.reviews.filter((r) => r.week !== thisWeek).map((r) => ({ week: r.week, line: firstLine(r) }));
}

type Raw = Record<string, unknown>;
const plain = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** A week's key as reviews are kept under it: a real day, and a Monday. */
export const isWeekKey = (v: unknown): v is string => typeof v === "string" && parseDayKey(v) !== null && weekOf(v) === v;

/**
 * Text read back: cleaned as when saved; `bad` when it was not text or ran past its length. Cut before it is cleaned,
 * so a huge value costs no more than a long one (twice `max` in UTF-16 units always holds more than `max` characters).
 */
function readText(v: unknown, max: number, clean: (s: string) => string): { text: string; bad: boolean } {
  if (v === undefined || v === "") return { text: "", bad: false };
  if (typeof v !== "string") return { text: "", bad: true };
  const head = v.slice(0, max * 2);
  return { text: clean(head), bad: head.length < v.length || Array.from(head).length > max };
}

/** Intentions read back; only the first few entries are looked at, however many were sent. */
function readIntentions(v: unknown): { intentions: Intention[]; bad: boolean } {
  if (v === undefined) return { intentions: [], bad: false };
  if (!Array.isArray(v)) return { intentions: [], bad: true };
  const read = v.slice(0, INTENTIONS_MAX * 4).map((i) => {
    const text = plain(i) ? readText(i.text, INTENTION_MAX, cleanIntention) : { text: "", bad: true };
    return { text: text.text, done: plain(i) && i.done === true, bad: text.bad || !plain(i) || typeof i.done !== "boolean" };
  });
  const kept = read.filter((i, n) => i.text !== "" && read.findIndex((o) => o.text === i.text) === n).slice(0, INTENTIONS_MAX);
  return { intentions: kept.map(({ text, done }) => ({ text, done })), bad: v.length > INTENTIONS_MAX || kept.length !== v.length ||
    read.some((i) => i.bad) };
}

function readReview(raw: unknown): { review: WeekReflection | null; bad: boolean } {
  if (!plain(raw) || !isWeekKey(raw.week) || typeof raw.day !== "string" || !parseDayKey(raw.day) || weekOf(raw.day) !== raw.week) {
    return { review: null, bad: true };
  }
  const [well, short, change] = PROMPT_KEYS.map((k) => readText(raw[k], REFLECTION_MAX, cleanReflection));
  const { intentions, bad } = readIntentions(raw.intentions);
  const review: WeekReflection = { week: raw.week, day: raw.day, well: well.text, short: short.text, change: change.text, intentions };
  if (isEmpty(review)) return { review: null, bad: true };
  return { review, bad: bad || well.bad || short.bad || change.bad };
}

/** The saved reviews read back; `damaged` when something was saved but did not read as reviews this app writes. */
export function checkReviewLog(json: string | null): { log: ReviewLog; damaged: boolean } {
  if (json === null) return { log: emptyReviewLog(), damaged: false };
  try {
    const raw = JSON.parse(json) as unknown;
    if (!plain(raw) || raw.v !== 1 || !Array.isArray(raw.reviews) || raw.reviews.length > REVIEWS_MAX) {
      return { log: emptyReviewLog(), damaged: true };
    }
    const read = raw.reviews.map(readReview);
    const reviews = read.flatMap((r) => (r.review ? [r.review] : []))
      .filter((r, n, all) => all.findIndex((o) => o.week === r.week) === n).sort(byWeek);
    return { log: { v: 1, reviews }, damaged: read.some((r) => r.bad) || reviews.length !== raw.reviews.length };
  } catch {
    return { log: emptyReviewLog(), damaged: true };
  }
}
