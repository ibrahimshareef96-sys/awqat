// Reminders kept on the phone: planned again only when what they would say or when they would ring has changed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const device = vi.hoisted(() => ({
  ADHAN_BUNDLED: false,
  scheduleReminders: vi.fn(async (plan: unknown[]) => plan.length),
  exactAlarms: vi.fn(async () => "granted" as const),
}));
vi.mock("../src/device.ts", () => device);
vi.mock("../src/store.ts", () => ({ KEYS: {}, write: vi.fn(async () => true) }));

import { DEFAULT_PLACE } from "../src/place.ts";
import { DUBAI } from "./fixtures/places.ts";
import { defaultSettings } from "../src/settings.ts";
import { emptyFridayLog, toggleFriday } from "../src/faith/friday.ts";
import { adhkarFor, emptyAdhkarLog, setDone } from "../src/faith/adhkar.ts";
import { state } from "../src/app/state.ts";
import { reschedule } from "../src/app/schedule.ts";
import { REVIEW_SLOT } from "../src/reminders/plan.ts";
import { emptyReviewLog, saveReview } from "../src/review/muhasabah.ts";

/** Thursday 22 Oct 2026, 14:00 in Dubai: Friday's reminders are ahead. */
const THURSDAY = new Date("2026-10-22T10:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(THURSDAY);
  device.scheduleReminders.mockClear();
  state.place = DUBAI;
  state.settings = defaultSettings();
  state.friday = emptyFridayLog();
  state.adhkar = emptyAdhkarLog();
  state.notify = "granted";
  state.pending = null;
  state.days = [];
});

const bodies = (): string[] => (device.scheduleReminders.mock.calls.at(-1)?.[0] as { body: string }[]).map((r) => r.body);

describe("rescheduling", () => {
  it("skips a plan that has not changed", async () => {
    await reschedule();
    await reschedule();
    expect(device.scheduleReminders).toHaveBeenCalledTimes(1);
    expect(state.pending).toBeGreaterThan(0);
  });

  it("plans again when Al-Kahf is ticked, since the reminder's words change", async () => {
    await reschedule();
    expect(bodies().some((b) => /Kahf/.test(b))).toBe(true);
    state.friday = toggleFriday(state.friday, "2026-10-23", "kahf");
    await reschedule();
    expect(device.scheduleReminders).toHaveBeenCalledTimes(2);
  });

  it("plans again when Friday reminders are turned off, and leaves them out", async () => {
    await reschedule();
    const before = (device.scheduleReminders.mock.calls[0][0] as unknown[]).length;
    state.settings = { ...state.settings, fridayReminders: false };
    await reschedule();
    expect((device.scheduleReminders.mock.calls[1][0] as unknown[]).length).toBeLessThanOrEqual(before);
    expect(bodies().some((b) => /Kahf/.test(b))).toBe(false);
  });

  it("keeps the adhkar reminders, drops a day's set once it is complete, and leaves them all out when off", async () => {
    await reschedule();
    const titles = () => (device.scheduleReminders.mock.calls.at(-1)?.[0] as { title: string; id: number }[]);
    expect(titles().some((r) => r.title === "Adhkar al-Masa" && r.id === 202610226)).toBe(true);
    state.adhkar = adhkarFor("evening").reduce((log, item) =>
      setDone(log, "2026-10-22", "evening", item.id, true), emptyAdhkarLog());
    await reschedule();
    expect(titles().some((r) => r.id === 202610226)).toBe(false);
    expect(titles().some((r) => r.title === "Adhkar al-Sabah")).toBe(true);
    state.settings = { ...state.settings, adhkarReminders: false };
    await reschedule();
    expect(titles().some((r) => r.title.startsWith("Adhkar"))).toBe(false);
  });

  it("schedules nothing without permission, and plans afresh once it is given", async () => {
    state.notify = "denied";
    await reschedule();
    expect(device.scheduleReminders).not.toHaveBeenCalled();
    expect(state.pending).toBeNull();
    state.notify = "granted";
    await reschedule();
    expect(device.scheduleReminders).toHaveBeenCalledTimes(1);
  });

  it("keeps no more than 60 reminders, the phone's limit with room to spare", async () => {
    await reschedule();
    expect((device.scheduleReminders.mock.calls[0][0] as unknown[]).length).toBeLessThanOrEqual(60);
  });

  it("schedules nothing for a place it only guessed, and plans once the place is set", async () => {
    state.place = DEFAULT_PLACE;
    await reschedule();
    expect(device.scheduleReminders).not.toHaveBeenCalled();
    expect(state.pending).toBeNull();
    expect(state.days.length).toBeGreaterThan(0);
    state.place = DUBAI;
    await reschedule();
    expect(device.scheduleReminders).toHaveBeenCalledTimes(1);
  });

  it("works the days out with the iqama the user set", async () => {
    state.settings = { ...state.settings, iqama: { ...state.settings.iqama, asr: 33 } };
    await reschedule();
    expect(state.days.every((d) => d.iqama?.asr === 33)).toBe(true);
  });

  it("plans the weekly review reminder only once it is turned on, and drops it for a week already reviewed", async () => {
    const reviewIds = () => (device.scheduleReminders.mock.calls.at(-1)?.[0] as { id: number }[])
      .filter((r) => r.id % 10 === REVIEW_SLOT).map((r) => r.id);
    state.reviews = emptyReviewLog();
    await reschedule();
    expect(reviewIds()).toEqual([]);
    state.settings = { ...state.settings, reviewReminder: { on: true, weekday: 0, time: "20:00" } };
    await reschedule();
    // Sunday the 25th; the Sunday after is past the nearest 60 reminders, and is planned when the app next plans.
    expect(reviewIds()).toEqual([202610259]);
    const done = saveReview(state.reviews, { well: "Alhamdulillah", short: "", change: "", intentions: [] }, "2026-10-22");
    if ("error" in done) throw new Error(done.error);
    state.reviews = done.log;
    await reschedule();
    expect(reviewIds()).toEqual([]);
    expect(device.scheduleReminders).toHaveBeenCalledTimes(3);
  });

  it("plays no adhan in a build that ships none, whatever the switch says", async () => {
    state.settings = { ...state.settings, adhan: true };
    await reschedule();
    const plan = device.scheduleReminders.mock.calls.at(-1)?.[0] as { sound?: string }[];
    expect(plan.some((r) => r.sound)).toBe(false);
  });
});
