/**
 * The weekly review's reminder: off until the user turns it on in Settings, then on the weekday and at the time chosen,
 * on the place's clock. A week already reviewed is left out. It says what the review is for and nothing more: no
 * counts, nothing about weeks missed. Weekdays are numbered as Date numbers them: 0 is Sunday. Pure.
 */
import { parseDayKey, wallInstant } from "../agenda/days.ts";
import type { DayTimes } from "../prayer/times.ts";
import { REVIEW_SLOT, type Reminder } from "../reminders/plan.ts";
import { reviewOf, weekOf, type ReviewLog } from "./muhasabah.ts";

export interface ReviewReminder {
  on: boolean;
  /** 0 is Sunday. */
  weekday: number;
  /** "HH:MM", on the place's clock. */
  time: string;
}

/** Off; once turned on, Sunday evening, the end of the app's week. */
export const DEFAULT_REVIEW_REMINDER: ReviewReminder = { on: false, weekday: 0, time: "20:00" };

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** Monday first, as the app's weeks are. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** The Settings fields that change it. */
export const REMINDER_FIELDS: ReadonlySet<string> = new Set(["review-reminder", "review-day", "review-time"]);

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d(\.\d+)?)?$/;
const isWeekday = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6;

/** A time as a time field gives it ("HH:MM", with seconds on some keyboards), as "HH:MM"; null when it is not one. */
export function cleanTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = CLOCK.exec(value);
  return m ? `${m[1]}:${m[2]}` : null;
}

export function cleanReviewReminder(raw: unknown): ReviewReminder {
  const r = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  return {
    on: r.on === true,
    weekday: isWeekday(r.weekday) ? r.weekday : DEFAULT_REVIEW_REMINDER.weekday,
    time: cleanTime(r.time) ?? DEFAULT_REVIEW_REMINDER.time,
  };
}

/** One field changed in Settings; a value that is not one leaves the reminder as it was. */
export function withReminderField(current: ReviewReminder, field: string, value: string, checked: boolean): ReviewReminder {
  if (field === "review-reminder") return { ...current, on: checked };
  if (field === "review-day" && /^[0-6]$/.test(value)) return { ...current, weekday: Number(value) };
  const time = field === "review-time" ? cleanTime(value) : null;
  return time ? { ...current, time } : current;
}

const weekdayOf = (day: string): number => new Date(`${day}T12:00:00Z`).getUTCDay();

/** The reminders still to come on the days given, one on each chosen weekday whose week has no review yet. */
export function planReview(days: readonly DayTimes[], now: Date, options: { reminder: ReviewReminder; reviews: ReviewLog },
  timeZone: string): Reminder[] {
  const { reminder, reviews } = options;
  if (!reminder.on) return [];
  const [hour, minute] = reminder.time.split(":").map(Number);
  return days.flatMap((d): Reminder[] => {
    const day = parseDayKey(d.date);
    if (!day || weekdayOf(d.date) !== reminder.weekday || reviewOf(reviews, weekOf(d.date))) return [];
    const at = new Date(wallInstant({ year: day.y, month: day.m, day: day.d, hour, minute, second: 0 }, timeZone));
    if (!Number.isFinite(at.getTime()) || at.getTime() <= now.getTime()) return [];
    return [{ id: Number(d.date.replaceAll("-", "")) * 10 + REVIEW_SLOT, title: "Weekly review",
      body: "A few minutes to look back on your week and set your intentions.", at }];
  });
}
