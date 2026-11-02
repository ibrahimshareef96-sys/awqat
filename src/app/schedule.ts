/**
 * The prayer days the app works from, and the reminders kept on the device from them (prayers, Friday, the adhkar and
 * the weekly review).
 */
import { addDays, calendarDayIn, dayKey, dayTimes, type DayTimes } from "../prayer/times.ts";
import { planAll, planReminders } from "../reminders/plan.ts";
import { planFriday } from "../faith/friday.ts";
import { planAdhkar } from "../faith/adhkar.ts";
import { planReview } from "../review/reminder.ts";
import { methodInUse } from "../settings.ts";
import { ADHAN_BUNDLED, exactAlarms, scheduleReminders } from "../device.ts";
import { state } from "./state.ts";

/**
 * Days of prayer times kept ahead, plus yesterday so an Isha after midnight has its day. The reminders from them are
 * cut to the nearest 60 (iOS keeps 64): with the two adhkar each day and Friday's two, about eight days of them.
 */
const DAYS_AHEAD = 12;

let lastPlan = "";
let queue: Promise<void> = Promise.resolve();

export function computeDays(now: Date): DayTimes[] {
  const method = methodInUse(state.settings, state.place.tz);
  const start = addDays(calendarDayIn(now, state.place.tz), -1);
  const iqama = state.settings.iqama;
  return Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => ({ ...dayTimes(state.place, addDays(start, i), method), iqama }));
}

/** The days, recomputed when the calendar day in the place's zone has moved on (index 1 is today there). */
export function freshDays(now: Date): DayTimes[] {
  if (state.days[1]?.date !== dayKey(calendarDayIn(now, state.place.tz))) state.days = computeDays(now);
  return state.days;
}

/**
 * One reschedule at a time, each planned from the state as it is when its turn comes. An unchanged plan (same ids,
 * times and words) is skipped; a changed text, such as Al-Kahf ticked, counts as a change.
 */
export function reschedule(): Promise<void> {
  queue = queue.then(async () => {
    const now = new Date();
    state.days = computeDays(now);
    // No reminder rings for a place the app only guessed: Makkah's times would be wrong almost everywhere else.
    if (state.notify !== "granted" || state.place.source === "default") {
      state.pending = null;
      lastPlan = "";
      return;
    }
    const plan = planAll(
      planReminders(state.days, now, state.settings.reminders, state.place.tz, ADHAN_BUNDLED && state.settings.adhan),
      planFriday(state.days, now, { enabled: state.settings.fridayReminders, done: state.friday }, state.place.tz),
      planAdhkar(state.days, now, { enabled: state.settings.adhkarReminders, log: state.adhkar }, state.place.tz),
      planReview(state.days, now, { reminder: state.settings.reviewReminder, reviews: state.reviews }, state.place.tz),
    );
    const signature = plan.map((r) => `${r.id}@${r.at.getTime()}@${r.body}@${r.sound ?? ""}`).join("|");
    if (signature === lastPlan && state.pending !== null) return;
    state.pending = await scheduleReminders(plan);
    lastPlan = state.pending === null ? "" : signature;
    state.exact = await exactAlarms();
  }).catch(() => undefined);
  return queue;
}
