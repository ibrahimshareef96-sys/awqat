/** A day's prayer times from adhan-js (MIT), worked out on the device: no network, so it works anywhere. */
import { CalculationMethod, Coordinates, HighLatitudeRule, PrayerTimes } from "adhan";
import type { MethodId } from "./method.ts";
import { isOnEarth, type Place } from "../place.ts";

export const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
export type PrayerName = (typeof PRAYERS)[number];

export const PRAYER_LABEL: Readonly<Record<PrayerName, string>> = {
  fajr: "Fajr",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

export interface CalendarDay {
  y: number;
  /** 1 to 12. */
  m: number;
  d: number;
}

/** "none" almost everywhere; "rule" when a high-latitude rule was applied; "clamped" when the sun never sets or rises
 * there that day and the times were taken from 60° latitude instead. */
export type Adjusted = "none" | "rule" | "clamped";

export interface DayTimes {
  /** YYYY-MM-DD, the calendar day these times belong to, in the place's time zone. */
  date: string;
  fajr: Date;
  sunrise: Date;
  dhuhr: Date;
  asr: Date;
  maghrib: Date;
  isha: Date;
  method: MethodId;
  adjusted: Adjusted;
  /** Minutes from each adhan to its iqama, as set in Settings (prayer/iqama.ts); absent, the starting values. */
  iqama?: Readonly<Record<PrayerName, number>>;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function dayKey(day: CalendarDay): string {
  return `${day.y}-${pad(day.m)}-${pad(day.d)}`;
}

/** The calendar day of an instant in a time zone (the device's when none is given). */
export function calendarDayIn(date: Date, timeZone?: string): CalendarDay {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: part("year"), m: part("month"), d: part("day") };
}

export function addDays(day: CalendarDay, n: number): CalendarDay {
  const shifted = new Date(Date.UTC(day.y, day.m - 1, day.d + n, 12));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** Latitudes past this get adhan's recommended high-latitude rule. */
const HIGH_LATITUDE = 48;
/** Where the sun does not set or rise, times are taken from this latitude on the same meridian. */
const CLAMP_LATITUDE = 60;
const FIELDS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const;

function compute(lat: number, lng: number, day: CalendarDay, method: MethodId) {
  const coords = new Coordinates(lat, lng);
  const params = CalculationMethod[method]();
  if (Math.abs(lat) > HIGH_LATITUDE) params.highLatitudeRule = HighLatitudeRule.recommended(coords);
  const t = new PrayerTimes(coords, new Date(day.y, day.m - 1, day.d, 12), params);
  return { fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.maghrib, isha: t.isha };
}

const allReal = (t: Record<(typeof FIELDS)[number], Date>): boolean =>
  FIELDS.every((f) => t[f] instanceof Date && Number.isFinite(t[f].getTime()));

export function dayTimes(place: Pick<Place, "lat" | "lng">, day: CalendarDay, method: MethodId): DayTimes {
  if (!isOnEarth(place.lat, place.lng)) {
    throw new RangeError("That place is not on Earth.");
  }
  let times = compute(place.lat, place.lng, day, method);
  let adjusted: Adjusted = Math.abs(place.lat) > HIGH_LATITUDE ? "rule" : "none";
  if (!allReal(times)) {
    times = compute(Math.sign(place.lat) * CLAMP_LATITUDE, place.lng, day, method);
    adjusted = "clamped";
  }
  return { date: dayKey(day), ...times, method, adjusted };
}

/** "15:22" in the given time zone (the device's when none is given); empty for a time that is not a real date. */
export function formatTime(date: Date, timeZone?: string): string {
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
}
