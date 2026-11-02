/** Calendar days as keys ("YYYY-MM-DD") in the place's time zone, and the instants where they begin. */
import { addDays, calendarDayIn, dayKey, type CalendarDay } from "../prayer/times.ts";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDayKey(key: string): CalendarDay | null {
  const m = DAY.exec(key);
  if (!m) return null;
  const day = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return dayKey(addDays(day, 0)) === key ? day : null;
}

/** How far a time zone is ahead of UTC at an instant, in milliseconds. */
function offsetAt(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric",
    day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(at / 1000) * 1000;
}

export interface WallTime {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The instant a wall-clock time stands for in a time zone. Twice round, so a clock change near it is allowed for. */
export function wallInstant(t: WallTime, timeZone: string): number {
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const first = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(first, timeZone);
}

/** The instant a calendar day begins in a time zone. */
export function startOfDay(key: string, timeZone: string): number {
  const day = parseDayKey(key);
  if (!day) return Number.NaN;
  return wallInstant({ year: day.y, month: day.m, day: day.d, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** True for a time zone name this device knows (IANA, like "Europe/London"). */
export function isTimeZone(name: unknown): name is string {
  if (typeof name !== "string" || !name || name.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** The day key `n` days after `key`. */
export function shiftKey(key: string, n: number): string {
  const day = parseDayKey(key);
  return day ? dayKey(addDays(day, n)) : key;
}

/** The day an instant falls on in a time zone. */
export function keyOf(at: number, timeZone: string): string {
  return dayKey(calendarDayIn(new Date(at), timeZone));
}

/** `count` day keys from `first` on. */
export function daysFrom(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftKey(first, i));
}
