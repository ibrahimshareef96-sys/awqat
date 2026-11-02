// The optional weekly review reminder: off until asked for, on the day and at the time chosen in the place's own clock,
// left out for a week already reviewed, and tapped open on the Weekly Review.
import { describe, expect, it } from "vitest";
import { dayTimes } from "../src/prayer/times.ts";
import { REVIEW_SLOT, isReminderId, reminderTarget } from "../src/reminders/plan.ts";
import { emptyReviewLog, saveReview } from "../src/review/muhasabah.ts";
import {
  DEFAULT_REVIEW_REMINDER, cleanReviewReminder, cleanTime, planReview, withReminderField, type ReviewReminder,
} from "../src/review/reminder.ts";
import { defaultSettings, parseSettings } from "../src/settings.ts";
import { DUBAI } from "./fixtures/places.ts";

/** Tuesday 3 November 2026 to Monday 16 November, prayer days in Dubai. */
const days = Array.from({ length: 14 }, (_, i) => dayTimes(DUBAI, { y: 2026, m: 11, d: 3 + i }, "Dubai"));
const NOW = new Date("2026-11-03T10:00:00+04:00");
const on = (patch: Partial<ReviewReminder> = {}): ReviewReminder => ({ on: true, weekday: 0, time: "20:30", ...patch });

describe("the reminder's settings", () => {
  it("are off by default, Sunday at 20:00 once turned on", () => {
    expect(DEFAULT_REVIEW_REMINDER).toEqual({ on: false, weekday: 0, time: "20:00" });
    expect(defaultSettings().reviewReminder).toEqual(DEFAULT_REVIEW_REMINDER);
    expect(parseSettings(JSON.stringify({ name: "Sam" })).reviewReminder).toEqual(DEFAULT_REVIEW_REMINDER);
  });

  it("read back only what is valid", () => {
    expect(cleanReviewReminder({ on: true, weekday: 4, time: "21:15" })).toEqual({ on: true, weekday: 4, time: "21:15" });
    expect(cleanReviewReminder({ on: "yes", weekday: 7, time: "25:00" })).toEqual(DEFAULT_REVIEW_REMINDER);
    expect(cleanReviewReminder({ on: true, weekday: 2.5, time: 2100 })).toEqual({ ...DEFAULT_REVIEW_REMINDER, on: true });
    expect(cleanReviewReminder(null)).toEqual(DEFAULT_REVIEW_REMINDER);
    expect(parseSettings(JSON.stringify({ reviewReminder: { on: true, weekday: 5, time: "07:05" } })).reviewReminder)
      .toEqual({ on: true, weekday: 5, time: "07:05" });
  });

  it("take a time as a time field gives it, seconds and all", () => {
    expect(cleanTime("07:05")).toBe("07:05");
    expect(cleanTime("23:59:30")).toBe("23:59");
    expect(cleanTime("24:00")).toBeNull();
    expect(cleanTime("7:05")).toBeNull();
    expect(cleanTime("")).toBeNull();
  });

  it("change one field at a time from Settings, and keep what is valid", () => {
    const start = DEFAULT_REVIEW_REMINDER;
    expect(withReminderField(start, "review-reminder", "", true)).toEqual({ ...start, on: true });
    expect(withReminderField(start, "review-day", "5", false)).toEqual({ ...start, weekday: 5 });
    expect(withReminderField(start, "review-day", "8", false)).toBe(start);
    expect(withReminderField(start, "review-time", "06:45", false)).toEqual({ ...start, time: "06:45" });
    expect(withReminderField(start, "review-time", "", false)).toBe(start);
    expect(withReminderField(start, "something-else", "1", true)).toBe(start);
  });
});

describe("the reminder plan", () => {
  it("plans nothing while the reminder is off", () => {
    expect(planReview(days, NOW, { reminder: DEFAULT_REVIEW_REMINDER, reviews: emptyReviewLog() }, "Asia/Dubai")).toEqual([]);
  });

  it("rings on each chosen weekday ahead, at the chosen time on the place's clock, opening the Weekly Review", () => {
    const plan = planReview(days, NOW, { reminder: on(), reviews: emptyReviewLog() }, "Asia/Dubai");
    expect(plan.map((r) => r.at.toISOString())).toEqual(["2026-11-08T16:30:00.000Z", "2026-11-15T16:30:00.000Z"]);
    expect(plan[0].id).toBe(20261108 * 10 + REVIEW_SLOT);
    expect(isReminderId(plan[0].id)).toBe(true);
    expect(reminderTarget(plan[0].id)).toBe("review");
    expect(plan[0].title).toBe("Weekly review");
    expect(plan.map((r) => `${r.title} ${r.body}`).join(" ")).not.toMatch(/streak|score|miss|!/i);
  });

  it("follows the place's time zone, not the phone's", () => {
    const plan = planReview(days, NOW, { reminder: on({ weekday: 6, time: "09:00" }), reviews: emptyReviewLog() }, "Europe/London");
    expect(plan[0].at.toISOString()).toBe("2026-11-07T09:00:00.000Z");
  });

  it("leaves out a week already reviewed, and one whose time has passed", () => {
    const done = saveReview(emptyReviewLog(), { well: "Alhamdulillah", short: "", change: "", intentions: [] }, "2026-11-03");
    if ("error" in done) throw new Error(done.error);
    const plan = planReview(days, NOW, { reminder: on(), reviews: done.log }, "Asia/Dubai");
    expect(plan.map((r) => r.at.toISOString())).toEqual(["2026-11-15T16:30:00.000Z"]);
    const tuesday = planReview(days, NOW, { reminder: on({ weekday: 2, time: "09:00" }), reviews: emptyReviewLog() }, "Asia/Dubai");
    expect(tuesday.map((r) => r.at.toISOString().slice(0, 10))).toEqual(["2026-11-10"]);
  });
});
