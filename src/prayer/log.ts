/**
 * The prayer log kept on the device, shaped to sync to the Worker later. Every change returns a new log; nothing is
 * changed in place.
 */
import { PRAYERS, addDays, dayKey, type PrayerName } from "./times.ts";

export interface Mark {
  status: "ontime" | "late";
  mosque: boolean;
}

export type Sunnah = "duha" | "witr" | "night";
export const SUNNAH: readonly Sunnah[] = ["duha", "witr", "night"];

export interface DayLog {
  prayers: Partial<Record<PrayerName, Mark>>;
  sunnah: Record<Sunnah, boolean>;
}

export interface PrayerLog {
  v: 1;
  days: Record<string, DayLog>;
  /** Prayers still to make up, kept by hand. */
  owed: number;
}

export const OWED_MAX = 99999;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function emptyLog(): PrayerLog {
  return { v: 1, days: {}, owed: 0 };
}

function emptyDay(): DayLog {
  return { prayers: {}, sunnah: { duha: false, witr: false, night: false } };
}

function withDay(log: PrayerLog, date: string, change: (day: DayLog) => DayLog): PrayerLog {
  const day = log.days[date] ?? emptyDay();
  return { ...log, days: { ...log.days, [date]: change(day) } };
}

/** none, on time, on time at the mosque, late, none: one tap moves to the next. */
function nextMark(mark: Mark | undefined): Mark | undefined {
  if (!mark) return { status: "ontime", mosque: false };
  if (mark.status === "ontime" && !mark.mosque) return { status: "ontime", mosque: true };
  if (mark.status === "ontime") return { status: "late", mosque: false };
  return undefined;
}

export function cycleMark(log: PrayerLog, date: string, prayer: PrayerName): PrayerLog {
  return withDay(log, date, (day) => {
    const next = nextMark(day.prayers[prayer]);
    const prayers = { ...day.prayers };
    if (next) prayers[prayer] = next;
    else delete prayers[prayer];
    return { ...day, prayers };
  });
}

/** A prayer marked as the user said it, whatever it was before. */
export function setMark(log: PrayerLog, date: string, prayer: PrayerName, mark: Mark): PrayerLog {
  return withDay(log, date, (day) => ({ ...day, prayers: { ...day.prayers, [prayer]: mark } }));
}

export function toggleSunnah(log: PrayerLog, date: string, which: Sunnah): PrayerLog {
  return withDay(log, date, (day) => ({ ...day, sunnah: { ...day.sunnah, [which]: !day.sunnah[which] } }));
}

export function adjustOwed(log: PrayerLog, delta: number): PrayerLog {
  const owed = Math.min(OWED_MAX, Math.max(0, Math.round(log.owed + delta)));
  return { ...log, owed };
}

export type Dot = "ontime" | "late" | "none";

export function weekDots(log: PrayerLog, today: string, days = 7): { date: string; dots: Dot[] }[] {
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: days }, (_, i) => {
    const date = dayKey(addDays({ y, m, d }, i - (days - 1)));
    const prayers = log.days[date]?.prayers ?? {};
    return { date, dots: PRAYERS.map((p) => prayers[p]?.status ?? "none") };
  });
}

function readMark(value: unknown): Mark | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.status !== "ontime" && v.status !== "late") return null;
  return { status: v.status, mosque: v.mosque === true };
}

function readDay(value: unknown): DayLog {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const rawPrayers = (typeof v.prayers === "object" && v.prayers !== null ? v.prayers : {}) as Record<string, unknown>;
  const rawSunnah = (typeof v.sunnah === "object" && v.sunnah !== null ? v.sunnah : {}) as Record<string, unknown>;
  const prayers: Partial<Record<PrayerName, Mark>> = {};
  for (const p of PRAYERS) {
    const mark = readMark(rawPrayers[p]);
    if (mark) prayers[p] = mark;
  }
  return {
    prayers,
    sunnah: { duha: rawSunnah.duha === true, witr: rawSunnah.witr === true, night: rawSunnah.night === true },
  };
}

/**
 * A saved log, checked field by field. `damaged` is true when something was saved but cannot be read as a log: the
 * caller keeps that copy aside before anything new is written over it.
 */
export function checkLog(json: string | null): { log: PrayerLog; damaged: boolean } {
  if (json === null) return { log: emptyLog(), damaged: false };
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null || raw.v !== 1) return { log: emptyLog(), damaged: true };
    const rawDays = (typeof raw.days === "object" && raw.days !== null ? raw.days : {}) as Record<string, unknown>;
    const days: Record<string, DayLog> = {};
    for (const [key, value] of Object.entries(rawDays)) {
      if (DAY_KEY.test(key)) days[key] = readDay(value);
    }
    const owed = typeof raw.owed === "number" && Number.isFinite(raw.owed) ? raw.owed : 0;
    return { log: adjustOwed({ v: 1, days, owed: 0 }, owed), damaged: false };
  } catch {
    return { log: emptyLog(), damaged: true };
  }
}

export function parseLog(json: string | null): PrayerLog {
  return checkLog(json).log;
}
