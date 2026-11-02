/**
 * The Quran tracker kept on the device: your place in a full reading (page of 604), each reading session, revision of
 * what you have memorised by juz, and study sessions (tafsir and the like). Every change returns a new log.
 */
import { JUZ_START_PAGE, PAGES, PAGE_START, SURA_NAMES } from "./data.ts";

export type QuranEntry =
  | { id: string; date: string; kind: "read"; fromPage: number; toPage: number; completed?: boolean }
  | { id: string; date: string; kind: "revise"; juz: number }
  | { id: string; date: string; kind: "study"; text: string; minutes: number };

export interface QuranLog {
  v: 1;
  /** The last page reached in the current full reading; 0 before the first page. */
  position: number;
  /** Full readings completed. */
  completed: number;
  /** Oldest first. */
  entries: QuranEntry[];
  /** Pages a day the user aims for (v0.12); 0 for none. */
  dailyGoal: number;
}

export const STUDY_TEXT_MAX = 160;
export const DAILY_GOAL_MAX = 604;
export const STUDY_MINUTES_MAX = 600;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function emptyQuranLog(): QuranLog {
  return { v: 1, position: 0, completed: 0, entries: [], dailyGoal: 0 };
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const isPage = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= PAGES;
const isJuz = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 30;

export function juzOfPage(page: number): number {
  let juz = 1;
  JUZ_START_PAGE.forEach((start, i) => {
    if (page >= start) juz = i + 1;
  });
  return juz;
}

/** "Al-Baqara · juz 2": the surah a page starts in, and its juz. */
export function pageLabel(page: number): string {
  if (!isPage(page)) return "";
  return `${SURA_NAMES[PAGE_START[page - 1][0] - 1]} · juz ${juzOfPage(page)}`;
}

/** Read up to `toPage` today: one session from your place to there. A full reading done at 604 starts again at 0. */
export function logRead(log: QuranLog, date: string, toPage: number): QuranLog {
  if (!DAY_KEY.test(date) || !isPage(toPage) || toPage <= log.position) return log;
  const done = toPage === PAGES;
  const entry: QuranEntry = { id: newId(), date, kind: "read", fromPage: log.position + 1, toPage, ...(done ? { completed: true } : {}) };
  return {
    ...log,
    position: done ? 0 : toPage,
    completed: log.completed + (done ? 1 : 0),
    entries: [...log.entries, entry],
  };
}

/** Sets your place (0 to 603) without counting pages, for a reading already under way before the app. */
export function setPosition(log: QuranLog, page: number): QuranLog {
  if (!Number.isInteger(page) || page < 0 || page >= PAGES) return log;
  return { ...log, position: page };
}

export function logRevision(log: QuranLog, date: string, juz: number): QuranLog {
  if (!DAY_KEY.test(date) || !isJuz(juz)) return log;
  return { ...log, entries: [...log.entries, { id: newId(), date, kind: "revise", juz }] };
}

export function logStudy(log: QuranLog, date: string, text: string, minutes: number): QuranLog {
  const clean = Array.from(text.replace(/\s+/g, " ").trim()).slice(0, STUDY_TEXT_MAX).join("");
  if (!DAY_KEY.test(date) || clean.length === 0) return log;
  const mins = Number.isFinite(minutes) ? Math.min(STUDY_MINUTES_MAX, Math.max(0, Math.round(minutes))) : 0;
  return { ...log, entries: [...log.entries, { id: newId(), date, kind: "study", text: clean, minutes: mins }] };
}

/**
 * Removes an entry. Removing the latest reading puts your place back where that session started, unless the place
 * was set by hand since.
 */
export function deleteEntry(log: QuranLog, id: string): QuranLog {
  const entry = log.entries.find((e) => e.id === id);
  if (!entry) return log;
  const entries = log.entries.filter((e) => e.id !== id);
  const reads = log.entries.filter((e) => e.kind === "read");
  const placeFromIt = entry.kind === "read" && log.position === (entry.completed ? 0 : entry.toPage);
  if (entry.kind === "read" && reads[reads.length - 1] === entry && placeFromIt) {
    return {
      ...log, entries,
      position: entry.fromPage - 1,
      completed: entry.completed ? Math.max(0, log.completed - 1) : log.completed,
    };
  }
  return { ...log, entries };
}

export function pagesOn(log: QuranLog, date: string): number {
  return log.entries.reduce((sum, e) => (e.kind === "read" && e.date === date ? sum + e.toPage - e.fromPage + 1 : sum), 0);
}

/** A calendar day moved by a number of days ("2026-10-24", -1 → "2026-10-23"). */
export function shiftDay(date: string, by: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

const previousDay = (date: string): string => shiftDay(date, -1);

/** Days in a row with reading, ending today (or yesterday, so the streak holds until today's reading). */
export function readingStreak(log: QuranLog, today: string): number {
  const days = new Set(log.entries.filter((e) => e.kind === "read").map((e) => e.date));
  let day = days.has(today) ? today : previousDay(today);
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day = previousDay(day);
  }
  return streak;
}

/** The pages a day the user aims for; 0 clears the goal. */
export function setDailyGoal(log: QuranLog, pages: number): QuranLog {
  if (!Number.isInteger(pages) || pages < 0 || pages > DAILY_GOAL_MAX) return log;
  return { ...log, dailyGoal: pages };
}

/** Days of reading the pace looks back over when no goal is set. */
export const PACE_DAYS = 14;

/**
 * The day this reading ends: at the daily goal when there is one, else at the pace of the last two weeks; null with no
 * goal and no reading lately. Today counts as a reading day until its goal is met, then the count starts tomorrow.
 */
export function finishDate(log: QuranLog, today: string): { date: string; basis: "goal" | "pace" } | null {
  const left = PAGES - log.position;
  if (left <= 0) return null;
  const recent = Array.from({ length: PACE_DAYS }, (_, i) => pagesOn(log, shiftDay(today, -i))).reduce((a, b) => a + b, 0);
  const perDay = log.dailyGoal > 0 ? log.dailyGoal : recent / PACE_DAYS;
  if (!(perDay > 0)) return null;
  // What today still holds counts today; the rest goes a day's share at a time. So reading today never moves the date
  // back and forth.
  const room = Math.max(0, perDay - pagesOn(log, today));
  const days = left <= room ? 0 : Math.ceil((left - room) / perDay);
  return { date: shiftDay(today, days), basis: log.dailyGoal > 0 ? "goal" : "pace" };
}

/** The last day each juz was revised, by juz number. */
export function lastRevised(log: QuranLog): Record<number, string> {
  const last: Record<number, string> = {};
  for (const e of log.entries) {
    if (e.kind === "revise" && (!last[e.juz] || e.date > last[e.juz])) last[e.juz] = e.date;
  }
  return last;
}

function readEntry(value: unknown): QuranEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length > 64 || typeof v.date !== "string" || !DAY_KEY.test(v.date)) return null;
  const base = { id: v.id, date: v.date };
  if (v.kind === "read" && typeof v.fromPage === "number" && typeof v.toPage === "number" && isPage(v.fromPage) &&
    isPage(v.toPage) && v.fromPage <= v.toPage) {
    return { ...base, kind: "read", fromPage: v.fromPage, toPage: v.toPage, ...(v.completed === true ? { completed: true } : {}) };
  }
  if (v.kind === "revise" && typeof v.juz === "number" && isJuz(v.juz)) return { ...base, kind: "revise", juz: v.juz };
  if (v.kind === "study" && typeof v.text === "string" && v.text.trim() && typeof v.minutes === "number") {
    return { ...base, kind: "study", text: v.text.slice(0, STUDY_TEXT_MAX * 2),
      minutes: Math.min(STUDY_MINUTES_MAX, Math.max(0, Math.round(v.minutes))) };
  }
  return null;
}

export function checkQuranLog(json: string | null): { log: QuranLog; damaged: boolean } {
  if (json === null) return { log: emptyQuranLog(), damaged: false };
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null || raw.v !== 1) return { log: emptyQuranLog(), damaged: true };
    const entries = (Array.isArray(raw.entries) ? raw.entries : []).map(readEntry).filter((e): e is QuranEntry => e !== null);
    const position = typeof raw.position === "number" && Number.isInteger(raw.position) && raw.position >= 0 &&
      raw.position < PAGES ? raw.position : 0;
    const completed = typeof raw.completed === "number" && Number.isInteger(raw.completed) && raw.completed >= 0 ? raw.completed : 0;
    const dailyGoal = typeof raw.dailyGoal === "number" && Number.isInteger(raw.dailyGoal) && raw.dailyGoal >= 0 &&
      raw.dailyGoal <= DAILY_GOAL_MAX ? raw.dailyGoal : 0;
    return { log: { v: 1, position, completed, entries, dailyGoal }, damaged: false };
  } catch {
    return { log: emptyQuranLog(), damaged: true };
  }
}
