/**
 * The iqama after each adhan, in minutes. Every mosque keeps its own, so they are set in Settings; these are where they
 * start. Friday's Dhuhr is Jumu'ah, whose time the app cannot know, so it has no iqama here.
 */
import { isFriday, prayerName } from "../faith/friday.ts";
import { PRAYERS, type DayTimes, type PrayerName } from "./times.ts";
import { untilPhrase } from "./window.ts";

export type IqamaMinutes = Readonly<Record<PrayerName, number>>;

/** Where each prayer's iqama starts until it is set: minutes after the adhan. */
export const IQAMA_MINUTES: IqamaMinutes = { fajr: 25, dhuhr: 20, asr: 20, maghrib: 7, isha: 20 };
export const IQAMA_MIN = 1;
export const IQAMA_MAX = 90;

/** A whole number of minutes in range, typed (plain digits) or saved, or null for anything else. */
export function parseIqamaMinutes(value: unknown): number | null {
  const n = typeof value === "string" ? (/^\s*\d{1,3}\s*$/.test(value) ? Number(value) : NaN) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= IQAMA_MIN && n <= IQAMA_MAX ? n : null;
}

/** A whole number of minutes in range, else the prayer's starting value. */
export function cleanIqamaMinutes(value: unknown, prayer: PrayerName): number {
  return parseIqamaMinutes(value) ?? IQAMA_MINUTES[prayer];
}

/** Each prayer's minutes from what was saved; anything missing or out of range starts where IQAMA_MINUTES does. */
export function cleanIqama(raw: unknown): IqamaMinutes {
  const saved = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(PRAYERS.map((p) => [p, cleanIqamaMinutes(saved[p], p)])) as IqamaMinutes;
}

/** The iqama of a prayer on that day, or null for Friday's Dhuhr (Jumu'ah) or a time that is not there. */
export function iqamaAt(day: DayTimes, prayer: PrayerName): Date | null {
  if (prayer === "dhuhr" && isFriday(day.date)) return null;
  const adhan = day[prayer];
  if (!Number.isFinite(adhan.getTime())) return null;
  return new Date(adhan.getTime() + (day.iqama?.[prayer] ?? IQAMA_MINUTES[prayer]) * 60_000);
}

/** The prayer whose adhan has sounded and whose iqama has not come yet, with its iqama; null when none is. */
export function awaitingIqama(day: DayTimes, now: Date): { prayer: PrayerName; at: Date } | null {
  for (const prayer of PRAYERS) {
    const iqama = iqamaAt(day, prayer);
    if (iqama !== null && day[prayer].getTime() <= now.getTime() && now.getTime() < iqama.getTime()) {
      return { prayer, at: iqama };
    }
  }
  return null;
}

/** Home's words while an iqama is coming ("Fajr iqama in 18 min"), else "". */
export function iqamaCountdown(day: DayTimes, now: Date): string {
  const waiting = awaitingIqama(day, now);
  return waiting ? `${prayerName(waiting.prayer, day.date)} iqama ${untilPhrase(now, waiting.at)}` : "";
}
