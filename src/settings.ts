/** The owner's settings, kept on the device. Nothing personal is built into the app: the name is typed once. */
import { IQAMA_MINUTES, cleanIqama, type IqamaMinutes } from "./prayer/iqama.ts";
import { isMethod, methodForTimeZone, type MethodId } from "./prayer/method.ts";
import { PRAYERS, type PrayerName } from "./prayer/times.ts";
import { DEFAULT_REVIEW_REMINDER, cleanReviewReminder, type ReviewReminder } from "./review/reminder.ts";
import { cleanWorkerUrl } from "./voice.ts";

export interface Settings {
  name: string;
  method: MethodId | "auto";
  /** Minutes from each adhan to its iqama at the user's mosque. */
  iqama: IqamaMinutes;
  reminders: Record<PrayerName, boolean>;
  /** Friday's two reminders: the morning one (Al-Kahf, ghusl, going early) and the last hour before Maghrib. */
  fridayReminders: boolean;
  /** A reminder for Adhkar al-Sabah after Fajr and Adhkar al-Masa after Asr, until that day's set is complete. */
  adhkarReminders: boolean;
  /** A reminder for the Weekly Review on a day and at a time the user picks; off until turned on. */
  reviewReminder: ReviewReminder;
  /** Each prayer reminder plays the adhan (Fajr its own), in a build that ships one (device.ts); off, the system's sound. */
  adhan: boolean;
  /** The assistant may hear the user's money and log it. Off until allowed: amounts pass through the voice service. */
  assistantMoney: boolean;
  /** The assistant may hear steps and sleep from the health store. Off until allowed, for the same reason. */
  assistantHealth: boolean;
  /** The mushaf's pages turn like a book's; off, they slide. Kept on each device. */
  bookPages: boolean;
  /** The next prayer, a dhikr or a timer live on the lock screen and the Dynamic Island. */
  live: boolean;
  /** The welcome card has been answered (location and notifications asked once). */
  setupDone: boolean;
  /** The owner's Worker, where the voice page lives (an https origin), or "" for the one built in. */
  voiceUrl: string;
}

export const NAME_MAX = 40;

export function defaultSettings(): Settings {
  return {
    name: "",
    method: "auto",
    iqama: IQAMA_MINUTES,
    reminders: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
    fridayReminders: true,
    adhkarReminders: true,
    reviewReminder: { ...DEFAULT_REVIEW_REMINDER },
    adhan: true,
    assistantMoney: false,
    assistantHealth: false,
    bookPages: true,
    live: true,
    setupDone: false,
    voiceUrl: "",
  };
}

export function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  // By characters, not UTF-16 units, so an emoji is never cut in half.
  return Array.from(value.replace(/\s+/g, " ").trim()).slice(0, NAME_MAX).join("").trim();
}

export function parseSettings(json: string | null): Settings {
  const base = defaultSettings();
  if (json === null) return base;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null) return base;
    const rawReminders = (typeof raw.reminders === "object" && raw.reminders !== null ? raw.reminders : {}) as
      Record<string, unknown>;
    const reminders = { ...base.reminders };
    for (const p of PRAYERS) {
      if (typeof rawReminders[p] === "boolean") reminders[p] = rawReminders[p] as boolean;
    }
    return {
      name: cleanName(raw.name),
      method: isMethod(raw.method) ? raw.method : "auto",
      iqama: cleanIqama(raw.iqama),
      reminders,
      fridayReminders: raw.fridayReminders !== false,
      adhkarReminders: raw.adhkarReminders !== false,
      reviewReminder: cleanReviewReminder(raw.reviewReminder),
      adhan: raw.adhan !== false,
      assistantMoney: raw.assistantMoney === true,
      assistantHealth: raw.assistantHealth === true,
      bookPages: raw.bookPages !== false,
      live: raw.live !== false,
      setupDone: raw.setupDone === true,
      voiceUrl: cleanWorkerUrl(raw.voiceUrl),
    };
  } catch {
    return base;
  }
}

export function methodInUse(settings: Settings, timeZone: string): MethodId {
  return settings.method === "auto" ? methodForTimeZone(timeZone) : settings.method;
}

export function greetingFor(now: Date, name: string): string {
  const hour = now.getHours();
  const part = hour >= 5 && hour < 12 ? "Good morning"
    : hour >= 12 && hour < 17 ? "Good afternoon"
    : hour >= 17 && hour < 23 ? "Good evening"
    : "Good night";
  return name ? `${part}, ${name}` : part;
}
