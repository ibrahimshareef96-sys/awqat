// Prayer reminders planned on the device, and when a new place is worth recalculating for.
import { describe, expect, it } from "vitest";
import { planReminders, reminderId } from "../src/reminders/plan.ts";
import { dayTimes } from "../src/prayer/times.ts";
import { distanceKm, shouldMove } from "../src/place.ts";
import { DUBAI } from "./fixtures/places.ts";

const days = [22, 23, 24].map((d) => dayTimes(DUBAI, { y: 2026, m: 10, d }, "Dubai"));
const allOn = { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true };

describe("the reminder plan", () => {
  it("plans only prayers still to come, each with a stable id", () => {
    const now = new Date("2026-10-22T12:15:00+04:00");
    const plan = planReminders(days, now, allOn);
    expect(plan[0].title).toBe("Asr");
    expect(plan[0].at.getTime()).toBe(days[0].asr.getTime());
    expect(plan).toHaveLength(3 + 5 + 5);
    expect(new Set(plan.map((r) => r.id)).size).toBe(plan.length);
    expect(plan[0].id).toBe(reminderId("2026-10-22", "asr"));
  });

  it("plays the Madinah adhan when it is on, Fajr's own at Fajr, and the system's sound when it is off", () => {
    const now = new Date("2026-10-22T00:00:00+04:00");
    const withAdhan = planReminders(days, now, allOn, undefined, true);
    expect(withAdhan.find((r) => r.title === "Fajr")?.sound).toBe("adhan-fajr");
    expect(withAdhan.filter((r) => r.title !== "Fajr").every((r) => r.sound === "adhan")).toBe(true);
    expect(planReminders(days, now, allOn).every((r) => r.sound === undefined)).toBe(true);
  });

  it("skips the prayers you switched off", () => {
    const plan = planReminders(days, new Date("2026-10-22T00:00:00+04:00"), { ...allOn, fajr: false });
    expect(plan.some((r) => r.title === "Fajr")).toBe(false);
    expect(plan).toHaveLength(12);
  });

  it("keeps ids inside Android's 32-bit range and under iOS's 64 pending", () => {
    const week = Array.from({ length: 12 }, (_, i) => dayTimes(DUBAI, { y: 2026, m: 12, d: 20 + i }, "Dubai"));
    const plan = planReminders(week, new Date("2026-12-20T00:00:00+04:00"), allOn);
    expect(plan.length).toBeLessThanOrEqual(60);
    for (const r of plan) expect(r.id).toBeLessThan(2 ** 31);
  });
});

describe("moving to a new place", () => {
  const sharjah = { ...DUBAI, lat: 25.3463, lng: 55.4209, label: "Sharjah" };
  const marina = { ...DUBAI, lat: 25.08, lng: 55.14, label: "Marina" };

  it("measures the distance on the globe", () => {
    expect(Math.round(distanceKm(DUBAI, sharjah))).toBe(22);
  });

  it("recalculates only after moving more than 25 km", () => {
    expect(shouldMove(DUBAI, marina)).toBe(false);
    expect(shouldMove(DUBAI, { ...DUBAI, lat: 24.4539, lng: 54.3773 })).toBe(true);
  });
});
