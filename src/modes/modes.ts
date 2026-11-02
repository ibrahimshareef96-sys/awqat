/**
 * Modes: a view of the app for one occasion. Some open by themselves for a while (Jumu'ah, Fajr, Maghrib, a study the user
 * has given a time), the rest when the user asks (Istikhara, any study). This file is when they open and what is kept for
 * them: how far each step has got, where a reading stands, and "Not now". A reading in a mode has its own place, so it
 * never moves the mushaf's bookmark or the user's log. Every change returns a new log.
 */
import { shiftKey } from "../agenda/days.ts";
import { fridayWindow } from "../faith/friday.ts";
import { MINUTES_MAX } from "../learn/learn.ts";
import { iqamaAt } from "../prayer/iqama.ts";
import type { DayTimes, PrayerName } from "../prayer/times.ts";

export type ModeId = "jumuah" | "fajr" | "maghrib" | "dhuhr" | "asr" | "isha" | "istikhara" | `study:${string}`;
export const AFTER_CHOICES = ["off", "fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
/** When a study opens by itself: after that prayer until the next, or "off" for only when the user opens it. */
export type StudyAfter = (typeof AFTER_CHOICES)[number];

export interface ModePlace { page: number; at: number }
export interface StudyTime { after: StudyAfter; at: number }

export interface ModeLog {
  v: 1;
  /** By the occasion's date, then the mode, then the step: how many times it was said or done. */
  days: Record<string, Record<string, Record<string, number>>>;
  /** Where a reading stands, by "surah-date" ("18-2026-10-30"): each Friday's Al-Kahf starts afresh. */
  places: Record<string, ModePlace>;
  /** By track id: when its study opens by itself, when not the default. */
  study: Record<string, StudyTime>;
  /** Du'as the user added to a mode personally, by id: the user's words, shown as the user wrote them. */
  duas: Record<string, OwnDua>;
  /** The study being timed on this device, if one is. It stays on this device. */
  timer: { trackId: string; startedAt: number } | null;
}

/** A du'a the user added: never one the app wrote. */
export interface OwnDua { mode: ModeId; name: string; text: string; at: number }

export interface ModeWindow { mode: ModeId; date: string; start: Date; end: Date }

/** The step "Not now" is kept under: past it, the mode's prompt stays away until its next occasion. */
const NOT_NOW = "not-now";
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const PLACE_KEY = /^(\d{1,3})-(\d{4}-\d{2}-\d{2})$/;
const STEP_ID = /^[a-z0-9-]{1,32}$/;
const TRACK_ID = /^[A-Za-z0-9-]{1,64}$/;
const FIXED_MODES: readonly string[] = ["jumuah", "fajr", "maghrib", "dhuhr", "asr", "isha", "istikhara"];
/** Far past any count a step has (the largest is a hundred), short of a value that means nothing. */
const COUNT_MAX = 100_000;
const KEEP_DAYS = 3660;
const PLACE_KEEP_DAYS = 30;
const MINUTE_MS = 60_000;
/** Fajr stays open this long past sunrise: the two rak'ahs are prayed once the sun has risen. */
const AFTER_SUNRISE_MS = 30 * MINUTE_MS;
const DAY_MS = 86_400_000;

export const isModeId = (value: string): value is ModeId =>
  FIXED_MODES.includes(value) || (value.startsWith("study:") && TRACK_ID.test(value.slice(6)));

export function emptyModeLog(): ModeLog {
  return { v: 1, days: {}, places: {}, study: {}, duas: {}, timer: null };
}

export function stepCount(log: ModeLog, date: string, mode: string, step: string): number {
  return log.days[date]?.[mode]?.[step] ?? 0;
}

/** Sets a step's count; zero clears it, along with a mode or a day left with nothing. Old days go with the change. */
export function setStep(log: ModeLog, date: string, mode: string, step: string, count: number): ModeLog {
  if (!DAY_KEY.test(date) || !isModeId(mode) || !STEP_ID.test(step)) return log;
  const n = Math.min(COUNT_MAX, Math.max(0, Math.round(count)));
  if (stepCount(log, date, mode, step) === n) return log;
  const { [step]: _step, ...others } = log.days[date]?.[mode] ?? {};
  const steps = n > 0 ? { ...others, [step]: n } : others;
  const { [mode]: _mode, ...modes } = log.days[date] ?? {};
  const day = Object.keys(steps).length > 0 ? { ...modes, [mode]: steps } : modes;
  const { [date]: _day, ...rest } = log.days;
  const cutoff = shiftKey(date, -KEEP_DAYS);
  const kept = Object.fromEntries(Object.entries(rest).filter(([key]) => key >= cutoff));
  return { ...log, days: Object.keys(day).length > 0 ? { ...kept, [date]: day } : kept };
}

/** One more, up to its count. */
export function addToStep(log: ModeLog, date: string, mode: string, step: string, max: number): ModeLog {
  const n = stepCount(log, date, mode, step);
  return n >= max ? log : setStep(log, date, mode, step, n + 1);
}

export const isNotNow = (log: ModeLog, date: string, mode: string): boolean => stepCount(log, date, mode, NOT_NOW) > 0;
export const setNotNow = (log: ModeLog, date: string, mode: string): ModeLog => setStep(log, date, mode, NOT_NOW, 1);

export const placeOf = (log: ModeLog, key: string): number | null => log.places[key]?.page ?? null;
export const placeKey = (sura: number, date: string): string => `${sura}-${date}`;

/** Where a reading stands. Places a month old go with the change: a Friday's reading is over by the next. */
export function setPlace(log: ModeLog, key: string, page: number, at: number): ModeLog {
  const match = PLACE_KEY.exec(key);
  if (!match || !DAY_KEY.test(match[2])) return log;
  const cutoff = shiftKey(match[2], -PLACE_KEEP_DAYS);
  const kept = Object.entries(log.places).filter(([k]) => (PLACE_KEY.exec(k)?.[2] ?? "") >= cutoff && k !== key);
  return { ...log, places: { ...Object.fromEntries(kept), [key]: { page, at } } };
}

/** When a track's study window opens: off until the user picks a prayer for it. */
export const studyAfter = (log: ModeLog, trackId: string): StudyAfter => log.study[trackId]?.after ?? "off";

export function setStudyAfter(log: ModeLog, trackId: string, after: StudyAfter, at: number): ModeLog {
  return { ...log, study: { ...log.study, [trackId]: { after, at } } };
}

export const OWN_NAME_MAX = 80;
export const OWN_TEXT_MAX = 6000;
const OWN_MAX = 100;
/** Always with a dash, so no du'a shares its id with a step ("dua" is one of Friday's). */
const OWN_ID = /^d[a-z0-9]*-[a-z0-9-]{1,40}$/;
/** The modes a du'a can be added to: the Islamic ones. */
const takesDuas = (mode: string): boolean => FIXED_MODES.includes(mode);

/** Adds a du'a in the user's words; empty words, an unknown mode or a full list change nothing. */
export function addOwnDua(log: ModeLog, mode: string, name: string, text: string, at: number, id: string): ModeLog {
  const words = text.trim().slice(0, OWN_TEXT_MAX);
  if (!takesDuas(mode) || !OWN_ID.test(id) || !words || Object.keys(log.duas).length >= OWN_MAX) return log;
  const title = name.trim().slice(0, OWN_NAME_MAX) || "My du'a";
  return { ...log, duas: { ...log.duas, [id]: { mode: mode as ModeId, name: title, text: words, at } } };
}

export function removeOwnDua(log: ModeLog, id: string): ModeLog {
  if (!Object.hasOwn(log.duas, id)) return log;
  const { [id]: _gone, ...rest } = log.duas;
  return { ...log, duas: rest };
}

/** A mode's own du'as, oldest first (by id when two were added at once, so every device agrees). */
export const ownDuas = (log: ModeLog, mode: string): (OwnDua & { id: string })[] =>
  Object.entries(log.duas).filter(([, d]) => d.mode === mode).map(([id, d]) => ({ ...d, id }))
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));

export const startTimer = (log: ModeLog, trackId: string, at: number): ModeLog =>
  ({ ...log, timer: { trackId, startedAt: at } });
export const stopTimer = (log: ModeLog): ModeLog => ({ ...log, timer: null });

/** Whole minutes so far, at least one and at most what a session can hold; 0 with nothing running. */
export function runningMinutes(log: ModeLog, now: number): number {
  if (!log.timer) return 0;
  return Math.min(MINUTES_MAX, Math.max(1, Math.round((now - log.timer.startedAt) / MINUTE_MS)));
}

/** A study's window on a day: from the prayer to the next (Fajr to Dhuhr, past sunrise; Isha to the night's middle). */
function studyWindow(day: DayTimes, next: DayTimes | undefined, after: PrayerName): { start: Date; end: Date } {
  if (after === "fajr") return { start: day.fajr, end: day.dhuhr };
  if (after === "dhuhr") return { start: day.dhuhr, end: day.asr };
  if (after === "asr") return { start: day.asr, end: day.maghrib };
  if (after === "maghrib") return { start: day.maghrib, end: day.isha };
  // The next day's Fajr is known when the list goes on; at its end, about a day after this one's is near enough.
  const fajr = next ? next.fajr.getTime() : day.fajr.getTime() + DAY_MS;
  return { start: day.isha, end: new Date((day.maghrib.getTime() + fajr) / 2) };
}

const inside = (now: Date, start: Date, end: Date): boolean =>
  now.getTime() >= start.getTime() && now.getTime() < end.getTime();

/** The prayers with a mode just for the dhikr after them: Fajr's and Maghrib's have theirs in their own modes. */
const AFTER_PRAYERS = ["dhuhr", "asr", "isha"] as const;
/** Long enough from Dhuhr's time for the khutbah and the prayer: the app does not know when Jumu'ah is held. */
const AFTER_JUMUAH_MS = 75 * MINUTE_MS;

/** What is open by itself now: Islamic modes first, then study, each with what ends soonest first. */
export function modeWindows(days: readonly DayTimes[], now: Date, log: ModeLog, trackIds: readonly string[]): ModeWindow[] {
  const deen: ModeWindow[] = [];
  const friday = fridayWindow(days, now);
  if (friday) deen.push({ mode: "jumuah", date: friday.friday, start: friday.start, end: friday.end });
  for (const [i, day] of days.entries()) {
    const end = new Date(day.sunrise.getTime() + AFTER_SUNRISE_MS);
    if (inside(now, day.fajr, end)) deen.push({ mode: "fajr", date: day.date, start: day.fajr, end });
    if (inside(now, day.maghrib, day.isha)) deen.push({ mode: "maghrib", date: day.date, start: day.maghrib, end: day.isha });
    for (const prayer of AFTER_PRAYERS) {
      // From the iqama, as the dhikr comes after the prayer. Jumu'ah has no iqama here: past the khutbah and the prayer, then.
      const start = iqamaAt(day, prayer) ?? new Date(day[prayer].getTime() + AFTER_JUMUAH_MS);
      const { end: until } = studyWindow(day, days[i + 1], prayer);
      if (inside(now, start, until)) deen.push({ mode: prayer, date: day.date, start, end: until });
    }
  }
  const study = trackIds.flatMap((trackId): ModeWindow[] => {
    const after = studyAfter(log, trackId);
    if (after === "off") return [];
    return days.flatMap((day, i): ModeWindow[] => {
      const w = studyWindow(day, days[i + 1], after);
      return inside(now, w.start, w.end) ? [{ mode: `study:${trackId}`, date: day.date, ...w }] : [];
    });
  });
  const soonest = (a: ModeWindow, b: ModeWindow) => a.end.getTime() - b.end.getTime();
  // The dhikr after a prayer comes after the occasions it can share a time with: Jumu'ah stays the one on Home.
  const isAfter = (w: ModeWindow): boolean => (AFTER_PRAYERS as readonly string[]).includes(w.mode);
  return [...deen.filter((w) => !isAfter(w)).sort(soonest), ...deen.filter(isAfter).sort(soonest), ...study.sort(soonest)];
}

const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const goodCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= COUNT_MAX;
const goodTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * What a saved or synced log may hold at most: far past real use, short of slowing the phone. Each limit applies after
 * the check, so junk can never push out what is good.
 */
const LIMIT = { stepsPerMode: 150, modesPerDay: 60, places: 100, study: 60 } as const;

function readSteps(v: unknown): Record<string, number> {
  if (!plain(v)) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => STEP_ID.test(e[0]) && goodCount(e[1]))
    .slice(0, LIMIT.stepsPerMode));
}

function readDay(v: unknown): Record<string, Record<string, number>> {
  if (!plain(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([mode]) => isModeId(mode))
    .map(([mode, steps]) => [mode, readSteps(steps)] as const).filter(([, steps]) => Object.keys(steps).length > 0)
    .slice(0, LIMIT.modesPerDay));
}

/** The newest days, up to what is kept: the same limit a change applies. */
function readDays(v: unknown): ModeLog["days"] {
  if (!plain(v)) return {};
  return Object.fromEntries(Object.keys(v).filter((key) => DAY_KEY.test(key)).sort().reverse().slice(0, KEEP_DAYS)
    .map((key) => [key, readDay(v[key])] as const).filter(([, day]) => Object.keys(day).length > 0));
}

function readPlaces(v: unknown): ModeLog["places"] {
  if (!plain(v)) return {};
  return Object.fromEntries(Object.entries(v).flatMap(([key, p]): [string, ModePlace][] => (PLACE_KEY.test(key) && plain(p) &&
    Number.isInteger(p.page) && (p.page as number) >= 1 && (p.page as number) <= 604 && goodTime(p.at)
    ? [[key, { page: p.page as number, at: p.at }]] : []))
    .sort((a, b) => b[1].at - a[1].at).slice(0, LIMIT.places));
}

function readStudy(v: unknown): ModeLog["study"] {
  if (!plain(v)) return {};
  return Object.fromEntries(Object.entries(v).flatMap(([id, s]): [string, StudyTime][] => (TRACK_ID.test(id) && plain(s) &&
    goodTime(s.at) && (AFTER_CHOICES as readonly unknown[]).includes(s.after) ? [[id, { after: s.after as StudyAfter, at: s.at }]] : []))
    .slice(0, LIMIT.study));
}

function readDuas(v: unknown): ModeLog["duas"] {
  if (!plain(v)) return {};
  return Object.fromEntries(Object.entries(v).flatMap(([id, d]): [string, OwnDua][] => {
    if (!OWN_ID.test(id) || !plain(d) || typeof d.mode !== "string" || !takesDuas(d.mode) || !goodTime(d.at) ||
      typeof d.name !== "string" || typeof d.text !== "string" || !d.text.trim()) return [];
    return [[id, { mode: d.mode as ModeId, name: d.name.slice(0, OWN_NAME_MAX), text: d.text.slice(0, OWN_TEXT_MAX), at: d.at }]];
  }).slice(0, OWN_MAX));
}

function readTimer(v: unknown): ModeLog["timer"] {
  return plain(v) && typeof v.trackId === "string" && TRACK_ID.test(v.trackId) && goodTime(v.startedAt)
    ? { trackId: v.trackId, startedAt: v.startedAt } : null;
}

/** Reads a saved log back: only real days and modes, only sensible counts, pages and times. */
export function checkModeLog(json: string | null): { log: ModeLog; damaged: boolean } {
  if (json === null) return { log: emptyModeLog(), damaged: false };
  try {
    const raw: unknown = JSON.parse(json);
    if (!plain(raw) || raw.v !== 1) return { log: emptyModeLog(), damaged: true };
    return { log: { v: 1, days: readDays(raw.days), places: readPlaces(raw.places), study: readStudy(raw.study), duas: readDuas(raw.duas),
      timer: readTimer(raw.timer) }, damaged: false };
  } catch {
    return { log: emptyModeLog(), damaged: true };
  }
}
