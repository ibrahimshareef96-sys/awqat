/** Which prayer reminders to schedule on the device: the ones still to come, inside iOS's 64-pending limit. */
import { PRAYERS, PRAYER_LABEL, formatTime, type DayTimes, type PrayerName } from "../prayer/times.ts";

export interface Reminder {
  id: number;
  title: string;
  body: string;
  at: Date;
  /** The adhan it plays (Fajr has its own); none, the system's sound. */
  sound?: AdhanSound;
}

export type AdhanSound = "adhan" | "adhan-fajr";

/** iOS keeps at most 64 pending local notifications; leave room for others. */
export const MAX_PENDING = 60;

/** A stable id per day and prayer: 20261022 * 10 + index stays inside Android's 32-bit range until the year 21474. */
export function reminderId(date: string, prayer: PrayerName): number {
  return Number(date.replaceAll("-", "")) * 10 + PRAYERS.indexOf(prayer);
}

/** The morning and evening adhkar use the same date scheme, in the two slots after the five prayers. */
export const ADHKAR_SLOT = { morning: 5, evening: 6 } as const;

/** Friday's two reminders, in the slots after those. */
export const FRIDAY_SLOT = { morning: 7, lastHour: 8 } as const;

/** The weekly review's reminder, in the last slot (review/reminder.ts). */
export const REVIEW_SLOT = 9;

export function isReminderId(id: number): boolean {
  const slot = id % 10;
  return Number.isInteger(id) && id >= 190000000 && id < 2 ** 31 &&
    (slot < PRAYERS.length || slot === ADHKAR_SLOT.morning || slot === ADHKAR_SLOT.evening ||
      slot === FRIDAY_SLOT.morning || slot === FRIDAY_SLOT.lastHour || slot === REVIEW_SLOT);
}

/** The screen a tapped reminder opens: its mode, where it has one. Other reminders just open the app. */
export function reminderTarget(id: number): string | null {
  if (!isReminderId(id)) return null;
  const slot = id % 10;
  if (slot === REVIEW_SLOT) return "review";
  if (slot === FRIDAY_SLOT.morning || slot === FRIDAY_SLOT.lastHour) return "mode:jumuah";
  if (slot === ADHKAR_SLOT.morning || slot === PRAYERS.indexOf("fajr")) return "mode:fajr";
  if (slot === PRAYERS.indexOf("maghrib")) return "mode:maghrib";
  return slot === ADHKAR_SLOT.evening ? "adhkar:evening" : null;
}

/** Every reminder the app keeps pending: nearest first, inside the limit. */
export function planAll(...plans: Reminder[][]): Reminder[] {
  return plans.flat().sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_PENDING);
}

export function planReminders(days: DayTimes[], now: Date, enabled: Record<PrayerName, boolean>, timeZone?: string,
  adhan = false): Reminder[] {
  const plan: Reminder[] = [];
  for (const day of days) {
    for (const prayer of PRAYERS) {
      const at = day[prayer];
      if (!enabled[prayer] || !Number.isFinite(at.getTime()) || at.getTime() <= now.getTime()) continue;
      const reminder: Reminder = {
        id: reminderId(day.date, prayer),
        title: PRAYER_LABEL[prayer],
        body: `It is time for ${PRAYER_LABEL[prayer]}, ${formatTime(at, timeZone)}.`,
        at,
      };
      plan.push(adhan ? { ...reminder, sound: prayer === "fajr" ? "adhan-fajr" : "adhan" } : reminder);
    }
  }
  return plan.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_PENDING);
}
