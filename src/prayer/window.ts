/** Which part of the prayer day it is (the sky follows it) and which prayer comes next. */
import { PRAYERS, type DayTimes, type PrayerName } from "./times.ts";

export type SkyMoment = "fajr" | "morning" | "dhuhr" | "asr" | "maghrib" | "isha";

export function skyMoment(t: DayTimes, now: Date): SkyMoment {
  const n = now.getTime();
  if (n < t.fajr.getTime()) return "isha";
  if (n < t.sunrise.getTime()) return "fajr";
  if (n < t.dhuhr.getTime()) return "morning";
  if (n < t.asr.getTime()) return "dhuhr";
  if (n < t.maghrib.getTime()) return "asr";
  if (n < t.isha.getTime()) return "maghrib";
  return "isha";
}

/**
 * The prayer day runs from Fajr to the next Fajr, so an Isha prayed after midnight still marks the night before.
 * Returns the index of the day in `days` (oldest first) whose Fajr has most recently come; 0 before any.
 */
export function prayerDayIndex(days: readonly DayTimes[], now: Date): number {
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i].fajr.getTime() <= now.getTime()) return i;
  }
  return 0;
}

export interface NextPrayer {
  name: PrayerName;
  at: Date;
}

export function nextPrayer(today: DayTimes, tomorrow: DayTimes, now: Date): NextPrayer {
  for (const name of PRAYERS) {
    if (today[name].getTime() > now.getTime()) return { name, at: today[name] };
  }
  return { name: "fajr", at: tomorrow.fajr };
}

/** The prayer whose time has come and not yet passed to the next one, if any (none between sunrise and Dhuhr). */
export function currentPrayer(t: DayTimes, now: Date): PrayerName | null {
  const moment = skyMoment(t, now);
  if (moment === "morning") return null;
  if (moment === "isha" && now.getTime() < t.fajr.getTime()) return null;
  return moment;
}

export function untilPhrase(from: Date, to: Date): string {
  const span = to.getTime() - from.getTime();
  if (!Number.isFinite(span)) return "";
  const minutes = Math.round(span / 60000);
  if (minutes <= 0) return "now";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `in ${m} min` : `in ${h} h ${String(m).padStart(2, "0")} min`;
}
