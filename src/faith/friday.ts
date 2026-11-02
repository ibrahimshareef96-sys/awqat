/**
 * Friday (Jumu'ah): a short checklist for the day, the window it is open (from Maghrib on Thursday, when the Islamic
 * day of Friday begins, to Maghrib on Friday), and its two reminders. Every change returns a new log.
 */
import { PRAYER_LABEL, formatTime, type DayTimes, type PrayerName } from "../prayer/times.ts";
import { FRIDAY_SLOT, type Reminder } from "../reminders/plan.ts";

export const FRIDAY_ITEMS = ["kahf", "ghusl", "early", "salawat", "dua"] as const;
export type FridayItem = (typeof FRIDAY_ITEMS)[number];

export const FRIDAY_LABEL: Readonly<Record<FridayItem, string>> = {
  kahf: "Surah Al-Kahf",
  ghusl: "Ghusl",
  early: "Early to Jumu'ah",
  salawat: "Salawat on the Prophet ﷺ",
  dua: "Dua in the last hour",
};

/** Where each item comes from, as shown on sunnah.com (checked 23 Oct 2026). */
export const FRIDAY_SOURCE: Readonly<Record<FridayItem, string>> = {
  kahf: "al-Bayhaqi, Mishkat 2175, hasan (al-Albani)",
  ghusl: "Bukhari 877",
  early: "Bukhari 881",
  salawat: "Abu Dawud 1047, sahih (al-Albani)",
  dua: "Abu Dawud 1048, sahih (al-Albani): the last hour after Asr",
};

export interface FridayLog {
  v: 1;
  /** By Friday's date (YYYY-MM-DD): the items done that Friday. */
  days: Record<string, Partial<Record<FridayItem, true>>>;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export function emptyFridayLog(): FridayLog {
  return { v: 1, days: {} };
}

const utcNoon = (key: string): number => Date.parse(`${key}T12:00:00Z`);

export function isFriday(key: string): boolean {
  return DAY_KEY.test(key) && new Date(utcNoon(key)).getUTCDay() === 5;
}

/** On Fridays, Dhuhr is Jumu'ah. */
export function prayerName(p: PrayerName, date: string): string {
  return p === "dhuhr" && isFriday(date) ? "Jumu'ah" : PRAYER_LABEL[p];
}

const isItem = (item: string): item is FridayItem => (FRIDAY_ITEMS as readonly string[]).includes(item);

export function toggleFriday(log: FridayLog, friday: string, item: FridayItem): FridayLog {
  if (!isFriday(friday) || !isItem(item)) return log;
  const { [item]: was, ...rest } = log.days[friday] ?? {};
  const day = was ? rest : { ...rest, [item]: true as const };
  return { ...log, days: { ...log.days, [friday]: day } };
}

export interface FridayWindow { friday: string; start: Date; end: Date }

/** The Friday open now, from Maghrib on Thursday to Maghrib on Friday; null outside it. */
export function fridayWindow(days: readonly DayTimes[], now: Date): FridayWindow | null {
  for (let i = 1; i < days.length; i += 1) {
    const thursday = days[i - 1];
    const friday = days[i];
    if (!isFriday(friday.date) || utcNoon(friday.date) - utcNoon(thursday.date) !== DAY_MS) continue;
    if (now.getTime() >= thursday.maghrib.getTime() && now.getTime() < friday.maghrib.getTime()) {
      return { friday: friday.date, start: thursday.maghrib, end: friday.maghrib };
    }
  }
  return null;
}

/** A Friday reminder id: the same date scheme as the prayers, in slots 7 (morning) and 8 (the last hour). */
const fridayId = (date: string, slot: number): number => Number(date.replaceAll("-", "")) * 10 + slot;

/**
 * Two reminders each Friday: in the morning (two hours after sunrise, and at least an hour and a half before Dhuhr)
 * and an hour before Maghrib. Al-Kahf is mentioned until it is ticked for that Friday.
 */
export function planFriday(days: readonly DayTimes[], now: Date, options: { enabled: boolean; done: FridayLog },
  timeZone?: string): Reminder[] {
  if (!options.enabled) return [];
  return days.filter((d) => isFriday(d.date)).flatMap((d) => {
    const kahfDone = options.done.days[d.date]?.kahf === true;
    const morning = new Date(Math.min(d.sunrise.getTime() + 2 * HOUR_MS, d.dhuhr.getTime() - 1.5 * HOUR_MS));
    const lastHour = new Date(d.maghrib.getTime() - HOUR_MS);
    const reminders: Reminder[] = [
      {
        id: fridayId(d.date, FRIDAY_SLOT.morning), title: "Jumu'ah Mubarak", at: morning,
        body: kahfDone ? "Ghusl, go early to Jumu'ah, and send plenty of salawat on the Prophet ﷺ."
          : "Ghusl, go early to Jumu'ah, and read Surah Al-Kahf today.",
      },
      {
        id: fridayId(d.date, FRIDAY_SLOT.lastHour), title: "The last hour of Friday", at: lastHour,
        body: `Make dua before Maghrib at ${formatTime(d.maghrib, timeZone)}.` +
          (kahfDone ? "" : " Surah Al-Kahf is still unread."),
      },
    ];
    return reminders.filter((r) => Number.isFinite(r.at.getTime()) && r.at.getTime() > now.getTime());
  });
}

/** Reads a saved Friday log back: only real Fridays, only known items, only ticks. */
export function checkFridayLog(json: string | null): { log: FridayLog; damaged: boolean } {
  if (json === null) return { log: emptyFridayLog(), damaged: false };
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null || raw.v !== 1) return { log: emptyFridayLog(), damaged: true };
    const source = typeof raw.days === "object" && raw.days !== null ? (raw.days as Record<string, unknown>) : {};
    const days: FridayLog["days"] = {};
    for (const [key, value] of Object.entries(source)) {
      if (!isFriday(key) || typeof value !== "object" || value === null) continue;
      const ticks = Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([item, done]) => isItem(item) && done === true).map(([item]) => [item, true as const]));
      if (Object.keys(ticks).length > 0) days[key] = ticks;
    }
    return { log: { v: 1, days }, damaged: false };
  } catch {
    return { log: emptyFridayLog(), damaged: true };
  }
}
